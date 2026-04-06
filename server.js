require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const STORE_ID = process.env.STORE_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const API_BASE = `https://api.tiendanube.com/v1/${STORE_ID}`;
const USER_AGENT = process.env.USER_AGENT || 'PUR Metricas (purnootropics@gmail.com)';

const API_HEADERS = {
  'Authentication': `bearer ${ACCESS_TOKEN}`,
  'User-Agent': USER_AGENT,
  'Content-Type': 'application/json'
};

const META_TOKEN = process.env.META_ACCESS_TOKEN;
const META_ACCOUNT = process.env.META_AD_ACCOUNT;
const META_API_VERSION = process.env.META_API_VERSION || 'v25.0';
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

const COMISION_PROMEDIO = parseFloat(process.env.COMISION_PROMEDIO || '0.05');
const PLAN_TIENDA_NUBE  = parseFloat(process.env.PLAN_TIENDA_NUBE  || '24999');

// ML tokens in-memory (se renuevan automáticamente sin tocar .env)
const ml = {
  clientId:     process.env.ML_CLIENT_ID,
  clientSecret: process.env.ML_CLIENT_SECRET,
  accessToken:  process.env.ML_ACCESS_TOKEN,
  refreshToken: process.env.ML_REFRESH_TOKEN,
  userId:       process.env.ML_USER_ID
};

// ─── In-memory cache ──────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL    = 5  * 60 * 1000; // 5 minutos  (datos de negocio)
const FX_CACHE_TTL = 30 * 60 * 1000; // 30 minutos (tipo de cambio)

function getCached(key, ttl = CACHE_TTL) {
  const item = cache.get(key);
  if (item && Date.now() - item.ts < ttl) return item.data;
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ─── Tienda Nube API helpers ──────────────────────────────────────────────────
async function fetchAllPages(endpoint, params = {}) {
  let page = 1;
  const all = [];

  while (true) {
    try {
      const resp = await axios.get(`${API_BASE}${endpoint}`, {
        headers: API_HEADERS,
        params: { ...params, page, per_page: 200 },
        timeout: 20000
      });

      const items = resp.data;
      if (!Array.isArray(items) || items.length === 0) break;

      all.push(...items);
      if (items.length < 200 || page >= 50) break;
      page++;
    } catch (err) {
      if (err.response?.status === 404) break;
        if (err.response?.status === 429) {
        await new Promise(r => setTimeout(r, 2500));
        continue;
      }
      throw err;
    }
  }

  return all;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function getDateRanges(period) {
  const now = new Date();
  const days = period === 'day' ? 1 : period === 'week' ? 7 : 30;

  const currentStart = new Date(now);
  currentStart.setDate(now.getDate() - (days - 1));
  currentStart.setHours(0, 0, 0, 0);

  const previousStart = new Date(currentStart);
  previousStart.setDate(currentStart.getDate() - days);

  const previousEnd = new Date(currentStart.getTime() - 1);

  return {
    current: { start: currentStart, end: now },
    previous: { start: previousStart, end: previousEnd },
    fetchStart: previousStart,
    days
  };
}

function getCustomDateRange(dateFrom, dateTo) {
  const currentStart = new Date(dateFrom + 'T00:00:00');
  const currentEnd = new Date(dateTo + 'T23:59:59');
  const days = Math.round((currentEnd - currentStart) / (1000 * 60 * 60 * 24)) + 1;

  const previousEnd = new Date(currentStart.getTime() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousEnd.getDate() - (days - 1));
  previousStart.setHours(0, 0, 0, 0);

  return {
    current: { start: currentStart, end: currentEnd },
    previous: { start: previousStart, end: previousEnd },
    fetchStart: previousStart,
    days
  };
}

// ─── Data processing ──────────────────────────────────────────────────────────
function buildChartBuckets(orders, period, currentStart, currentEnd) {
  const buckets = {};

  if (period === 'day') {
    for (let h = 0; h < 24; h++) {
      buckets[`${String(h).padStart(2, '0')}:00`] = { revenue: 0, orders: 0 };
    }
    orders.forEach(o => {
      const key = `${String(new Date(o.created_at).getHours()).padStart(2, '0')}:00`;
      if (buckets[key]) {
        buckets[key].revenue += parseFloat(o.total || 0);
        buckets[key].orders += 1;
      }
    });
  } else {
    // day-by-day buckets: works for week, month, and custom ranges
    const days = period === 'week' ? 7 : period === 'month' ? 30
      : Math.round((currentEnd - currentStart) / (1000 * 60 * 60 * 24)) + 1;

    for (let i = 0; i < days; i++) {
      const d = new Date(currentStart);
      d.setDate(currentStart.getDate() + i);
      const key = d.toISOString().split('T')[0];
      buckets[key] = { revenue: 0, orders: 0 };
    }
    orders.forEach(o => {
      const key = o.created_at.split('T')[0];
      if (buckets[key]) {
        buckets[key].revenue += parseFloat(o.total || 0);
        buckets[key].orders += 1;
      }
    });
  }

  return buckets;
}

function getTopProducts(orders, limit = 8) {
  const map = {};
  orders.forEach(order => {
    (order.products || []).forEach(item => {
      const id = item.product_id || item.variant_id || item.name;
      if (!map[id]) {
        map[id] = { name: item.name || `Producto ${id}`, quantity: 0, revenue: 0 };
      }
      map[id].quantity += parseInt(item.quantity || 0);
      map[id].revenue += parseFloat(item.price || 0) * parseInt(item.quantity || 0);
    });
  });

  return Object.values(map)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, limit);
}

function getShippingBreakdown(orders) {
  const counts = { unpacked: 0, ready_to_ship: 0, shipped: 0, delivered: 0, undeliverable: 0 };
  orders.forEach(o => {
    const s = o.shipping_status || 'unpacked';
    if (counts.hasOwnProperty(s)) counts[s]++;
    else counts.unpacked++;
  });
  return counts;
}

function getCustomerStats(currentOrders, previousOrders) {
  const prevIds = new Set(previousOrders.filter(o => o.customer?.id).map(o => o.customer.id));
  const seen = new Set();
  let newC = 0, returningC = 0;

  currentOrders.forEach(o => {
    if (!o.customer?.id) return;
    const id = o.customer.id;
    if (seen.has(id)) return;
    seen.add(id);
    prevIds.has(id) ? returningC++ : newC++;
  });

  return { new: newC, returning: returningC };
}

function pctChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return parseFloat(((current - previous) / previous * 100).toFixed(1));
}

