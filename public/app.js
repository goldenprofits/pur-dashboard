'use strict';

// ─── Config ───────────────────────────────────────────────────────────────────
const SHIPPING_LABELS = {
  unpacked: 'Sin empaquetar',
  ready_to_ship: 'Listo para enviar',
  shipped: 'En camino',
  delivered: 'Entregado',
  undeliverable: 'No entregable'
};

const SHIPPING_COLORS = {
  unpacked: '#64748b',
  ready_to_ship: '#f59e0b',
  shipped: '#3b82f6',
  delivered: '#10b981',
  undeliverable: '#ef4444'
};

const STATUS_LABELS = {
  open: 'Abierta',
  closed: 'Cerrada',
  cancelled: 'Cancelada'
};

const PAYMENT_LABELS = {
  paid: 'Pagado',
  pending: 'Pendiente',
  authorized: 'Autorizado',
  refunded: 'Reembolsado',
  voided: 'Anulado',
  in_mediation: 'En mediación',
  rejected: 'Rechazado'
};

// ─── State ────────────────────────────────────────────────────────────────────
let currentPeriod   = 'week';
let customDateFrom  = null;
let customDateTo    = null;
let displayCurrency = 'ARS';   // 'ARS' | 'USD'
let exchangeRate    = 1;        // dolar blue venta (ARS por 1 USD)
let dashData        = null;     // última respuesta de /api/dashboard
let metaData        = null;     // última respuesta de /api/meta
let mlData          = null;     // última respuesta de /api/mercadolibre
let currency        = 'ARS';   // moneda nativa de TN
let charts          = {};
let appConfig       = { comision_promedio: 0.05, plan_tienda_nube: 24999 };
let rankingView     = 'combined'; // 'combined' | 'tn' | 'ml'

// ─── Currency helpers ─────────────────────────────────────────────────────────

// Convierte un valor en ARS → moneda de display
function convARS(v) {
  if (displayCurrency === 'USD' && exchangeRate > 1) return v / exchangeRate;
  return v;
}

// Convierte un valor en USD → moneda de display
function convUSD(v) {
  if (displayCurrency === 'ARS' && exchangeRate > 1) return v * exchangeRate;
  return v;
}

// Formatea valor en ARS según moneda de display
function fmtMoney(arsVal) {
  const v = convARS(arsVal);
  if (displayCurrency === 'USD') return fmtRawUSD(v);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS',
    minimumFractionDigits: 0, maximumFractionDigits: 0
  }).format(v || 0);
}

// Formatea valor en USD según moneda de display
function fmtAdsMoney(usdVal) {
  const v = convUSD(usdVal);
  if (displayCurrency === 'ARS') {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS',
      minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(v || 0);
  }
  return fmtRawUSD(usdVal);
}

// Siempre USD (para etiquetas internas de Meta)
function fmtRawUSD(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(value || 0);
}

function fmtMoneyShort(arsVal) {
  const v = convARS(arsVal);
  const sym = displayCurrency === 'USD' ? '$' : '$';
  if (v >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${sym}${(v / 1_000).toFixed(0)}K`;
  return `${sym}${Math.round(v)}`;
}

function fmtAdsMoneyShort(usdVal) {
  const v = convUSD(usdVal);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(displayCurrency === 'USD' ? 2 : 0)}`;
}

function fmtNumber(n) {
  return new Intl.NumberFormat('es-AR').format(n || 0);
}

function fmtNumberShort(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtLabel(label, period) {
  if (period === 'day') return label;
  const parts = label.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
  return label;
}

function fmtDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function truncate(str, max) {
  return str && str.length > max ? str.slice(0, max) + '…' : str;
}

function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function gradient(ctx, color) {
  const g = ctx.createLinearGradient(0, 0, 0, 220);
  g.addColorStop(0, color + '55');
  g.addColorStop(1, color + '00');
  return g;
}

function el(id) { return document.getElementById(id); }

// ─── Preset date-range helper ─────────────────────────────────────────────────
function getPresetDateRange(preset) {
  const now  = new Date();
  const pad  = n => String(n).padStart(2, '0');
  const fmt  = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const today = fmt(now);

  switch (preset) {
    case 'today':     return null; // uses period=day (hourly buckets)
    case 'yesterday': {
      const y = new Date(now); y.setDate(now.getDate() - 1);
      const s = fmt(y); return { from: s, to: s };
    }
    case 'this-week': {
      const diff = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const mon  = new Date(now); mon.setDate(now.getDate() - diff);
      return { from: fmt(mon), to: today };
    }
    case 'last-week': {
      const diff    = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const thisMon = new Date(now); thisMon.setDate(now.getDate() - diff);
      const lastSun = new Date(thisMon); lastSun.setDate(thisMon.getDate() - 1);
      const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
      return { from: fmt(lastMon), to: fmt(lastSun) };
    }
    case 'this-month':
      return { from: `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`, to: today };
    case 'last-month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last  = new Date(first.getTime() - 1);
      const lfst  = new Date(last.getFullYear(), last.getMonth(), 1);
      return { from: fmt(lfst), to: fmt(last) };
    }
    case 'this-year':
      return { from: `${now.getFullYear()}-01-01`, to: today };
    default: return null;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Period dropdown
  const dropdown = el('periodDropdown');
  const trigger  = el('periodTrigger');
  const menu     = el('periodMenu');

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
    trigger.setAttribute('aria-expanded', dropdown.classList.contains('open'));
  });

  document.addEventListener('click', () => {
    if (dropdown.classList.contains('open')) {
      dropdown.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });

  menu.addEventListener('click', e => {
    const opt = e.target.closest('.period-option');
    if (!opt) return;
    e.stopPropagation();

    document.querySelectorAll('.period-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    el('periodLabel').textContent = opt.textContent;
    dropdown.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');

    el('dateFrom').value = '';
    el('dateTo').value   = '';
    el('dateRangePicker').classList.remove('active');

    const preset = opt.dataset.period;
    const range  = getPresetDateRange(preset);
    if (range === null) {
      currentPeriod  = 'day';
      customDateFrom = null;
      customDateTo   = null;
    } else {
      currentPeriod  = 'custom';
      customDateFrom = range.from;
      customDateTo   = range.to;
    }
    loadDashboard();
  });

  // Date range picker
  el('dateFrom').addEventListener('change', updatePickerState);
  el('dateTo').addEventListener('change', updatePickerState);

  el('applyDateRange').addEventListener('click', () => {
    const from = el('dateFrom').value;
    const to   = el('dateTo').value;
    if (!from || !to) return;
    if (from > to) { alert('La fecha de inicio debe ser anterior a la fecha de fin.'); return; }
    customDateFrom = from;
    customDateTo   = to;
    currentPeriod  = 'custom';
    document.querySelectorAll('.period-option').forEach(o => o.classList.remove('active'));
    el('periodLabel').textContent = `${fmtDate(from)} → ${fmtDate(to)}`;
    loadDashboard();
  });

  const today = new Date().toISOString().split('T')[0];
  el('dateFrom').max = today;
  el('dateTo').max   = today;

  // Currency toggle
  document.querySelectorAll('.currency-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.currency === displayCurrency) return;
      document.querySelectorAll('.currency-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      displayCurrency = btn.dataset.currency;
      rerenderAll();
    });
  });

  // Ranking tabs
  document.getElementById('rankingTabs')?.addEventListener('click', e => {
    const tab = e.target.closest('.ranking-tab');
    if (!tab || !tab.dataset.source) return;
    updateRanking(tab.dataset.source);
  });

  // Refresh
  el('refreshBtn').addEventListener('click', async () => {
    el('refreshBtn').classList.add('spinning');
    await fetch('/api/refresh', { method: 'POST' });
    await loadDashboard();
    el('refreshBtn').classList.remove('spinning');
  });

  loadDashboard();
});

