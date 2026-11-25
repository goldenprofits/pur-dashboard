const $ = id => document.getElementById(id);
const money = n => n === null || n === undefined ? 'Pendiente' : new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(n);
const number = n => new Intl.NumberFormat('es-AR').format(n);
const percent = n => n === null || !Number.isFinite(n) ? '—' : `${n.toFixed(1).replace('.',',')}%`;
const dateLabel = s => new Date(s.slice(0,10)+'T12:00:00-03:00').toLocaleDateString('es-AR',{day:'numeric',month:'short'});
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Date(Date.now()-3*3600000).toISOString().slice(0,10);
const ago = n => new Date(Date.parse(today()+'T03:00:00Z')-n*86400000).toISOString().slice(0,10);
let report, busy = false;
async function request(url,options) {
  const r = await fetch(url,options);
  if(r.status===401){location.href='/login';throw new Error('Tu sesión venció.');}
  const d = await r.json();if(!r.ok)throw new Error(d.error||'No se pudo completar la consulta.');return d;
}
async function load() {
  if(busy)return;busy=true;$('refresh').disabled=true;
  $('message').hidden=false;$('message').className='message';
  $('message').textContent='Consultando ventas, campañas y costos de envío…';$('content').hidden=true;
  try {
    report=await request(`/api/overview?from=${$('from').value}&to=${$('to').value}`);render(report);
    $('message').hidden=true;$('content').hidden=false;
  }catch(e){$('message').textContent=e.message+' Podés volver a intentar con el botón de actualizar.';$('message').className='message error';$('connection').textContent='Revisar conexión';}
  finally{busy=false;$('refresh').disabled=false;}
}
function render(d) {
  const s=d.summary,a=d.ads;
  $('connection').textContent=d.account+' · conectado';
  $('rangeLabel').textContent=`${dateLabel(d.from)} → ${dateLabel(d.to)} ${d.to.slice(0,4)}${d.includes_today?' · hoy parcial':''}`;
  $('updated').textContent='Consultado '+new Date(d.fetched_at).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Argentina/Cordoba'});
  $('revenue').textContent=money(s.revenue);$('revenueNote').textContent=s.refunds?`${money(s.refunds)} descontados por devoluciones`:'Órdenes pagadas, sin cancelaciones';
  $('profit').textContent=money(s.profit);$('profit').classList.toggle('negative',s.profit<0);
  document.querySelector('.metric.profit p').firstChild.textContent=a.needs_verification?'Resultado preliminar ':'Resultado operativo ';
  $('profitNote').textContent=s.profit===null?'Completá los datos pendientes para ver la ganancia.':a.needs_verification?'Revisar publicidad en cero · antes de impuestos y cargos no cargados':`${percent(s.margin)} de margen · antes de impuestos y cargos no cargados`;
  $('spend').textContent=a.needs_verification?'Por verificar':a.available?money(a.cost):'No disponible';
  $('spendNote').textContent=a.available?'Product Ads · gasto del mismo período':'No se considera cero: falta la consulta';
  $('orders').textContent=`${number(s.orders)} / ${number(s.units)}`;
  $('ordersNote').textContent=`${number(s.cancelled)} órdenes canceladas, excluidas`;
  const notes=[...s.missing];if(a.available&&a.cost===0)notes.push('La API de publicidad devolvió $0 en este período. Si Mercado Ads muestra inversión, verificá la cuenta y las fechas antes de tomar este resultado como definitivo.');
  $('warnings').hidden=!notes.length;$('warnings').innerHTML='<strong>'+ (s.profit===null?'Falta completar el resultado':'Para interpretar los números')+'</strong>'+notes.map(n=>`<p>${escape(n)}</p>`).join('');
  const rows=[['Ventas brutas',s.gross],['Devoluciones',-s.refunds],['Comisiones reales de venta',-s.fees],['Envíos a tu cargo',-s.shipping],['Costo del producto',-s.cogs],['Publicidad Product Ads',a.available?-a.cost:null],['Otros gastos cargados',-s.extra]];
  $('breakdown').innerHTML=rows.map(([name,value])=>`<div class="break-row"><span>${name}</span><b>${money(value)}</b></div>`).join('')+`<div class="break-row total"><span>Resultado operativo</span><b class="${s.profit<0?'negative':''}">${money(s.profit)}</b></div>`;
  $('scope').textContent=d.note+` Envíos verificados: ${s.shipping_verified} de ${s.shipping_total}.`;
  const max=Math.max(...d.daily.map(x=>x.revenue),1);
  $('chart').innerHTML=`<span class="chart-max">Máximo diario ${money(max===1?0:max)}</span>`+d.daily.map(x=>`<div class="bar" style="height:${Math.max(x.revenue/max*87,0)}%" title="${dateLabel(x.date)}: ${money(x.revenue)} · ${x.orders} órdenes"></div>`).join('');
  $('chart').setAttribute('aria-label',`Ventas diarias del ${d.from} al ${d.to}. Total ${money(s.revenue)}. Los importes están en la tabla siguiente.`);
  $('chartStart').textContent=dateLabel(d.from);$('chartEnd').textContent=dateLabel(d.to);
  $('dailyRows').innerHTML=d.daily.map(x=>`<tr><td>${dateLabel(x.date)}</td><td>${money(x.revenue)}</td><td>${number(x.orders)}</td></tr>`).join('');
  $('adRevenue').textContent=a.available?money(a.total_amount):'—';
  $('roas').textContent=a.available&&a.cost>0?`${(a.total_amount/a.cost).toFixed(2).replace('.',',')}x`:'—';
  $('acos').textContent=a.available&&a.total_amount>0?percent(a.cost/a.total_amount*100):'—';
  $('tacos').textContent=a.available&&s.revenue>0?percent(a.cost/s.revenue*100):'—';
  $('clicks').textContent=a.available?`${number(a.clicks)} / ${number(a.prints)}`:'—';
  $('adsNote').textContent=a.available?`Cuenta ${a.advertiser} · fuente: API de Product Ads · métricas del ${dateLabel(d.from)} al ${dateLabel(d.to)}.`:a.error;
  $('campaignRows').innerHTML=a.campaigns.length?a.campaigns.map(c=>`<tr><td>${escape(c.name)}<small>${c.id}</small></td><td><span class="badge ${escape(c.status)}">${c.status==='active'?'Activa':c.status==='paused'?'Pausada':escape(c.status)}</span></td><td>${money(c.cost)}</td><td>${money(c.total_amount)}</td><td>${c.cost>0?(c.total_amount/c.cost).toFixed(2)+'x':'—'}</td></tr>`).join(''):`<tr><td colspan="5">${a.available?'Sin campañas en esta cuenta.':'Publicidad no disponible; la ganancia queda pendiente.'}</td></tr>`;
  $('productRows').innerHTML=d.products.length?d.products.map(p=>`<tr><td>${escape(p.name)}<small>${escape(p.id)}</small></td><td>${number(p.quantity)}</td><td>${money(p.revenue)}</td><td>${money(p.cost?.unit_cost)}</td><td>${p.cost?money(p.cogs):'Pendiente'}</td></tr>`).join(''):'<tr><td colspan="5">Sin ventas pagadas en el período.</td></tr>';
  $('costReference').textContent=`Costos vigentes: pasta ${money(d.default_costs?.pasta)} y frasco de gummies ${money(d.default_costs?.gummy)}. Se aplican a todo el período consultado; podés ajustar cada publicación. Para packs, ingresá el costo del pack completo.`;
  const statuses={paid:'Pagada',cancelled:'Cancelada',pending:'Pendiente',confirmed:'Confirmada'};
  $('orderRows').innerHTML=d.recent.length?d.recent.map(o=>`<tr><td>#${escape(o.id)}<small>${dateLabel(o.date)}</small></td><td>${o.products.map(p=>`${p.quantity} × ${escape(p.title)}`).join('<br>')}</td><td><span class="badge ${escape(o.status)}">${escape(statuses[o.status]||o.status)}</span></td><td>${money(o.total)}</td></tr>`).join(''):'<tr><td colspan="4">Sin órdenes en el período.</td></tr>';
}
document.querySelectorAll('[data-days]').forEach(b=>b.addEventListener('click',()=>{
  if(busy)return;const n=b.dataset.days;$('to').value=n==='yesterday'?ago(1):today();
  $('from').value=n==='month'?today().slice(0,8)+'01':n==='yesterday'?ago(1):n==='today'?today():ago(Number(n)-1);
  document.querySelectorAll('[data-days]').forEach(x=>x.classList.toggle('selected',x===b));load();
}));
$('dateForm').addEventListener('submit',e=>{e.preventDefault();document.querySelectorAll('[data-days]').forEach(x=>x.classList.remove('selected'));load();});
$('refresh').addEventListener('click',async()=>{if(busy)return;await request('/api/refresh',{method:'POST'});load();});
function openCosts(){
  if(!report)return;
  $('costInputs').innerHTML=report.products.map(p=>`<div class="cost-input-row"><label for="cost-${escape(p.id)}">${escape(p.name)}<small>${escape(p.id)} · costo por unidad de la publicación</small></label><input id="cost-${escape(p.id)}" data-product="${escape(p.id)}" type="number" min="0" max="100000000" step="0.01" required value="${p.cost?.unit_cost??''}"></div>`).join('');
  $('extraExpense').value=report.expense;$('saveMessage').textContent='';$('costDialog').showModal();
}
$('costButton').addEventListener('click',openCosts);$('costButton2').addEventListener('click',openCosts);
$('closeDialog').addEventListener('click',()=>$('costDialog').close());$('cancelDialog').addEventListener('click',()=>$('costDialog').close());
$('costForm').addEventListener('submit',async e=>{
  e.preventDefault();$('saveCosts').disabled=true;
  const products=[...document.querySelectorAll('[data-product]')].map(x=>({id:x.dataset.product,unit_cost:Number(x.value)}));
  try{await request('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({products,expense:{from:report.from,to:report.to,amount:Number($('extraExpense').value)}})});$('costDialog').close();await load();}
  catch(err){$('saveMessage').textContent=err.message;}finally{$('saveCosts').disabled=false;}
});
$('from').value=ago(29);$('to').value=today();$('from').max=today();$('to').max=today();load();