function isValidOrder(o) {
  return o.status !== 'cancelled';
}

function isPaidOrder(o) {
  return isValidOrder(o) && ['paid', 'authorized'].includes(o.payment_status);
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  const { date_from, date_to } = req.query;
  const isCustom = date_from && date_to && /^\d{4}-\d{2}-\d{2}$/.test(date_from) && /^\d{4}-\d{2}-\d{2}$/.test(date_to);
  const period = isCustom ? 'custom' : (['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'week');
  const cacheKey = isCustom ? `dashboard_custom_${date_from}_${date_to}` : `dashboard_${period}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json({ ...cached, fromCache: true });

  try {
    const ranges = isCustom ? getCustomDateRange(date_from, date_to) : getDateRanges(period);

    const allOrders = await fetchAllPages('/orders', {
      created_at_min: ranges.fetchStart.toISOString(),
      created_at_max: ranges.current.end.toISOString()
    });

    const currentOrders = allOrders.filter(o => new Date(o.created_at) >= ranges.current.start);
    const previousOrders = allOrders.filter(o => {
      const d = new Date(o.created_at);
      return d >= ranges.previous.start && d < ranges.current.start;
    });

    const validCurrent = currentOrders.filter(isValidOrder);
    const validPrevious = previousOrders.filter(isValidOrder);
    const paidCurrent = currentOrders.filter(isPaidOrder);
    const paidPrevious = previousOrders.filter(isPaidOrder);

    const currentRevenue = paidCurrent.reduce((s, o) => s + parseFloat(o.total || 0), 0);
    const shippingCostOwner = validCurrent.reduce((s, o) => s + parseFloat(o.shipping_cost_owner || 0), 0);
    const shippingCostCustomer = validCurrent.reduce((s, o) => s + parseFloat(o.shipping_cost_customer || 0), 0);
    const unitsSold = validCurrent.reduce((s, o) => s + (o.products || []).reduce((ps, p) => ps + (p.quantity || 0), 0), 0);
    const previousRevenue = paidPrevious.reduce((s, o) => s + parseFloat(o.total || 0), 0);
    const avgTicket = validCurrent.length > 0 ? currentRevenue / validCurrent.length : 0;
    const prevAvgTicket = validPrevious.length > 0 ? previousRevenue / validPrevious.length : 0;

    const buckets = buildChartBuckets(paidCurrent, period, ranges.current.start, ranges.current.end);
    const topProducts = getTopProducts(validCurrent);
    const shipping = getShippingBreakdown(validCurrent);
    const customers = getCustomerStats(validCurrent, validPrevious);
    const currency = allOrders[0]?.currency || 'ARS';

    const recentOrders = [...validCurrent]
      .sort((a, b) => {
        const aPending = a.payment_status === 'pending' ? 1 : 0;
        const bPending = b.payment_status === 'pending' ? 1 : 0;
        if (aPending !== bPending) return aPending - bPending;
        return new Date(b.created_at) - new Date(a.created_at);
      })
      .slice(0, 15)
      .map(o => ({
        id: o.id,
        number: o.number,
        customer: o.customer?.name || 'Invitado',
        email: o.customer?.email || '',
        total: parseFloat(o.total || 0),
        currency: o.currency || currency,
        status: o.status,
        payment_status: o.payment_status,
        shipping_status: o.shipping_status || 'unpacked',
        created_at: o.created_at
      }));

    const result = {
      period,
      ...(isCustom && { date_from, date_to }),
      days_in_period: ranges.days,
      currency,
      fetched_at: new Date().toISOString(),
      summary: {
        revenue: currentRevenue,
        previous_revenue: previousRevenue,
        revenue_change: pctChange(currentRevenue, previousRevenue),
        orders: validCurrent.length,
        previous_orders: validPrevious.length,
        orders_change: pctChange(validCurrent.length, validPrevious.length),
        avg_ticket: avgTicket,
        previous_avg_ticket: prevAvgTicket,
        avg_ticket_change: pctChange(avgTicket, prevAvgTicket),
        new_customers: customers.new,
        returning_customers: customers.returning,
        shipping_cost_owner: shippingCostOwner,
        shipping_cost_customer: shippingCostCustomer,
        units_sold: unitsSold
      },
      sales_chart: {
        labels: Object.keys(buckets),
        revenue: Object.values(buckets).map(b => parseFloat(b.revenue.toFixed(2))),
        orders: Object.values(buckets).map(b => b.orders)
      },
      top_products: topProducts,
      shipping_status: shipping,
      customer_stats: customers,
      recent_orders: recentOrders
    };

    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Error API Tienda Nube:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Error al obtener datos de Tienda Nube',
      details: err.response?.data || err.message
    });
  }
});

// ─── Meta Ads helpers ────────────────────────────────────────────────────────
function metaDateParams(period, dateFrom, dateTo) {
  if (period === 'custom' && dateFrom && dateTo) {
    return { time_range: JSON.stringify({ since: dateFrom, until: dateTo }) };
  }
  const presets = { day: 'today', week: 'last_7d', month: 'last_30d' };
  return { date_preset: presets[period] || 'last_7d' };
}

async function metaGet(path, params = {}) {
  try {
    const resp = await axios.get(`${META_BASE}${path}`, {
      params: { ...params, access_token: META_TOKEN },
      timeout: 20000
    });
    return resp.data;
  } catch (err) {
        if (err.response?.status === 429) {
      await new Promise(r => setTimeout(r, 3000));
      return metaGet(path, params);
    }
    throw err;
  }
}

function extractAction(actions, types) {
  if (!Array.isArray(actions)) return 0;
  return actions
    .filter(a => types.includes(a.action_type))
    .reduce((s, a) => s + parseFloat(a.value || 0), 0);
}

function extractRoas(purchase_roas) {
  if (!Array.isArray(purchase_roas) || !purchase_roas.length) return 0;
  return parseFloat(purchase_roas[0]?.value || 0);
}

// ─── Meta Ads route ───────────────────────────────────────────────────────────
app.get('/api/meta', async (req, res) => {
  const { date_from, date_to } = req.query;
  const isCustom = date_from && date_to;
  const period = isCustom ? 'custom' : (['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'week');
  const cacheKey = isCustom ? `meta_custom_${date_from}_${date_to}` : `meta_${period}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json({ ...cached, fromCache: true });

  if (!META_TOKEN || !META_ACCOUNT) {
    return res.status(503).json({ error: 'Credenciales de Meta Ads no configuradas' });
  }

  const dateParams = metaDateParams(period, date_from, date_to);

  try {
    const INSIGHT_FIELDS = 'spend,impressions,reach,clicks,ctr,cpc,cpm,actions,action_values,purchase_roas';

    // Account-level summary + daily breakdown in parallel
    const [summaryResp, dailyResp, campaignsResp] = await Promise.all([
      metaGet(`/${META_ACCOUNT}/insights`, {
        fields: INSIGHT_FIELDS,
        level: 'account',
        ...dateParams
      }),
      metaGet(`/${META_ACCOUNT}/insights`, {
        fields: 'spend,impressions,clicks,actions,purchase_roas,action_values',
        level: 'account',
        time_increment: 1,
        ...dateParams
      }),
      metaGet(`/${META_ACCOUNT}/campaigns`, {
        fields: `name,status,effective_status,insights.fields(${INSIGHT_FIELDS})`,
        limit: 50,
        ...dateParams
      })
    ]);

    // Summary KPIs
    const s = summaryResp?.data?.[0] || {};
    const PURCHASE_TYPES = ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase'];

    const summary = {
      spend:       parseFloat(s.spend || 0),
      impressions: parseInt(s.impressions || 0),
      reach:       parseInt(s.reach || 0),
      clicks:      parseInt(s.clicks || 0),
      ctr:         parseFloat(s.ctr || 0),
      cpc:         parseFloat(s.cpc || 0),
      cpm:         parseFloat(s.cpm || 0),
      purchases:   extractAction(s.actions, PURCHASE_TYPES),
      revenue:     extractAction(s.action_values, PURCHASE_TYPES),
      roas:        extractRoas(s.purchase_roas)
    };

    // Daily data for chart
    const daily = (dailyResp?.data || []).map(d => ({
      date:        d.date_start,
      spend:       parseFloat(d.spend || 0),
      impressions: parseInt(d.impressions || 0),
      clicks:      parseInt(d.clicks || 0),
      purchases:   extractAction(d.actions, PURCHASE_TYPES),
      roas:        extractRoas(d.purchase_roas)
    })).sort((a, b) => a.date.localeCompare(b.date));

    // Campaigns breakdown
    const campaigns = (campaignsResp?.data || [])
      .map(c => {
        const ci = c.insights?.data?.[0] || {};
        return {
          id:           c.id,
          name:         c.name,
          status:       c.effective_status || c.status,
          spend:        parseFloat(ci.spend || 0),
          impressions:  parseInt(ci.impressions || 0),
          clicks:       parseInt(ci.clicks || 0),
          ctr:          parseFloat(ci.ctr || 0),
          cpc:          parseFloat(ci.cpc || 0),
          purchases:    extractAction(ci.actions, PURCHASE_TYPES),
          roas:         extractRoas(ci.purchase_roas)
        };
      })
      .filter(c => c.spend > 0 || c.status === 'ACTIVE')
      .sort((a, b) => b.spend - a.spend);

    const result = {
      period,
      ...(isCustom && { date_from, date_to }),
      fetched_at: new Date().toISOString(),
      summary,
      daily,
      campaigns
    };

    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Error API Meta Ads:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Error al obtener datos de Meta Ads',
      details: err.response?.data?.error?.message || err.message
    });
  }
});