function updatePickerState() {
  const from = el('dateFrom').value;
  const to   = el('dateTo').value;
  if (from) el('dateTo').min = from;
  el('dateRangePicker').classList.toggle('active', !!(from && to));
  el('applyDateRange').disabled = !(from && to);
}

// ─── Re-render without re-fetch (used on currency switch) ─────────────────────
function rerenderAll() {
  if (dashData) {
    renderKPIs(dashData.summary);
    renderSalesChart(dashData.sales_chart, dashData.period, dashData.date_from, dashData.date_to);
    renderProductsChart(dashData.top_products);
    renderOrdersTable(dashData.recent_orders);
  }
  if (metaData) {
    renderMeta(metaData);
  }
  if (mlData) {
    renderML(mlData);
    renderMLSalesChart(mlData.sales_chart, mlData.period, mlData.date_from, mlData.date_to);
  }
  if (dashData && mlData) {
    renderUnitsCompare();
  }
  if (dashData && metaData) {
    renderRentabilidad();
  }
  if (dashData) {
    renderRentabilidadPorCanal();
    renderIndicadoresClave();
    updateRanking(rankingView);
  }
}

// ─── Config Loading ───────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const resp = await fetch('/api/config');
    if (resp.ok) appConfig = await resp.json();
  } catch { /* usa defaults */ }
}

// ─── FX Loading ───────────────────────────────────────────────────────────────
async function loadFx() {
  try {
    const resp = await fetch('/api/fx');
    const data = await resp.json();
    if (data.venta) {
      exchangeRate = data.venta;
      el('tcLabel').textContent = `TC: $${Math.round(data.venta).toLocaleString('es-AR')}`;
    } else {
      el('tcLabel').textContent = 'TC: N/D';
    }
  } catch {
    el('tcLabel').textContent = 'TC: N/D';
  }
}

// ─── Data Loading ─────────────────────────────────────────────────────────────
async function loadDashboard() {
  await Promise.all([loadFx(), loadConfig()]);
  loadMeta();       // corre en paralelo con su propio estado
  loadML();         // corre en paralelo con su propio estado
  showLoading();

  try {
    let url;
    if (currentPeriod === 'custom' && customDateFrom && customDateTo) {
      url = `/api/dashboard?date_from=${customDateFrom}&date_to=${customDateTo}`;
    } else {
      url = `/api/dashboard?period=${currentPeriod}`;
    }
    const resp = await fetch(url);
    if (!resp.ok) { const e = await resp.json(); throw new Error(e.details || e.error || `HTTP ${resp.status}`); }
    dashData = await resp.json();
    currency = dashData.currency || 'ARS';
    renderDashboard(dashData);
    showContent();
  } catch (err) {
    showError(err.message);
  }
}

// ─── Render Tienda Nube ───────────────────────────────────────────────────────
function renderDashboard(data) {
  renderKPIs(data.summary);
  renderSalesChart(data.sales_chart, data.period, data.date_from, data.date_to);
  renderShippingChart(data.shipping_status);
  renderProductsChart(data.top_products);
  renderCustomersChart(data.customer_stats);
  renderOrdersTable(data.recent_orders);

  const d = new Date(data.fetched_at);
  el('lastUpdated').textContent =
    `Actualizado: ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
  el('ordersTableBadge').textContent = `${data.recent_orders.length} órdenes`;
}

// KPI Cards
function renderKPIs(s) {
  el('kpiRevenue').textContent    = fmtMoney(s.revenue);
  el('kpiOrders').textContent     = fmtNumber(s.orders);
  el('kpiAvgTicket').textContent  = fmtMoney(s.avg_ticket);
  el('kpiNewCustomers').textContent = fmtNumber(s.new_customers);

  setChange('kpiRevenueChange', s.revenue_change, 'vs período anterior');
  setChange('kpiOrdersChange',  s.orders_change,  'vs período anterior');
  setChange('kpiTicketChange',  s.avg_ticket_change, 'vs período anterior');
  el('kpiReturningCustomers').textContent = `${s.returning_customers} recurrentes`;
}

function setChange(id, pct, label) {
  const e   = el(id);
  const num = parseFloat(pct);
  const arrow = num > 0 ? '↑' : num < 0 ? '↓' : '→';
  const cls   = num > 0 ? 'positive' : num < 0 ? 'negative' : 'neutral';
  e.textContent = `${arrow} ${Math.abs(num)}% ${label}`;
  e.className = `kpi-change ${cls}`;
}

// Sales Chart
function renderSalesChart(chart, period, dateFrom, dateTo) {
  let subtitle;
  if (period === 'custom' && dateFrom && dateTo) {
    subtitle = `Por día — ${fmtDate(dateFrom)} al ${fmtDate(dateTo)}`;
  } else {
    subtitle = { day: 'Por hora — hoy', week: 'Por día — últimos 7 días', month: 'Por día — últimos 30 días' }[period] || '';
  }
  el('salesChartSubtitle').textContent = subtitle;

  destroyChart('salesChart');
  const ctx = el('salesChart').getContext('2d');
  const revenueData = chart.revenue.map(v => convARS(v));

  charts.sales = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chart.labels.map(l => fmtLabel(l, period)),
      datasets: [
        {
          label: 'Ingresos',
          data: revenueData,
          borderColor: '#9d5df0',
          backgroundColor: gradient(ctx, '#9d5df0'),
          borderWidth: 2,
          pointRadius: chart.labels.length > 20 ? 0 : 3,
          pointHoverRadius: 5,
          tension: 0.3,
          fill: true,
          yAxisID: 'y'
        },
        {
          label: 'Órdenes',
          data: chart.orders,
          borderColor: '#3b82f6',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: chart.labels.length > 20 ? 0 : 3,
          pointHoverRadius: 5,
          tension: 0.3,
          fill: false,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1d2e', borderColor: '#252a42', borderWidth: 1,
          titleColor: '#e2e8f0', bodyColor: '#8892a4', padding: 12,
          callbacks: {
            label: ctx => {
              if (ctx.datasetIndex === 0) return ` Ingresos: ${fmtMoney(chart.revenue[ctx.dataIndex])}`;
              return ` Órdenes: ${ctx.parsed.y}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: '#1e2236' }, ticks: { color: '#4a5568', font: { size: 11 }, maxTicksLimit: 10 } },
        y: {
          position: 'left', grid: { color: '#1e2236' },
          ticks: { color: '#4a5568', font: { size: 11 }, callback: v => fmtMoneyShort(displayCurrency === 'USD' ? v * exchangeRate : v) }
        },
        y1: {
          position: 'right', grid: { drawOnChartArea: false },
          ticks: { color: '#4a5568', font: { size: 11 }, stepSize: 1 }
        }
      }
    }
  });
}

