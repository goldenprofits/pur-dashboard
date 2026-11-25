const { round, arDate } = require('./ledger');
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0,10) === s;
function validateSnapshot(input, account) {
  if (String(input.account_id) !== String(account).replace(/^act_/, '') || input.currency !== 'USD'
      || !validDate(input.from) || !validDate(input.to) || input.to < input.from
      || !Number.isFinite(Date.parse(input.checked_at)) || !Array.isArray(input.daily) || input.daily.length > 366) throw new Error('Revisión de Meta inválida.');
  const daily = input.daily.map(d => {
    if (!validDate(d.date) || !['spend','impressions','clicks'].every(k => Number.isFinite(d[k]) && d[k]>=0)
        || !['purchases','revenue'].every(k => d[k] === null || (Number.isFinite(d[k]) && d[k]>=0))) throw new Error('Datos diarios de Meta inválidos.');
    return {date:d.date,spend:round(d.spend),impressions:d.impressions,clicks:d.clicks,purchases:d.purchases,revenue:d.revenue};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  const count = (Date.parse(input.to)-Date.parse(input.from))/86400000+1;
  if (daily.length !== count || daily.some((d,i)=>d.date !== new Date(Date.parse(input.from)+i*86400000).toISOString().slice(0,10))) throw new Error('Faltan fechas o hay fechas duplicadas en Meta.');
  const months = new Map();
  for (const d of daily) months.set(d.date.slice(0,7),round((months.get(d.date.slice(0,7))||0)+d.spend));
  if (!Array.isArray(input.months) || input.months.length !== months.size || new Set(input.months.map(m=>m.month)).size !== months.size
      || input.months.some(m=>!months.has(m.month) || round(m.spend)!==months.get(m.month))) throw new Error('El gasto diario no coincide con los totales de Meta.');
  return {account_id:String(input.account_id),currency:'USD',from:input.from,to:input.to,checked_at:input.checked_at,daily,months:input.months.map(m=>({month:m.month,spend:round(m.spend)})),source:'Meta Ads · consulta verificada de la cuenta PÜR'};
}
function recoveredReport(snapshot, query, now = new Date()) {
  if (!snapshot) return null;
  const period = query.date_from && query.date_to ? 'custom' : query.period || 'week';
  const to = query.date_to || arDate(now.toISOString());
  const days = period === 'day' ? 1 : period === 'month' ? 30 : 7;
  const from = query.date_from || new Date(Date.parse(to)-(days-1)*86400000).toISOString().slice(0,10);
  if (!validDate(from) || !validDate(to) || from < snapshot.from || to > snapshot.to || to < from) return null;
  const daily = snapshot.daily.filter(d=>d.date>=from && d.date<=to);
  const sum = k => daily.some(d=>d[k]===null) ? null : round(daily.reduce((n,d)=>n+d[k],0));
  const spend=sum('spend'),impressions=sum('impressions'),clicks=sum('clicks'),purchases=sum('purchases'),revenue=sum('revenue');
  return {period,date_from:from,date_to:to,fetched_at:snapshot.checked_at,recovered:true,currency:'USD',
    source_notice:`Gasto recuperado de Meta, verificado el ${new Date(snapshot.checked_at).toLocaleString('es-AR',{timeZone:'America/Argentina/Cordoba'})}. La conexión automática necesita renovarse. Cobertura: ${snapshot.from} al ${snapshot.to}. Los importes en pesos son una estimación al tipo de cambio mostrado.`,
    summary:{spend,impressions,clicks,reach:null,purchases,revenue,ctr:impressions?clicks/impressions*100:0,cpc:clicks?spend/clicks:0,cpm:impressions?spend/impressions*1000:0,roas:revenue===null?null:spend?revenue/spend:0},
    daily:daily.map(d=>({...d,roas:d.revenue===null?null:d.spend?d.revenue/d.spend:0})),campaigns:[]};
}
module.exports = { validateSnapshot, recoveredReport };