// ─── Config endpoint ─────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    comision_promedio: COMISION_PROMEDIO,
    plan_tienda_nube:  PLAN_TIENDA_NUBE
  });
});

// ─── Dolar Blue FX ───────────────────────────────────────────────────────────
app.get('/api/fx', async (req, res) => {
  const cached = getCached('fx_blue', FX_CACHE_TTL);
  if (cached) return res.json({ ...cached, fromCache: true });

  try {
    const resp = await axios.get('https://dolarapi.com/v1/dolares/blue', { timeout: 8000 });
    const result = {
      compra:     resp.data.compra,
      venta:      resp.data.venta,
      fetched_at: new Date().toISOString()
    };
    setCache('fx_blue', result);
    res.json(result);
  } catch (err) {
    // Si falla, devolver un fallback en lugar de romper el dashboard
    console.error('Error dolarapi:', err.message);
    res.status(200).json({ compra: null, venta: null, error: err.message });
  }
});

// ─── Mercado Libre helpers ────────────────────────────────────────────────────
async function mlRefreshToken() {
  const resp = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
    params: {
      grant_type:    'refresh_token',
      client_id:     ml.clientId,
      client_secret: ml.clientSecret,
      refresh_token: ml.refreshToken
    },
    timeout: 10000
  });
  ml.accessToken  = resp.data.access_token;
  ml.refreshToken = resp.data.refresh_token;
  console.log('ML token renovado OK');
}