// Shipping Chart
function renderShippingChart(status) {
  const entries = Object.entries(status).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  el('shippingTotal').textContent = `${total} órdenes en total`;

  destroyChart('shippingChart');
  const ctx = el('shippingChart').getContext('2d');
  charts.shipping = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: entries.map(([k]) => SHIPPING_LABELS[k] || k),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map(([k]) => SHIPPING_COLORS[k] || '#888'),
        borderColor: '#131626', borderWidth: 3, hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1d2e', borderColor: '#252a42', borderWidth: 1,
          callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} (${((ctx.parsed / total) * 100).toFixed(1)}%)` }
        }
      }
    }
  });

  el('shippingLegend').innerHTML = entries.map(([k, v]) => `
    <div class="shipping-item">
      <span class="shipping-dot" style="background:${SHIPPING_COLORS[k] || '#888'}"></span>
      <span class="shipping-label">${SHIPPING_LABELS[k] || k}</span>
      <span class="shipping-value">${v}</span>
      <span class="shipping-pct">${total > 0 ? ((v / total) * 100).toFixed(0) : 0}%</span>
    </div>
  `).join('');
}

// Top Products Chart
function renderProductsChart(products) {
  destroyChart('productsChart');
  if (!products.length) return;

  const ctx = el('productsChart').getContext('2d');
  charts.products = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: products.map(p => truncate(p.name, 28)),
      datasets: [
        {
          label: 'Unidades',
          data: products.map(p => p.quantity),
          backgroundColor: 'rgba(124, 58, 237, 0.7)', borderColor: '#7c3aed',
          borderWidth: 1, borderRadius: 4, yAxisID: 'y'
        },
        {
          label: 'Ingresos',
          data: products.map(p => convARS(p.revenue)),
          backgroundColor: 'rgba(59, 130, 246, 0.4)', borderColor: '#3b82f6',
          borderWidth: 1, borderRadius: 4, yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1d2e', borderColor: '#252a42', borderWidth: 1,
          callbacks: {
            label: ctx => {
              if (ctx.datasetIndex === 0) return ` Unidades: ${ctx.parsed.y}`;
              return ` Ingresos: ${fmtMoney(products[ctx.dataIndex].revenue)}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#4a5568', font: { size: 11 } } },
        y:  { position: 'left',  grid: { color: '#1e2236' }, ticks: { color: '#4a5568', font: { size: 11 }, stepSize: 1 } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#4a5568', font: { size: 11 }, callback: v => fmtMoneyShort(displayCurrency === 'USD' ? v * exchangeRate : v) } }
      }
    }
  });
}

// ─── Product Ranking ──────────────────────────────────────────────────────────
const PRODUCT_EMOJIS = [
  ['cordyceps', '⚡'],
  ['melena', '🧠'],
  ['lion', '🧠'],
  ['reishi', '🌙'],
  ['ashwagandha', '⚖️'],
  ['creatina', '💪'],
  ['creatine', '💪'],
  ['colageno', '✨'],
  ['collagen', '✨'],
  ['pasta', '🦷'],
  ['dental', '🦷'],
];

function getProductEmoji(name) {
  const n = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [key, emoji] of PRODUCT_EMOJIS) {
    if (n.includes(key)) return emoji;
  }
  return '📦';
}

function normalizeProductKey(name) {
  const n = (name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n.includes('cordyceps'))                          return 'Cordyceps';
  if (n.includes('melena') || n.includes('lion'))       return 'Melena de León';
  if (n.includes('reishi'))                             return 'Reishi';
  if (n.includes('ashwagandha'))                        return 'Ashwagandha';
  if (n.includes('creatina') || n.includes('creatine')) return 'Creatina';
  if (n.includes('colag') || n.includes('collag'))      return 'Colágeno';
  if (n.includes('pasta') || n.includes('dental'))      return 'Pasta Dental';
  return name;
}

function getRankingProducts(source) {
  const tnProds = (dashData?.top_products || []);
  const mlProds = (mlData?.top_products   || []);

  const addTicket = p => ({ ...p, canal: source === 'tn' ? 'tn' : 'ml', avg_ticket: p.quantity > 0 ? p.revenue / p.quantity : 0 });
  if (source === 'tn') return tnProds.map(addTicket);
  if (source === 'ml') return mlProds.map(addTicket);

  // Combined: merge by normalized product key tracking canal
  const map = {};
  tnProds.forEach(p => {
    const key = normalizeProductKey(p.name);
    if (!map[key]) map[key] = { name: key, quantity: 0, revenue: 0, qty_tn: 0, qty_ml: 0 };
    map[key].quantity += p.quantity || 0;
    map[key].revenue  += p.revenue  || 0;
    map[key].qty_tn   += p.quantity || 0;
  });
  mlProds.forEach(p => {
    const key = normalizeProductKey(p.name);
    if (!map[key]) map[key] = { name: key, quantity: 0, revenue: 0, qty_tn: 0, qty_ml: 0 };
    map[key].quantity += p.quantity || 0;
    map[key].revenue  += p.revenue  || 0;
    map[key].qty_ml   += p.quantity || 0;
  });
  return Object.values(map).map(p => {
    const canal = p.qty_tn === 0 ? 'ml' : p.qty_ml === 0 ? 'tn' : 'both';
    return { ...p, canal, avg_ticket: p.quantity > 0 ? p.revenue / p.quantity : 0 };
  });
}

function updateRanking(source) {
  rankingView = source;
  document.querySelectorAll('.ranking-tab').forEach(t => {
    t.classList.toggle('ranking-tab--active', t.dataset.source === source);
  });
  const subtitles = { combined: 'Tienda Nube + Mercado Libre', tn: 'Solo Tienda Nube', ml: 'Solo Mercado Libre' };
  const sub = el('rankingSubtitle');
  if (sub) sub.textContent = subtitles[source] || '';
  renderProductRanking(getRankingProducts(source));
}

function renderProductRanking(products) {
  const section = el('productRankingSection');
  const body    = el('productRankingBody');
  if (!products || !products.length) { section.style.display = 'none'; return; }

  const sorted       = [...products].sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = sorted.reduce((s, p) => s + p.revenue, 0);
  const maxRevenue   = sorted[0].revenue;
  const maxUnits     = Math.max(...sorted.map(p => p.quantity));
  const MEDALS       = ['🥇', '🥈', '🥉'];

  el('rankingBadge').textContent = `${sorted.length} productos`;

  body.innerHTML = sorted.map((p, i) => {
    const revPct     = totalRevenue > 0 ? ((p.revenue / totalRevenue) * 100).toFixed(1) : 0;
    const revBarPct  = maxRevenue   > 0 ? ((p.revenue / maxRevenue)   * 100).toFixed(1) : 0;
    const unitBarPct = maxUnits     > 0 ? ((p.quantity / maxUnits)    * 100).toFixed(1) : 0;
    const emoji      = getProductEmoji(p.name);
    const medal      = i < 3 ? MEDALS[i] : `<span class="rank-num">${i + 1}</span>`;
    const topCls     = i === 0 ? ' ranking-row--top' : '';
    const avgTicket  = p.avg_ticket || (p.quantity > 0 ? p.revenue / p.quantity : 0);
    const canalBadge = p.canal === 'tn'   ? '<span class="canal-badge canal-tn">TN</span>'
                     : p.canal === 'ml'   ? '<span class="canal-badge canal-ml">ML</span>'
                     : '<span class="canal-badge canal-both">TN+ML</span>';

    return `
      <div class="ranking-row${topCls}">
        <div class="ranking-medal">${medal}</div>
        <div class="ranking-product">
          <span class="ranking-emoji">${emoji}</span>
          <div class="ranking-info">
            <span class="ranking-name" title="${esc(p.name)}">${esc(p.name)} ${canalBadge}</span>
            <div class="ranking-bar-wrap">
              <div class="ranking-bar ranking-bar--rev" style="width:${revBarPct}%"></div>
            </div>
          </div>
        </div>
        <div class="ranking-units">
          <span class="ranking-units-val">${fmtNumber(p.quantity)}</span>
          <span class="ranking-units-label">unidades</span>
          <div class="ranking-bar-wrap ranking-bar-wrap--sm">
            <div class="ranking-bar ranking-bar--units" style="width:${unitBarPct}%"></div>
          </div>
        </div>
        <div class="ranking-revenue">
          <span class="ranking-rev-val">${fmtMoney(p.revenue)}</span>
          <span class="ranking-rev-pct">${revPct}% del total</span>
        </div>
        <div class="ranking-ticket">
          <span class="ranking-rev-val">${avgTicket > 0 ? fmtMoney(avgTicket) : '—'}</span>
          <span class="ranking-rev-pct">ticket prom.</span>
        </div>
      </div>
    `;
  }).join('');

  section.style.display = 'block';
}

