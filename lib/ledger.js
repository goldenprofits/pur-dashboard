const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const arDate = d => new Date(Date.parse(d) - 3 * 3600000).toISOString().slice(0, 10);
function ledger(orders, shipping, ads, settings, from, to) {
  const paid = orders.filter(o => o.status === 'paid');
  if (paid.some(o => o.currency_id !== 'ARS')) throw new Error('Hay órdenes en otra moneda. No se pueden sumar con pesos.');
  const products = {}, daily = {}, missing = new Set(), shipments = new Set();
  for (let t = Date.parse(`${from}T03:00:00Z`); t <= Date.parse(`${to}T03:00:00Z`); t += 86400000) {
    daily[arDate(new Date(t).toISOString())] = { revenue: 0, orders: 0 };
  }
  let gross = 0, refunds = 0, fees = 0, cogs = 0, units = 0, shippingCost = 0;
  for (const o of paid) {
    if (!Number.isFinite(o.total_amount)) throw new Error('Una orden no informó su importe.');
    gross += o.total_amount;
    const refund = (o.payments || []).reduce((s, p) => s + Number(p.transaction_amount_refunded || 0), 0);
    refunds += Math.min(refund, o.total_amount);
    const day = arDate(o.date_created);
    if (daily[day]) { daily[day].revenue += o.total_amount - Math.min(refund, o.total_amount); daily[day].orders++; }
    if (refund > 0) missing.add('Hay devoluciones: verificar recupero de comisiones, envío y mercadería.');
    if (o.shipping?.id) shipments.add(o.shipping.id);
    else missing.add('Hay órdenes sin datos de envío: revisar su costo.');
    for (const i of o.order_items || []) {
      const id = i.item?.id, q = Number(i.quantity);
      if (!id || !Number.isFinite(q) || q <= 0) throw new Error('Una orden contiene un producto incompleto.');
      const name = (i.item.title || '').toLowerCase();
      const bundle = /\bx\s*[2-9]\d*\b|\bpack\b|\bcombo\b|\b[2-9]\d*\s*(unidades|frascos|pastas)\b/.test(name);
      const family = !bundle && /pasta/.test(name) ? 'pasta' : !bundle && /gumm|gomita/.test(name) ? 'gummy' : null;
      const familyCost = family ? settings.defaults?.[family] : undefined;
      const cost = settings.products?.[id] || (Number.isFinite(familyCost) ? { unit_cost: familyCost, confirmed: true, source: 'Costo vigente confirmado el 25/11/2026' } : null);
      const p = products[id] ||= { id, name: i.item.title, quantity: 0, revenue: 0, fees: 0, cogs: 0, cost };
      p.quantity += q; units += q;
      p.revenue += Number(i.unit_price) * q;
      // sale_fee is a charge per sold unit, including its fixed charge.
      if (Number.isFinite(i.sale_fee)) { fees += i.sale_fee * q; p.fees += i.sale_fee * q; }
      else missing.add('Faltan comisiones reales en algunas órdenes.');
      const itemCost = p.cost;
      if (itemCost?.confirmed && Number.isFinite(itemCost.unit_cost) && itemCost.unit_cost >= 0) {
        cogs += itemCost.unit_cost * q; p.cogs += itemCost.unit_cost * q;
      } else missing.add('Confirmá el costo de todos los productos vendidos.');
    }
  }
  for (const id of shipments) {
    if (Number.isFinite(shipping[id])) shippingCost += shipping[id];
    else missing.add('Falta el costo real de algunos envíos.');
  }
  if (!ads.available) missing.add('Falta el gasto de publicidad del período.');
  if (ads.needs_verification) missing.add('La publicidad devuelve cero sin corroborar: falta el gasto real antes de calcular la ganancia.');
  const extra = Number(settings.period_expenses?.[`${from}:${to}`] || 0);
  const revenue = gross - refunds, spend = ads.available ? ads.cost : null;
  const knownCost = fees + cogs + shippingCost + (spend || 0) + extra;
  const profit = missing.size ? null : round(revenue - knownCost);
  return { summary: { gross: round(gross), refunds: round(refunds), revenue: round(revenue), orders: paid.length, units,
    cancelled: orders.filter(o => o.status === 'cancelled').length, fees: round(fees), shipping: round(shippingCost),
    cogs: round(cogs), ads: spend, extra, profit, margin: profit !== null && revenue > 0 ? profit / revenue * 100 : null,
    known_balance: round(revenue - knownCost), missing: [...missing], shipping_total: shipments.size,
    shipping_verified: [...shipments].filter(id => Number.isFinite(shipping[id])).length },
    products: Object.values(products).map(p => ({ ...p, revenue: round(p.revenue), fees: round(p.fees), cogs: round(p.cogs) })).sort((a,b) => b.revenue - a.revenue),
    daily: Object.entries(daily).map(([date, values]) => ({ date, ...values, revenue: round(values.revenue) })),
    recent: orders.slice(0, 15).map(o => ({ id: o.id, date: o.date_created, status: o.status, total: o.total_amount,
      products: (o.order_items || []).map(i => ({ title: i.item?.title || '', quantity: i.quantity })) })) };
}
module.exports = { ledger, arDate, round };