async function mlGet(path, params = {}, retry = true) {
  try {
    const resp = await axios.get(`https://api.mercadolibre.com${path}`, {
      headers: { Authorization: `Bearer ${ml.accessToken}` },
      params,
      timeout: 20000
    });
    return resp.data;
  } catch (err) {
    if (err.response?.status === 401 && retry) {
      await mlRefreshToken();
      return mlGet(path, params, false);
    }
    if (err.response?.status === 429) {
      await new Promise(r => setTimeout(r, 2500));
      return mlGet(path, params, retry);
    }
    throw err;
  }
}

async function mlFetchOrders(dateFrom, dateTo) {
  const all = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const data = await mlGet('/orders/search', {
      seller:                      ml.userId,
      'order.date_created.from':   dateFrom,
      'order.date_created.to':     dateTo,
      sort:                        'date_desc',
      limit,
      offset
    });

    const results = data?.results || [];
    all.push(...results);

    const total = data?.paging?.total || 0;
    offset += results.length;
    if (results.length < limit || offset >= total || offset >= 1000) break;
  }

  return all;
}

function mlDateParams(period, dateFrom, dateTo) {
  if (period === 'custom' && dateFrom && dateTo) {
    return {
      from: `${dateFrom}T00:00:00.000-03:00`,
      to:   `${dateTo}T23:59:59.000-03:00`
    };
  }
  const now   = new Date();
  const toStr = now.toISOString().replace('Z', '-03:00');

  const days = period === 'day' ? 1 : period === 'week' ? 7 : 30;
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  from.setHours(0, 0, 0, 0);

  return {
    from: from.toISOString().replace('Z', '-03:00'),
    to:   toStr
  };
}