// Customers Chart
function renderCustomersChart(stats) {
  destroyChart('customersChart');
  const total = stats.new + stats.returning;
  const ctx = el('customersChart').getContext('2d');
  charts.customers = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Nuevos', 'Recurrentes'],
      datasets: [{
        data: [stats.new, stats.returning],
        backgroundColor: ['#10b981', '#7c3aed'],
        borderColor: '#131626', borderWidth: 3, hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1d2e', borderColor: '#252a42', borderWidth: 1,
          callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} (${total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0}%)` }
        }
      }
    }
  });

  el('customersLegend').innerHTML = [
    { label: 'Nuevos', value: stats.new, color: '#10b981' },
    { label: 'Recurrentes', value: stats.returning, color: '#7c3aed' }
  ].map(({ label, value, color }) => `
    <div class="shipping-item">
      <span class="shipping-dot" style="background:${color}"></span>
      <span class="shipping-label">${label}</span>
      <span class="shipping-value">${value}</span>
      <span class="shipping-pct">${total > 0 ? ((value / total) * 100).toFixed(0) : 0}%</span>
    </div>
  `).join('');
}

// Orders Table
function renderOrdersTable(orders) {
  const tbody = el('ordersTableBody');
  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#4a5568;padding:32px">Sin órdenes en este período</td></tr>';
    return;
  }
  // Pre-calcular costos promedio para Revenue Neto
  const avgShipARS      = dashData ? (dashData.summary.shipping_cost_owner || 0) / Math.max(dashData.summary.orders, 1) : 0;
  const metaPerOrderARS = (metaData && dashData && exchangeRate > 1)
    ? metaData.summary.spend * exchangeRate / Math.max(dashData.summary.orders, 1) : 0;

  tbody.innerHTML = orders.map(o => {
    const date = new Date(o.created_at);
    const dateStr = date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) +
                    ' ' + date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const netARS = o.total
      - o.total * appConfig.comision_promedio
      - avgShipARS
      - (o.units || 0) * 2200
      - metaPerOrderARS;
    const netDisp  = convARS(netARS);
    const netColor = netDisp >= 0 ? 'var(--green)' : 'var(--red)';
    const netFmt   = displayCurrency === 'USD' ? fmtRawUSD(netDisp) : new Intl.NumberFormat('es-AR', { style:'currency', currency:'ARS', minimumFractionDigits:0, maximumFractionDigits:0 }).format(netDisp);
    return `
      <tr>
        <td><span class="order-number">#${o.number || o.id}</span></td>
        <td>
          <div class="order-customer">${esc(o.customer)}</div>
          ${o.email ? `<div class="order-email">${esc(o.email)}</div>` : ''}
        </td>
        <td><span class="order-total">${fmtMoney(o.total)}</span></td>
        <td style="font-weight:600;color:var(--text-muted);text-align:center">${o.units != null ? o.units : '—'}</td>
        <td style="font-weight:700;color:${netColor};white-space:nowrap">${netFmt}</td>
        <td><span class="status-badge status--${o.payment_status}">${PAYMENT_LABELS[o.payment_status] || o.payment_status}</span></td>
        <td><span class="status-badge ship--${o.shipping_status}">${SHIPPING_LABELS[o.shipping_status] || o.shipping_status}</span></td>
        <td><span class="status-badge status--${o.status}">${STATUS_LABELS[o.status] || o.status}</span></td>
        <td><span class="order-date">${dateStr}</span></td>
      </tr>
    `;
  }).join('');
}

// ─── Rentabilidad ─────────────────────────────────────────────────────────────
function renderRentabilidad() {
  if (!dashData || !metaData) return;

  // ── Valores base (siempre en ARS nativo o USD nativo) ──────────────────────
  const revenueTN    = dashData.summary.revenue;   // ARS
  const revenueML    = mlData ? mlData.summary.revenue : 0;  // ARS
  const revenue      = revenueTN + revenueML;
  const orders       = dashData.summary.orders + (mlData ? mlData.summary.orders : 0);
  const spend        = metaData.summary.spend;     // USD
  const daysInPeriod = dashData.days_in_period || 30;

  // Comisión Pago Nube: % sobre ingresos TN
  const comisionARS   = revenueTN * appConfig.comision_promedio;
  // Comisiones ML (ya en ARS)
  const comisionML    = mlData ? mlData.summary.comisiones_ml : 0;
  const shippingOwner = dashData.summary.shipping_cost_owner || 0;
  const unitsSoldTN   = dashData.summary.units_sold || 0;
  const unitsSoldML   = mlData ? mlData.summary.units_sold : 0;
  const cogsTN  = dashData.summary.cogs_calculado || 0;
  const cogsML  = (mlData?.summary?.cogs_calculado) || 0;
  const cogsARS = cogsTN + cogsML;
  // ML Product Ads spend (ARS, si está disponible)
  const mlAdsARS = (mlData?.advertising?.spend) || 0;

  // Plan TN: $24.999/mes prorrateado por días del período (en ARS)
  const planARS = (appConfig.plan_tienda_nube / 30) * daysInPeriod;

  // ── Convertir TODO a moneda de display ─────────────────────────────────────
  const revDisplay        = convARS(revenue);
  const adsDisplay        = convUSD(spend);
  const mlAdsDisplay      = convARS(mlAdsARS);
  const comisionDisplay   = convARS(comisionARS);
  const comisionMLDisplay = convARS(comisionML);
  const planDisplay       = convARS(planARS);
  const shippingDisplay   = convARS(shippingOwner);
  const cogsDisplay       = convARS(cogsARS);

  const totalCosts = adsDisplay + mlAdsDisplay + comisionDisplay + comisionMLDisplay + planDisplay + shippingDisplay + cogsDisplay;
  const gain       = revDisplay - totalCosts;
  const roas       = adsDisplay > 0 ? revDisplay / adsDisplay : 0;
  const margin     = revDisplay > 0 ? (gain / revDisplay) * 100 : 0;
  const cac        = orders > 0 ? adsDisplay / orders : 0;

  // ── Formateador según moneda activa ────────────────────────────────────────
  const fmt = displayCurrency === 'USD'
    ? fmtRawUSD
    : v => new Intl.NumberFormat('es-AR', {
        style: 'currency', currency: 'ARS',
        minimumFractionDigits: 0, maximumFractionDigits: 0
      }).format(v);

  // ── Renderizar tarjetas de costos ──────────────────────────────────────────
  el('profRevenue').textContent  = fmt(revDisplay);
  // Nota de desglose TN + ML si hay datos ML
  if (mlData && revenueML > 0) {
    el('profitSubtitle').textContent =
      `TN ${fmt(convARS(revenueTN))} + ML ${fmt(convARS(revenueML))} · Comisiones ML incluidas`;
  } else {
    el('profitSubtitle').textContent = 'Ingresos vs inversión publicitaria';
  }

  // Ads: Meta + ML Product Ads (si está disponible)
  const totalAdsDisplay = adsDisplay + mlAdsDisplay;
  el('profAds').textContent = fmt(totalAdsDisplay);
  if (mlAdsARS > 0) {
    el('profAdsNote').textContent = `Meta ${fmt(adsDisplay)} + ML Ads ${fmt(mlAdsDisplay)}`;
  } else {
    el('profAdsNote').textContent = displayCurrency === 'ARS' && exchangeRate > 1
      ? `USD ${fmtRawUSD(spend)} × TC ${Math.round(exchangeRate).toLocaleString('es-AR')}`
      : 'Gasto Meta Ads';
  }

  el('profComision').textContent     = fmt(comisionDisplay);
  el('profComisionNote').textContent =
    `${(appConfig.comision_promedio * 100).toFixed(1)}% s/ ingresos (incl. IVA)`;

  el('profPlan').textContent     = fmt(planDisplay);

  el('profShipping').textContent     = fmt(shippingDisplay);
  el('profCogs').textContent     = fmt(cogsDisplay);
  const totalUnits = unitsSoldTN + unitsSoldML;
  el('profCogsNote').textContent = totalUnits > 0
    ? `${totalUnits} u. (TN ${unitsSoldTN} + ML ${unitsSoldML}) — Pasta $2.200 / Gummies $5.000`
    : 'Sin ventas';

  el('profShippingNote').textContent = orders > 0 ? `Costo real Andreani ( órdenes)` : 'Sin envíos';
  el('profPlanNote').textContent = daysInPeriod >= 28
    ? `Mes completo`
    : `${daysInPeriod} días de ${fmt(convARS(appConfig.plan_tienda_nube))}/mes`;

  // ── Renderizar tarjetas de resultados ──────────────────────────────────────
  el('profGain').textContent    = fmt(gain);
  el('profGainNote').textContent = gain >= 0
    ? `Ingr. − Ads Meta${mlAdsARS > 0 ? ' − Ads ML' : ''} − Com.TN − Com.ML − Plan − Envíos − COGS`
    : '¡Costos mayores a ingresos!';

  el('profRoas').textContent    = roas > 0 ? `${roas.toFixed(2)}x` : '—';
  el('profMargin').textContent  = `${margin.toFixed(1)}%`;
  el('profCac').textContent     = cac > 0 ? fmt(cac) : '—';

  // ── Per-unit metrics ────────────────────────────────────────────────────────
  const totalUnitsAll = unitsSoldTN + unitsSoldML;
  if (totalUnitsAll > 0) {
    el('profRevUnit').textContent  = fmt(revDisplay / totalUnitsAll);
    el('profGainUnit').textContent = fmt(gain / totalUnitsAll);
    el('profCostUnit').textContent = fmt(totalCosts / totalUnitsAll);
    el('profGainUnitCard').classList.toggle('negative', gain < 0);
  } else {
    el('profRevUnit').textContent  = '—';
    el('profGainUnit').textContent = '—';
    el('profCostUnit').textContent = '—';
  }

  // Color ganancia
  el('profitGainCard').classList.toggle('negative', gain < 0);

  // Badge en header de sección
  const badge = el('profitBadge');
  const marginAbs = Math.abs(margin).toFixed(1);
  if (gain >= 0 && margin >= 20) {
    badge.textContent = `Margen ${marginAbs}% — Saludable`;
    badge.className   = 'profit-badge positive';
  } else if (gain >= 0) {
    badge.textContent = `Margen ${marginAbs}% — Ajustado`;
    badge.className   = 'profit-badge positive';
  } else {
    badge.textContent = `Margen −${marginAbs}% — Negativo`;
    badge.className   = 'profit-badge negative';
  }

  el('profitSection').style.display = 'block';
}

// ─── Rentabilidad por Canal ───────────────────────────────────────────────────
function renderRentabilidadPorCanal() {
  if (!dashData) return;

  const fmt = displayCurrency === 'USD'
    ? fmtRawUSD
    : v => new Intl.NumberFormat('es-AR', {
        style: 'currency', currency: 'ARS',
        minimumFractionDigits: 0, maximumFractionDigits: 0
      }).format(v);

  // ── Tienda Nube ─────────────────────────────────────────────────────────────
  const daysInPeriod  = dashData.days_in_period || 30;
  const revenueTN     = dashData.summary.revenue;
  const revTNDisp     = convARS(revenueTN);
  const tnAdsDisp     = metaData ? convUSD(metaData.summary.spend) : 0;
  const tnComDisp     = convARS(revenueTN * appConfig.comision_promedio);
  const tnPlanDisp    = convARS((appConfig.plan_tienda_nube / 30) * daysInPeriod);
  const tnShipDisp    = convARS(dashData.summary.shipping_cost_owner || 0);
  const tnCogsDisp    = convARS(dashData.summary.cogs_calculado || 0);
  const gainTN        = revTNDisp - tnAdsDisp - tnComDisp - tnPlanDisp - tnShipDisp - tnCogsDisp;
  const margTN        = revTNDisp > 0 ? (gainTN / revTNDisp) * 100 : 0;
  const ordsTN        = Math.max(dashData.summary.orders, 1);
  const unitsTN       = Math.max(dashData.summary.units_sold, 1);

  el('canalTNRevenue').textContent  = fmt(revTNDisp);
  el('canalTNAds').textContent      = metaData ? `−${fmt(tnAdsDisp)}` : '—';
  el('canalTNComision').textContent = `−${fmt(tnComDisp)}`;
  el('canalTNPlan').textContent     = `−${fmt(tnPlanDisp)}`;
  el('canalTNShipping').textContent = `−${fmt(tnShipDisp)}`;
  el('canalTNCogs').textContent     = `−${fmt(tnCogsDisp)}`;
  el('canalTNGain').textContent     = fmt(gainTN);
  el('canalTNGain').className       = `canal-gain-value${gainTN < 0 ? ' negative' : ''}`;
  el('canalTNBadge').textContent    = `Margen ${margTN.toFixed(1)}%`;
  el('canalTNMargin').textContent   = `${margTN.toFixed(1)}%`;
  el('canalTNPerOrder').textContent = fmt(gainTN / ordsTN);
  el('canalTNPerUnit').textContent  = dashData.summary.units_sold > 0 ? fmt(gainTN / unitsTN) : '—';

  // ── Mercado Libre ────────────────────────────────────────────────────────────
  const mlCard = el('canalMLCard');
  if (mlData) {
    const revML      = mlData.summary.revenue;
    const revMLDisp  = convARS(revML);
    const mlAdsDisp  = convARS(mlData.advertising?.spend || 0);
    const mlComDisp  = convARS(mlData.summary.comisiones_ml || 0);
    const mlCogsDisp = convARS(mlData.summary.cogs_calculado || 0);
    const gainML     = revMLDisp - mlAdsDisp - mlComDisp - mlCogsDisp;
    const margML     = revMLDisp > 0 ? (gainML / revMLDisp) * 100 : 0;
    const ordsML     = Math.max(mlData.summary.orders, 1);
    const unitsML    = Math.max(mlData.summary.units_sold, 1);

    el('canalMLRevenue').textContent  = fmt(revMLDisp);
    el('canalMLAds').textContent      = (mlData.advertising?.spend || 0) > 0 ? `−${fmt(mlAdsDisp)}` : '—';
    el('canalMLComision').textContent = `−${fmt(mlComDisp)}`;
    el('canalMLCogs').textContent     = `−${fmt(mlCogsDisp)}`;
    el('canalMLGain').textContent     = fmt(gainML);
    el('canalMLGain').className       = `canal-gain-value${gainML < 0 ? ' negative' : ''}`;
    el('canalMLBadge').textContent    = `Margen ${margML.toFixed(1)}%`;
    el('canalMLMargin').textContent   = `${margML.toFixed(1)}%`;
    el('canalMLPerOrder').textContent = fmt(gainML / ordsML);
    el('canalMLPerUnit').textContent  = mlData.summary.units_sold > 0 ? fmt(gainML / unitsML) : '—';
    if (mlCard) mlCard.style.opacity = '1';
  } else {
    if (mlCard) mlCard.style.opacity = '0.35';
  }

  el('rentabilidadCanalSection').style.display = 'block';
}

// ─── Indicadores Clave ────────────────────────────────────────────────────────
function renderIndicadoresClave() {
  if (!dashData) return;
  const section = el('indicadoresSection');

  // Tasa de conversión Meta
  if (metaData) {
    const clicks    = metaData.summary.clicks    || 0;
    const purchases = metaData.summary.purchases || 0;
    const convRate  = clicks > 0 ? (purchases / clicks * 100) : 0;
    el('indConvRate').textContent = clicks > 0 ? `${convRate.toFixed(2)}%` : '—';
  }

  // Costo por unidad vendida
  if (metaData) {
    const spend     = metaData.summary.spend || 0;
    const unitsTN   = dashData.summary.units_sold || 0;
    const unitsML   = mlData ? mlData.summary.units_sold : 0;
    const totalU    = unitsTN + unitsML;
    const adsDisp   = convUSD(spend);
    const fmtI      = displayCurrency === 'USD'
      ? fmtRawUSD
      : v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
    el('indCostPerUnit').textContent = totalU > 0 ? fmtI(adsDisp / totalU) : '—';
  }

  // Envíos gratis vs pagos (TN)
  const freeShip  = dashData.summary.free_shipping_orders || 0;
  const paidShip  = dashData.summary.paid_shipping_orders || 0;
  const totalShip = freeShip + paidShip;
  if (totalShip > 0) {
    const freePct = ((freeShip / totalShip) * 100).toFixed(0);
    el('indFreeShipping').textContent     = String(freeShip);
    el('indFreeShippingNote').textContent = `${freePct}% del total · ${paidShip} pagos`;
  } else {
    el('indFreeShipping').textContent     = '—';
    el('indFreeShippingNote').textContent = 'Sin órdenes';
  }

  // Promedio costo de envío TN
  const avgShip = dashData.summary.avg_shipping_cost_owner || 0;
  el('indAvgShipping').textContent = fmtMoney(avgShip);

  // Tasa cancelación ML
  if (mlData) {
    const cancelled = mlData.summary.cancelled_orders || 0;
    const totalML   = mlData.summary.total_orders     || 0;
    const rate      = totalML > 0 ? (cancelled / totalML * 100) : 0;
    el('indMLCancelRate').textContent = totalML > 0 ? `${rate.toFixed(1)}%` : '—';
    el('indMLCancelNote').textContent = totalML > 0
      ? `${cancelled} canceladas de ${totalML} totales` : 'Sin datos ML';
  } else {
    el('indMLCancelRate').textContent = '—';
    el('indMLCancelNote').textContent = 'Sin datos ML';
  }

  renderRevenueChannelChart();
  section.style.display = 'block';
}

function renderRevenueChannelChart() {
  const revTN = dashData?.summary?.revenue || 0;
  const revML = mlData?.summary?.revenue   || 0;
  const total = revTN + revML;

  destroyChart('revenueChannelChart');
  if (total === 0) return;

  const ctx = el('revenueChannelChart').getContext('2d');
  charts.revenueChannel = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Tienda Nube', 'Mercado Libre'],
      datasets: [{
        data: [revTN, revML],
        backgroundColor: ['rgba(78,205,196,0.8)', 'rgba(255,230,0,0.8)'],
        borderColor: '#131626', borderWidth: 3, hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1d2e', borderColor: '#252a42', borderWidth: 1,
          callbacks: {
            label: ctx => {
              const raw = displayCurrency === 'USD' ? ctx.parsed : ctx.parsed;
              return ` ${ctx.label}: ${fmtMoney(raw)} (${total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0}%)`;
            }
          }
        }
      }
    }
  });

  el('revenueChannelLegend').innerHTML = [
    { label: 'Tienda Nube', value: revTN, color: '#4ECDC4' },
    { label: 'Mercado Libre', value: revML, color: '#FFE600' }
  ].map(({ label, value, color }) => `
    <div class="shipping-item">
      <span class="shipping-dot" style="background:${color}"></span>
      <span class="shipping-label">${label}</span>
      <span class="shipping-value">${fmtMoney(value)}</span>
      <span class="shipping-pct">${total > 0 ? ((value / total) * 100).toFixed(0) : 0}%</span>
    </div>
  `).join('');
}

// ─── Meta Ads ─────────────────────────────────────────────────────────────────
async function loadMeta() {
  el('metaLoadingState').style.display = 'flex';
  el('metaErrorState').style.display   = 'none';
  el('metaContent').style.display      = 'none';

  try {
    let url;
    if (currentPeriod === 'custom' && customDateFrom && customDateTo) {
      url = `/api/meta?date_from=${customDateFrom}&date_to=${customDateTo}`;
    } else {
      url = `/api/meta?period=${currentPeriod}`;
    }
    const resp = await fetch(url);
    if (!resp.ok) { const e = await resp.json(); throw new Error(e.details || e.error || `HTTP ${resp.status}`); }
    metaData = await resp.json();
    renderMeta(metaData);
    el('metaLoadingState').style.display = 'none';
    el('metaContent').style.display      = 'block';
    if (dashData) renderRentabilidad();
    if (dashData) renderRentabilidadPorCanal();
    if (dashData) renderIndicadoresClave();
  } catch (err) {
    el('metaLoadingState').style.display = 'none';
    el('metaErrorState').style.display   = 'flex';
    el('metaErrorMessage').textContent   = err.message;
  }
}

function renderMeta(data) {
  const s = data.summary;
  el('metaSpend').textContent       = fmtAdsMoney(s.spend);
  el('metaCpm').textContent         = `CPM: ${fmtAdsMoney(s.cpm)}`;
  el('metaImpressions').textContent = fmtNumber(s.impressions);
  el('metaReach').textContent       = `Alcance: ${fmtNumber(s.reach)}`;
  el('metaClicks').textContent      = fmtNumber(s.clicks);
  el('metaCtr').textContent         = `CTR: ${s.ctr.toFixed(2)}%`;
  el('metaCpc').textContent         = fmtAdsMoney(s.cpc);
  el('metaPurchases').textContent   = s.purchases > 0 ? fmtNumber(Math.round(s.purchases)) : '—';
  el('metaRevenue').textContent     = s.revenue > 0 ? `Revenue: ${fmtAdsMoney(s.revenue)}` : 'Sin datos de píxel';
  el('metaRoas').textContent        = s.roas > 0 ? `${s.roas.toFixed(2)}x` : '—';

  renderMetaSpendChart(data.daily, data.period, data.date_from, data.date_to);
  renderMetaClicksChart(data.daily);
  renderMetaCampaigns(data.campaigns);
}

function renderMetaSpendChart(daily, period, dateFrom, dateTo) {
  let subtitle;
  if (period === 'custom' && dateFrom && dateTo) {
    subtitle = `${fmtDate(dateFrom)} al ${fmtDate(dateTo)}`;
  } else {
    subtitle = { day: 'Hoy', week: 'Últimos 7 días', month: 'Últimos 30 días' }[period] || '';
  }
  el('metaChartSubtitle').textContent = subtitle;

  destroyChart('metaSpendChart');
  if (!daily.length) return;

  const spendData = daily.map(d => convUSD(d.spend));
  const labels    = daily.map(d => fmtLabel(d.date, period === 'day' ? 'week' : period));
  const ctx = el('metaSpendChart').getContext('2d');
  const sym = displayCurrency === 'USD' ? '$' : '$';

  charts.metaSpend = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Gasto',
          data: spendData,
          borderColor: '#1877f2',
          backgroundColor: gradient(ctx, '#1877f2'),
          borderWidth: 2,
          pointRadius: daily.length > 20 ? 0 : 3,
          pointHoverRadius: 5,
          tension: 0.3,
          fill: true,
          yAxisID: 'y'
        },
        {
          label: 'ROAS',
          data: daily.map(d => d.roas),
          borderColor: '#f59e0b',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: daily.length > 20 ? 0 : 3,
          pointHoverRadius: 5,
          tension: 0.3,
          fill: false,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1d2e', borderColor: '#252a42', borderWidth: 1,
          titleColor: '#e2e8f0', bodyColor: '#8892a4', padding: 12,
          callbacks: {
            label: ctx => {
              if (ctx.datasetIndex === 0) return ` Gasto: ${fmtAdsMoney(daily[ctx.dataIndex].spend)}`;
              return ` ROAS: ${ctx.parsed.y.toFixed(2)}x`;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: '#1e2236' }, ticks: { color: '#4a5568', font: { size: 11 }, maxTicksLimit: 10 } },
        y: {
          position: 'left', grid: { color: '#1e2236' },
          ticks: { color: '#4a5568', font: { size: 11 }, callback: v => fmtAdsMoneyShort(displayCurrency === 'USD' ? v : v / exchangeRate) }
        },
        y1: {
          position: 'right', grid: { drawOnChartArea: false },
          ticks: { color: '#4a5568', font: { size: 11 }, callback: v => `${v.toFixed(1)}x` }
        }
      }
    }
  });
}

function renderMetaClicksChart(daily) {
  destroyChart('metaClicksChart');
  if (!daily.length) return;

  const labels = daily.map(d => { const p = d.date.split('-'); return `${p[2]}/${p[1]}`; });
  const ctx = el('metaClicksChart').getContext('2d');
  charts.metaClicks = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Clics',
          data: daily.map(d => d.clicks),
          backgroundColor: 'rgba(245,158,11,0.7)', borderColor: '#f59e0b',
          borderWidth: 1, borderRadius: 3, yAxisID: 'y'
        },
        {
          label: 'Impresiones',
          data: daily.map(d => d.impressions),
          backgroundColor: 'rgba(24,119,242,0.25)', borderColor: '#1877f2',
          borderWidth: 1, borderRadius: 3, yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1d2e', borderColor: '#252a42', borderWidth: 1,
          callbacks: {
            label: ctx => {
              if (ctx.datasetIndex === 0) return ` Clics: ${fmtNumber(ctx.parsed.y)}`;
              return ` Impresiones: ${fmtNumber(ctx.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#4a5568', font: { size: 10 }, maxTicksLimit: 10 } },
        y:  { position: 'left',  grid: { color: '#1e2236' }, ticks: { color: '#4a5568', font: { size: 11 } } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#4a5568', font: { size: 11 }, callback: v => fmtNumberShort(v) } }
      }
    }
  });
}

