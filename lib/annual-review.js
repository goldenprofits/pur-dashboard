const { round } = require('./ledger');
function validateReview(input, seller) {
  const { year, from, to, checked_at, months, source_records, seller_id } = input;
  if (String(seller_id) !== String(seller) || !Number.isInteger(year) || year < 2020 || year > 2100
      || from !== `${year}-01-01` || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !to.startsWith(`${year}-`)
      || !Number.isFinite(Date.parse(checked_at)) || !Array.isArray(months) || months.length > 12
      || !Number.isInteger(source_records) || source_records < 0 || input.complete !== true) throw new Error('Revisión anual inválida o incompleta.');
  const seen = new Set();
  const clean = months.map(m => {
    if (!Number.isInteger(m.month) || m.month < 1 || m.month > 12 || seen.has(m.month)
        || !Number.isFinite(m.charges) || m.charges < 0 || !Number.isFinite(m.refunds) || m.refunds < 0) throw new Error('Importes mensuales inválidos.');
    seen.add(m.month);
    return { month: m.month, charges: round(m.charges), refunds: round(m.refunds), net: round(m.charges - m.refunds) };
  }).sort((a,b) => a.month - b.month);
  const required = Number(to.slice(5,7));
  if (clean.length !== required || clean.some((m,i) => m.month !== i+1)) throw new Error('Faltan meses en la revisión anual.');
  const charges = round(clean.reduce((s,m) => s+m.charges,0));
  const refunds = round(clean.reduce((s,m) => s+m.refunds,0));
  return { year, from, to, checked_at, source_records, complete: true, months: clean,
    totals: { charges, refunds, net: round(charges-refunds) },
    source: 'Facturación de Mercado Libre · Product Ads',
    note: 'Importes registrados por fecha de cargo, menos anulaciones y bonificaciones. No equivalen a métricas de rendimiento publicitario. Revisión de conceptos publicitarios de facturas y notas de crédito; cada movimiento se cuenta una sola vez.' };
}
module.exports = { validateReview };
