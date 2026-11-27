const finite = n => typeof n === 'number' && Number.isFinite(n);
const ratio = (a, b, scale = 1) => finite(a) && finite(b) && b > 0 ? a / b * scale : null;

function adPerformance(a) {
  const available = a.available !== false;
  const cost = available && finite(a.cost) ? a.cost : null;
  const revenue = available && finite(a.total_amount) ? a.total_amount : null;
  const sales = available && finite(a.advertising_items_quantity) ? a.advertising_items_quantity : null;
  return {
    spend: cost, revenue, sales,
    impressions: available && finite(a.prints) ? a.prints : null,
    clicks: available && finite(a.clicks) ? a.clicks : null,
    roas: ratio(revenue, cost), acos: ratio(cost, revenue, 100),
    ctr: available ? ratio(a.clicks, a.prints, 100) : null,
    cpc: available ? ratio(cost, a.clicks) : null,
    cpm: available ? ratio(cost, a.prints, 1000) : null,
    cvr: available ? ratio(sales, a.clicks, 100) : null,
    cpa: ratio(cost, sales),
    units: available && finite(a.direct_units_quantity) && finite(a.indirect_units_quantity)
      ? a.direct_units_quantity + a.indirect_units_quantity : null,
    direct_revenue: available && finite(a.direct_amount) ? a.direct_amount : null,
    indirect_revenue: available && finite(a.indirect_amount) ? a.indirect_amount : null
  };
}

function performance(report, traffic, ads) {
  const s = report.summary, a = adPerformance(ads);
  const visits = traffic?.available && finite(traffic.visits) ? traffic.visits : null;
  const complete = finite(s.profit);
  const costs = complete ? s.revenue - s.profit : null;
  const beforeAds = complete && finite(a.spend) ? s.profit + a.spend : null;
  const active = (ads.campaigns || []).filter(c => c.status === 'active');
  return {
    revenue: s.revenue, gross: s.gross, refunds: s.refunds,
    orders: s.orders, units: s.units, visits,
    visit_conversion: ratio(s.orders, visits, 100),
    visits_per_order: ratio(visits, s.orders),
    revenue_per_visit: ratio(s.revenue, visits),
    profit_per_visit: ratio(s.profit, visits),
    avg_ticket: ratio(s.revenue, s.orders), units_per_order: ratio(s.units, s.orders),
    profit: s.profit, margin: ratio(s.profit, s.revenue, 100),
    profit_per_order: ratio(s.profit, s.orders), profit_per_unit: ratio(s.profit, s.units),
    roi: ratio(s.profit, costs, 100), before_ads: beforeAds,
    before_ads_margin: ratio(beforeAds, s.revenue, 100),
    break_even_roas: ratio(s.revenue, beforeAds),
    costs, costs_pct: ratio(costs, s.revenue, 100),
    fees_pct: complete ? ratio(s.fees, s.revenue, 100) : null,
    cogs_pct: complete ? ratio(s.cogs, s.revenue, 100) : null,
    shipping_pct: complete ? ratio(s.shipping, s.revenue, 100) : null,
    extra_pct: complete ? ratio(s.extra, s.revenue, 100) : null,
    refunds_pct: ratio(s.refunds, s.gross, 100),
    cancelled: s.cancelled,
    cancellation_rate: ratio(s.cancelled, s.total_orders ?? s.orders + s.cancelled, 100),
    roas_total: ratio(s.revenue, a.spend), tacos: ratio(a.spend, s.revenue, 100),
    ad_spend_per_order: ratio(a.spend, s.orders),
    active_campaigns: ads.available ? active.length : null,
    daily_budget: ads.available && active.every(c => finite(c.daily_budget))
      ? active.reduce((sum, c) => sum + c.daily_budget, 0) : null,
    advertising: a,
    campaigns: (ads.campaigns || []).map(c => ({ ...c, performance: adPerformance(c) })),
    scope: 'Resultado y margen operativos después de publicidad, comisiones, mercadería, envío y gastos cargados; antes de impuestos, Full y gastos no cargados.',
    attribution_note: 'Ventas Ads: productos distintos vendidos tras un clic, con atribución de hasta 14 días. No son compradores únicos ni necesariamente órdenes. No se suman otra vez a las ventas del canal.',
    traffic_note: 'Conversión de visitas estimada = órdenes pagadas / visitas a publicaciones. Las visitas usan las fechas calendario del recurso de Mercado Libre; las órdenes usan UTC−03. No son personas únicas y pueden actualizarse con demora.'
  };
}
module.exports = { performance, adPerformance };