function renderMetaCampaigns(campaigns) {
  el('metaCampaignsBadge').textContent = `${campaigns.length} campañas`;
  const tbody = el('metaCampaignsBody');
  if (!campaigns.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#4a5568;padding:32px">Sin datos de campañas en este período</td></tr>';
    return;
  }
  tbody.innerHTML = campaigns.map(c => {
    const roasCls = c.roas >= 3 ? 'roas--good' : c.roas >= 1 ? 'roas--ok' : c.roas > 0 ? 'roas--bad' : '';
    return `
      <tr>
        <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500" title="${esc(c.name)}">${esc(truncate(c.name, 36))}</td>
        <td><span class="status-badge camp--${c.status}">${c.status}</span></td>
        <td style="font-weight:600">${fmtAdsMoney(c.spend)}</td>
        <td>${fmtNumber(c.impressions)}</td>
        <td>${fmtNumber(c.clicks)}</td>
        <td>${c.ctr.toFixed(2)}%</td>
        <td>${c.cpc > 0 ? fmtAdsMoney(c.cpc) : '—'}</td>
        <td>${c.purchases > 0 ? Math.round(c.purchases) : '—'}</td>
        <td><span class="${roasCls}">${c.roas > 0 ? c.roas.toFixed(2) + 'x' : '—'}</span></td>
      </tr>
    `;
  }).join('');
}

