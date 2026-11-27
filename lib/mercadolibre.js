const axios = require('axios');
const store = require('./store');
let tokens = store.read('ml-tokens.json', {
  access_token: process.env.ML_ACCESS_TOKEN,
  refresh_token: process.env.ML_REFRESH_TOKEN,
});
let refreshing;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function refresh(staleToken) {
  if (tokens.access_token !== staleToken) return;
  if (!refreshing) refreshing = (async () => {
    const body = new URLSearchParams({ grant_type: 'refresh_token',
      client_id: process.env.ML_CLIENT_ID, client_secret: process.env.ML_CLIENT_SECRET,
      refresh_token: tokens.refresh_token });
    const { data } = await axios.post('https://api.mercadolibre.com/oauth/token', body,
      { timeout: 20000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    tokens = { access_token: data.access_token, refresh_token: data.refresh_token };
    store.write('ml-tokens.json', tokens);
  })().finally(() => { refreshing = null; });
  return refreshing;
}
async function get(endpoint, params = {}, headers = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const usedToken = tokens.access_token;
    try {
      const { data } = await axios.get(`https://api.mercadolibre.com${endpoint}`, {
        params, headers: { Authorization: `Bearer ${usedToken}`, ...headers }, timeout: 25000,
      });
      return data;
    } catch (e) {
      const status = e.response?.status;
      if (status === 401 && attempt === 0) { await refresh(usedToken); continue; }
      if ((status === 429 || status >= 500) && attempt < 3) { await sleep(700 * 2 ** attempt); continue; }
      const err = new Error(status === 401 ? 'La conexión con Mercado Libre necesita autorización.'
        : `Mercado Libre no respondió a ${endpoint} (${status || 'sin conexión'}).`);
      err.status = status;
      throw err;
    }
  }
}
async function orders(from, to) {
  const start = `${from}T00:00:00.000-03:00`, end = `${to}T23:59:59.999-03:00`;
  async function window(a, b) {
    const params = { seller: process.env.ML_USER_ID, 'order.date_created.from': a,
      'order.date_created.to': b, sort: 'date_desc', limit: 50, offset: 0 };
    const first = await get('/orders/search', params);
    const total = first.paging?.total;
    if (!Number.isFinite(total)) throw new Error('Mercado Libre no informó el total de órdenes.');
    if (total > 1000) {
      const midpoint = Math.floor((Date.parse(a) + Date.parse(b)) / 2);
      if (midpoint <= Date.parse(a)) throw new Error('Demasiadas órdenes en el mismo instante.');
      const l = await window(a, new Date(midpoint).toISOString());
      const r = await window(new Date(midpoint + 1).toISOString(), b);
      return [...l, ...r];
    }
    const all = first.results || [];
    while (all.length < total) {
      const next = await get('/orders/search', { ...params, offset: all.length });
      if (!next.results?.length) throw new Error('La lista de órdenes llegó incompleta. Reintentá actualizar.');
      all.push(...next.results);
    }
    return all;
  }
  const all = await window(start, end);
  return [...new Map(all.map(o => [o.id, o])).values()];
}
const metrics = 'clicks,prints,cost,total_amount,direct_amount,indirect_amount,advertising_items_quantity';
const extraMetrics = ['direct_units_quantity','indirect_units_quantity','direct_items_quantity','indirect_items_quantity'];
const competitionMetrics = ['top_impression_share','lost_impression_share_by_budget','lost_impression_share_by_ad_rank'];
async function ads(from, to) {
  try {
    const data = await get('/advertising/advertisers', { product_id: 'PADS' }, { 'api-version': '1' });
    const advertisers = data.advertisers || [];
    const configured = String(process.env.ML_ADVERTISER_ID || '');
    const advertiser = advertisers.find(a => String(a.advertiser_id) === configured)
      || (advertisers.length === 1 ? advertisers[0] : null);
    if (!advertiser) throw new Error('No se pudo identificar una única cuenta de publicidad.');
    const endpoint = `/advertising/${advertiser.site_id}/advertisers/${advertiser.advertiser_id}/product_ads/campaigns/search`;
    const campaigns = [];
    let offset = 0;
    while (true) {
      const page = await get(endpoint, { date_from: from, date_to: to, metrics: [metrics,...extraMetrics,...competitionMetrics].join(','), limit: 50, offset }, { 'api-version': '2' });
      if (!Array.isArray(page.results) || !Number.isFinite(page.paging?.total)) throw new Error('Respuesta de publicidad incompleta.');
      campaigns.push(...page.results);
      offset += page.results.length;
      if (offset >= page.paging.total) break;
      if (!page.results.length) throw new Error('Faltan campañas de publicidad.');
    }
    const keys = metrics.split(',');
    if (campaigns.some(c => keys.some(k => !Number.isFinite(c.metrics?.[k])))) throw new Error('Faltan métricas de publicidad.');
    const totals = Object.fromEntries(keys.map(k => [k, campaigns.reduce((s, c) => s + c.metrics[k], 0)]));
    for (const key of extraMetrics) totals[key] = campaigns.every(c => Number.isFinite(c.metrics?.[key]))
      ? campaigns.reduce((sum, c) => sum + c.metrics[key], 0) : null;
    return { available: true, needs_verification: false, source: 'Mercado Libre Product Ads', advertiser: advertiser.advertiser_name,
      ...totals, campaigns: campaigns.map(c => ({ id: c.id, name: c.name, status: c.status,
        // Mercado Ads defines `budget` as the configured daily average. The
        // platform's `daily_budget` can differ and must not trigger cap alerts.
        daily_budget: Number.isFinite(c.budget) ? c.budget : null,
        platform_daily_budget: Number.isFinite(c.daily_budget) ? c.daily_budget : null,
        roas_target: Number.isFinite(c.roas_target) ? c.roas_target : null, ...c.metrics })) };
  } catch (e) { return { available: false, error: e.message, campaigns: [] }; }
}
async function visits(from, to) {
  try {
    if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > 150) throw new Error('La API de visitas permite períodos de hasta 150 días.');
    const data = await get(`/users/${process.env.ML_USER_ID}/items_visits`, {
      date_from: `${from}T00:00:00.000-03:00`, date_to: `${to}T23:59:59.999-03:00`
    });
    if (!Number.isInteger(data.total_visits) || data.total_visits < 0) throw new Error('Mercado Libre no informó un total válido de visitas.');
    return { available: true, visits: data.total_visits, from, to, source: 'Mercado Libre · visitas a publicaciones',
      provider_from: data.date_from, provider_to: data.date_to };
  } catch (e) { return { available: false, visits: null, from, to, error: e.message }; }
}
async function shipping(orders) {
  const ids = [...new Set(orders.filter(o => o.status === 'paid').map(o => o.shipping?.id).filter(Boolean))];
  const result = {};
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, async () => {
    while (index < ids.length) {
      const id = ids[index++];
      try {
        const d = await get(`/shipments/${id}/costs`, {}, { 'x-format-new': 'true' });
        const sender = d.senders?.find(s => String(s.user_id) === String(process.env.ML_USER_ID));
        result[id] = Number.isFinite(sender?.cost) ? sender.cost : null;
      } catch { result[id] = null; }
    }
  }));
  return result;
}
module.exports = { get, orders, ads, visits, shipping };