// ─── Mercado Libre route ──────────────────────────────────────────────────────
app.get('/api/mercadolibre', async (req, res) => {
  const { date_from, date_to } = req.query;
  const isCustom = date_from && date_to && /^\d{4}-\d{2}-\d{2}$/.test(date_from) && /^\d{4}-\d{2}-\d{2}$/.test(date_to);
  const period   = isCustom ? 'custom' : (['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'week');
  const cacheKey = isCustom ? `ml_custom_${date_from}_${date_to}` : `ml_${period}`;
  const cached   = getCached(cacheKey);
  if (cached) return res.json({ ...cached, fromCache: true });

  if (!ml.clientId || !ml.accessToken) {
    return res.status(503).json({ error: 'Credenciales de Mercado Libre no configuradas' });
  }

  try {
    const { from, to } = mlDateParams(period, date_from, date_to);
    const orders = await mlFetchOrders(from, to);

    const paidOrders = orders.filter(o => o.status === 'paid');

    const revenue = paidOrders.reduce((s, o) => s + (o.total_amount || 0), 0);
    const ordersCount = paidOrders.length;
    const avgTicket = ordersCount > 0 ? revenue / ordersCount : 0;

    const unitsSold = paidOrders.reduce((s, o) =>
      s + (o.order_items || []).reduce((ps, i) => ps + (i.quantity || 0), 0), 0);

    const shippingCost = paidOrders.reduce((s, o) =>
      s + (o.shipping?.cost || 0), 0);

    // Comisión estimada: 13% sobre revenue (incluye comisión ML + Mercado Pago)
    const COMISION_ML = 0.13;
    const comisiones = revenue * COMISION_ML;

    // Productos más vendidos
    const productMap = {};
    paidOrders.forEach(o => {
      (o.order_items || []).forEach(item => {
        const title = item.item?.title || 'Producto desconocido';
        const id    = item.item?.id || title;
        if (!productMap[id]) productMap[id] = { name: title, quantity: 0, revenue: 0 };
        productMap[id].quantity += item.quantity || 0;
        productMap[id].revenue  += (item.unit_price || 0) * (item.quantity || 0);
      });
    });
    const topProducts = Object.values(productMap)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 8);

    // Órdenes recientes (las últimas 10, todas)
    const recentOrders = orders.slice(0, 10).map(o => ({
      id:       o.id,
      buyer:    o.buyer?.nickname || 'Comprador',
      total:    o.total_amount || 0,
      status:   o.status,
      date:     o.date_created
    }));

    // Sales chart: buckets diarios (o por hora si period=day)
    const chartBuckets = {};
    if (period === 'day') {
      for (let h = 0; h < 24; h++) {
        chartBuckets[`${String(h).padStart(2, '0')}:00`] = { revenue: 0, orders: 0 };
      }
      paidOrders.forEach(o => {
        const key = `${String(new Date(o.date_created).getHours()).padStart(2, '0')}:00`;
        if (chartBuckets[key]) {
          chartBuckets[key].revenue += o.total_amount || 0;
          chartBuckets[key].orders  += 1;
        }
      });
    } else {
      const { from: fromStr } = mlDateParams(period, date_from, date_to);
      const startDate = new Date(fromStr);
      startDate.setHours(0, 0, 0, 0);
      const days = period === 'week' ? 7 : period === 'month' ? 30
        : Math.round((new Date(to) - startDate) / 86400000) + 1;
      for (let i = 0; i < days; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        chartBuckets[d.toISOString().split('T')[0]] = { revenue: 0, orders: 0 };
      }
      paidOrders.forEach(o => {
        const key = (o.date_created || '').split('T')[0];
        if (chartBuckets[key]) {
          chartBuckets[key].revenue += o.total_amount || 0;
          chartBuckets[key].orders  += 1;
        }
      });
    }

    const result = {
      period,
      ...(isCustom && { date_from, date_to }),
      fetched_at: new Date().toISOString(),
      summary: {
        revenue,
        orders:        ordersCount,
        avg_ticket:    avgTicket,
        units_sold:    unitsSold,
        shipping_cost: shippingCost,
        comisiones_ml: comisiones
      },
      sales_chart: {
        labels:  Object.keys(chartBuckets),
        revenue: Object.values(chartBuckets).map(b => parseFloat(b.revenue.toFixed(2))),
        orders:  Object.values(chartBuckets).map(b => b.orders)
      },
      top_products:   topProducts,
      recent_orders:  recentOrders
    };

    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Error API Mercado Libre:', err.response?.data || err.message);
    res.status(500).json({
      error:   'Error al obtener datos de Mercado Libre',
      details: err.response?.data?.message || err.message
    });
  }
});

app.post('/api/refresh', (req, res) => {
  cache.clear();
  res.json({ ok: true, message: 'Cache limpiado' });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('\n  PUR Nootropics Dashboard');
  console.log(`  http://localhost:${PORT}\n`);
});