// ─── Unidades + Comparativo ───────────────────────────────────────────────────
function renderUnitsCompare() {
  if (!dashData || !mlData) return;

  const unitsTN    = dashData.summary.units_sold || 0;
  const unitsML    = mlData.summary.units_sold   || 0;
  const unitsTotal = unitsTN + unitsML;

  el('unitsTN').textContent    = fmtNumber(unitsTN);
  el('unitsML').textContent    = fmtNumber(unitsML);
  el('unitsTotal').textContent = fmtNumber(unitsTotal);

  // Gráfico comparativo
  destroyChart('compareChart');
  const ctx = el('compareChart').getContext('2d');

  const revTN  = convARS(dashData.summary.revenue);
  const revML  = convARS(mlData.summary.revenue);
  const ordTN  = dashData.summary.orders;
  const ordML  = mlData.summary.orders;
  const tktTN  = convARS(dashData.summary.avg_ticket);
  const tktML  = convARS(mlData.summary.avg_ticket);

  charts.compare = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Ingresos', 'Órdenes', 'Ticket Prom.'],
      datasets: [
        {
          label: 'Tienda Nube',
          data: [revTN, ordTN, tktTN],
          backgroundColor: 'rgba(78,205,196,0.7)',
          borderColor: '#4ECDC4',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: 'Mercado Libre',
          data: [revML, ordML, tktML],
          backgroundColor: 'rgba(255,230,0,0.7)',
          borderColor: '#FFE600',
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: { color: '#8892a4', font: { size: 11 }, boxWidth: 10 }
        },
        tooltip: {
          backgroundColor: '#1a1d2e', borderColor: '#252a42', borderWidth: 1,
          titleColor: '#e2e8f0', bodyColor: '#8892a4',
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y;
              if (ctx.dataIndex === 0) return ` ${ctx.dataset.label}: ${fmtMoney(displayCurrency === 'USD' ? v * exchangeRate : v)}`;
              if (ctx.dataIndex === 2) return ` ${ctx.dataset.label}: ${fmtMoney(displayCurrency === 'USD' ? v * exchangeRate : v)}`;
              return ` ${ctx.dataset.label}: ${Math.round(v)}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#4a5568', font: { size: 11 } } },
        y: {
          grid: { color: '#1e2236' },
          ticks: { color: '#4a5568', font: { size: 11 }, callback: v => fmtMoneyShort(displayCurrency === 'USD' ? v * exchangeRate : v) }
        }
      }
    }
  });

  el('unitsCompareSection').style.display = 'block';
}

// ML Sales Chart
function renderMLSalesChart(chart, period, dateFrom, dateTo) {
  let subtitle;
  if (period === 'custom' && dateFrom && dateTo) {
    subtitle = `Por día — ${fmtDate(dateFrom)} al ${fmtDate(dateTo)}`;
  } else {
    subtitle = { day: 'Por hora — hoy', week: 'Por día — últimos 7 días', month: 'Por día — últimos 30 días' }[period] || '';
  }
  el('mlChartSubtitle').textContent = subtitle;

  destroyChart('mlSalesChart');
  if (!chart || !chart.labels || !chart.labels.length) return;

  const ctx = el('mlSalesChart').getContext('2d');
  const revenueData = chart.revenue.map(v => convARS(v));

  charts.mlSales = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chart.labels.map(l => fmtLabel(l, period)),
      datasets: [
        {
          label: 'Ingresos',
          data: revenueData,
          borderColor: '#FFE600',
          backgroundColor: gradient(ctx, '#FFE600'),
          borderWidth: 2,
          pointRadius: chart.labels.length > 20 ? 0 : 3,
          pointHoverRadius: 5,
          tension: 0.3,
          fill: true,
          yAxisID: 'y'
        },
        {
          label: 'Órdenes',
          data: chart.orders,
          borderColor: '#f59e0b',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: chart.labels.length > 20 ? 0 : 3,
          pointHoverRadius: 5,
          tension: 0.3,
          fill: false,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1d2e', borderColor: '#252a42', borderWidth: 1,
          titleColor: '#e2e8f0', bodyColor: '#8892a4', padding: 12,
          callbacks: {
            label: ctx => {
              if (ctx.datasetIndex === 0) return ` Ingresos: ${fmtMoney(chart.revenue[ctx.dataIndex])}`;
              return ` Órdenes: ${ctx.parsed.y}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: '#1e2236' }, ticks: { color: '#4a5568', font: { size: 11 }, maxTicksLimit: 10 } },
        y: {
          position: 'left', grid: { color: '#1e2236' },
          ticks: { color: '#4a5568', font: { size: 11 }, callback: v => fmtMoneyShort(displayCurrency === 'USD' ? v * exchangeRate : v) }
        },
        y1: {
          position: 'right', grid: { drawOnChartArea: false },
          ticks: { color: '#4a5568', font: { size: 11 }, stepSize: 1 }
        }
      }
    }
  });
}

// ─── Mercado Libre ────────────────────────────────────────────────────────────
async function loadML() {
  el('mlLoadingState').style.display = 'flex';
  el('mlErrorState').style.display   = 'none';
  el('mlContent').style.display      = 'none';

  try {
    let url;
    if (currentPeriod === 'custom' && customDateFrom && customDateTo) {
      url = `/api/mercadolibre?date_from=${customDateFrom}&date_to=${customDateTo}`;
    } else {
      url = `/api/mercadolibre?period=${currentPeriod}`;
    }
    const resp = await fetch(url);
    if (!resp.ok) { const e = await resp.json(); throw new Error(e.details || e.error || `HTTP ${resp.status}`); }
    mlData = await resp.json();
    renderML(mlData);
    el('mlLoadingState').style.display = 'none';
    el('mlContent').style.display      = 'block';
    tryRenderRentabilidad();
  } catch (err) {
    el('mlLoadingState').style.display = 'none';
    el('mlErrorState').style.display   = 'flex';
    el('mlErrorMessage').textContent   = err.message;
  }
}

const ML_STATUS_LABELS = {
  paid: 'Pagada', cancelled: 'Cancelada', pending: 'Pendiente', confirmed: 'Confirmada'
};

function renderML(data) {
  const s = data.summary;
  el('mlRevenue').textContent    = fmtMoney(s.revenue);
  el('mlOrders').textContent     = fmtNumber(s.orders);
  el('mlUnitsSubtext').textContent = `${fmtNumber(s.units_sold)} unidades`;
  el('mlAvgTicket').textContent  = fmtMoney(s.avg_ticket);
  el('mlUnits').textContent      = fmtNumber(s.units_sold);
  el('mlComisiones').textContent = fmtMoney(s.comisiones_ml);
  el('mlShipping').textContent   = fmtMoney(s.shipping_cost);

  // Publicidad ML Product Ads
  const ads = data.advertising;
  if (ads && ads.available) {
    el('mlAdsSpend').textContent = fmtMoney(ads.spend);
    el('mlAdsNote').textContent  = ads.sales > 0
      ? `${ads.sales} ventas · ROAS ${ads.roas > 0 ? ads.roas.toFixed(2) + 'x' : '—'}`
      : `${fmtNumber(ads.clicks)} clics · ${fmtNumber(ads.impressions)} imp.`;
    el('mlAdsNote').title        = '';
    el('mlAdsNote').style.cursor = 'default';
  } else {
    el('mlAdsSpend').textContent = 'No disponible';
    el('mlAdsNote').textContent  = '⚠ Ver nota';
    el('mlAdsNote').title        = 'La API de Product Ads requiere el scope "write_advertising" habilitado en tu app de ML (developers.mercadolibre.com.ar). Una vez habilitado y re-autenticado, los datos aparecerán aquí automáticamente.';
    el('mlAdsNote').style.cursor = 'help';
  }

  el('mlOrdersBadge').textContent = `${data.recent_orders.length} órdenes`;

  renderMLSalesChart(data.sales_chart, data.period, data.date_from, data.date_to);

  const tbody = el('mlOrdersBody');
  if (!data.recent_orders.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#4a5568;padding:32px">Sin órdenes en este período</td></tr>';
    return;
  }
  tbody.innerHTML = data.recent_orders.map(o => {
    const date   = new Date(o.date);
    const dateStr = date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) +
                    ' ' + date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const statusKey = o.status || 'unknown';
    const statusLabel = ML_STATUS_LABELS[statusKey] || statusKey;
    const statusCls = `ml--${statusKey}`;
    const mlNetARS  = o.total - o.total * 0.13 - (o.units || 0) * 2200;
    const mlNetDisp = convARS(mlNetARS);
    const mlNetColor = mlNetDisp >= 0 ? 'var(--green)' : 'var(--red)';
    const mlNetFmt  = displayCurrency === 'USD' ? fmtRawUSD(mlNetDisp) : new Intl.NumberFormat('es-AR', { style:'currency', currency:'ARS', minimumFractionDigits:0, maximumFractionDigits:0 }).format(mlNetDisp);
    return `
      <tr>
        <td><span class="order-number">#${o.id}</span></td>
        <td><div class="order-customer">${esc(o.buyer)}</div></td>
        <td><span class="order-total">${fmtMoney(o.total)}</span></td>
        <td style="font-weight:600;color:var(--text-muted);text-align:center">${o.units != null ? o.units : '—'}</td>
        <td style="font-weight:700;color:${mlNetColor};white-space:nowrap">${mlNetFmt}</td>
        <td><span class="status-badge ${statusCls}">${statusLabel}</span></td>
        <td><span class="order-date">${dateStr}</span></td>
      </tr>
    `;
  }).join('');
}

// ─── UI State ─────────────────────────────────────────────────────────────────
function showLoading() {
  el('loadingState').style.display    = 'flex';
  el('errorState').style.display      = 'none';
  el('dashboardContent').style.display = 'none';
}

function showContent() {
  el('loadingState').style.display    = 'none';
  el('errorState').style.display      = 'none';
  el('dashboardContent').style.display = 'block';
  if (dashData && mlData)   renderUnitsCompare();
  if (dashData && metaData) renderRentabilidad();
  if (dashData) updateRanking(rankingView);
}

function tryRenderRentabilidad() {
  if (dashData && mlData)   renderUnitsCompare();
  if (dashData && metaData) renderRentabilidad();
  if (dashData) {
    renderRentabilidadPorCanal();
    renderIndicadoresClave();
    updateRanking(rankingView);
  }
}

function showError(msg) {
  el('loadingState').style.display    = 'none';
  el('errorState').style.display      = 'flex';
  el('dashboardContent').style.display = 'none';
  el('errorMessage').textContent = msg;
}

// ─── Chart registry ───────────────────────────────────────────────────────────
function destroyChart(id) {
  const chartMap = {
    salesChart:           'sales',
    shippingChart:        'shipping',
    productsChart:        'products',
    customersChart:       'customers',
    metaSpendChart:       'metaSpend',
    metaClicksChart:      'metaClicks',
    mlSalesChart:         'mlSales',
    compareChart:         'compare',
    revenueChannelChart:  'revenueChannel'
  };
  const k = chartMap[id];
  if (k && charts[k]) { charts[k].destroy(); charts[k] = null; }
}
