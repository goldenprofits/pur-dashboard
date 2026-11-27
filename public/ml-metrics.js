(() => {
  const valid = n => typeof n === 'number' && Number.isFinite(n);
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  window.renderMLMetrics = (host, data, options = {}) => {
    const p = data.performance;
    if (!host || !p) return;
    const a = p.advertising;
    const money = options.money || (n => new Intl.NumberFormat('es-AR', { style:'currency', currency:'ARS', maximumFractionDigits:2 }).format(n));
    const format = (value, type = 'number') => !valid(value) ? 'Pendiente'
      : type === 'money' ? money(value)
      : type === 'percent' ? value.toLocaleString('es-AR', { maximumFractionDigits:2 }) + '%'
      : type === 'ratio' ? value.toLocaleString('es-AR', { maximumFractionDigits:2 }) + 'x'
      : value.toLocaleString('es-AR', { maximumFractionDigits:2 });
    const card = ([label,value,type,note]) => `<article class="ml-metric"><p>${escape(label)}</p><strong${valid(value) && value < 0 ? ' class="ml-metric-negative"' : ''}>${escape(format(value,type))}</strong><small>${escape(note || '')}</small></article>`;
    const group = (title,cards) => `<section class="ml-metric-group"><h3>${escape(title)}</h3><div class="ml-metric-grid">${cards.map(card).join('')}</div></section>`;
    const start = data.date_from || data.from, end = data.date_to || data.to;
    const localDate = s => s ? s.slice(0,10).split('-').reverse().join('/') : '—';
    const time = new Date(data.fetched_at).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', timeZone:'America/Argentina/Cordoba' });
    host.innerHTML = `<div class="ml-metrics-heading"><div><h2>Mercado Libre · rendimiento completo</h2><p>${escape(localDate(start))} al ${escape(localDate(end))}${data.includes_today ? ' · hoy parcial' : ''} · corte ${escape(time)} UTC−03</p></div><a href="/mercadolibre">Ver detalle ↗</a></div>
      <div class="ml-metric-grid ml-metric-highlights">${[
        ['ROAS de publicidad',a.roas,'ratio','Ingresos atribuidos a Ads / gasto Ads'],
        ['ROAS total ML',p.roas_total,'ratio','Todas las ventas ML / gasto Ads; incluye ventas orgánicas'],
        ['Conversión de visitas',p.visit_conversion,'percent','Órdenes pagadas / visitas a publicaciones'],
        ['Margen después de Ads',p.margin,'percent','Resultado operativo / ventas; antes de impuestos']
      ].map(card).join('')}</div>
      ${!data.traffic?.available ? `<p class="ml-metric-notice">Visitas y conversión de visitas pendientes: ${escape(data.traffic?.error || 'Mercado Libre todavía no informó estos datos.')}</p>` : ''}
      ${(data.summary.missing || []).length ? `<p class="ml-metric-notice">${(data.summary.missing || []).map(escape).join(' ')}</p>` : ''}
      ${group('Ventas y visitas',[
        ['Ventas totales',p.revenue,'money','Órdenes pagadas, descontando devoluciones'],
        ['Visitas a publicaciones',p.visits,'number','Visitas; no personas únicas'],
        ['Órdenes pagadas',p.orders,'number','Canceladas excluidas'],
        ['Unidades vendidas',p.units,'number','Puede haber varias unidades por orden'],
        ['Ticket promedio',p.avg_ticket,'money','Ventas / órdenes pagadas'],
        ['Unidades por orden',p.units_per_order,'number','Unidades / órdenes pagadas'],
        ['Visitas por orden',p.visits_per_order,'number','Visitas / órdenes pagadas'],
        ['Ingreso por visita',p.revenue_per_visit,'money','Ventas / visitas']
      ])}
      ${group('Publicidad y conversión',[
        ['Gasto en publicidad',a.spend,'money','Gasto efectivo del período'],
        ['Ingresos por Ads',a.revenue,'money','Ya incluidos en ventas totales'],
        ['Impresiones',a.impressions,'number','Veces que se mostraron los anuncios'],
        ['Clics',a.clicks,'number','Entradas desde anuncios; no personas únicas'],
        ['CTR',a.ctr,'percent','Clics / impresiones'],
        ['Costo por clic',a.cpc,'money','Gasto Ads / clics'],
        ['Costo por mil impresiones',a.cpm,'money','Gasto Ads / impresiones × 1.000'],
        ['Conversión de clics Ads',a.cvr,'percent','Ventas atribuidas / clics; puede actualizarse con demora'],
        ['Costo por venta Ads',a.cpa,'money','Gasto Ads / ventas atribuidas'],
        ['ACOS',a.acos,'percent','Gasto Ads / ingresos atribuidos'],
        ['TACOS',p.tacos,'percent','Gasto Ads / todas las ventas ML'],
        ['Ads por orden del canal',p.ad_spend_per_order,'money','Gasto Ads / todas las órdenes pagadas'],
        ['Ventas atribuidas',a.sales,'number','Productos distintos vendidos según atribución Ads'],
        ['Unidades atribuidas',a.units,'number','Unidades directas + indirectas atribuidas']
      ])}
      ${group('Ganancia, margen y costos',[
        ['Resultado operativo',p.profit,'money','Después de Ads y costos cargados'],
        ['Ganancia por orden',p.profit_per_order,'money','Resultado operativo / órdenes pagadas'],
        ['Ganancia por unidad',p.profit_per_unit,'money','Resultado operativo / unidades'],
        ['Ganancia por visita',p.profit_per_visit,'money','Resultado operativo / visitas'],
        ['Resultado antes de Ads',p.before_ads,'money','Resultado operativo + gasto Ads'],
        ['Margen antes de Ads',p.before_ads_margin,'percent','Resultado antes de Ads / ventas'],
        ['ROI operativo',p.roi,'percent','Resultado operativo / costos descontados'],
        ['ROAS de equilibrio estimado',p.break_even_roas,'ratio','Según el margen del mix vendido; no es un objetivo automático'],
        ['Comisiones / ventas',p.fees_pct,'percent','Comisiones reales sobre ingresos'],
        ['Mercadería / ventas',p.cogs_pct,'percent','Costo de productos sobre ingresos'],
        ['Envíos / ventas',p.shipping_pct,'percent','Envío a cargo del vendedor sobre ingresos'],
        ['Otros gastos / ventas',p.extra_pct,'percent','Solo gastos cargados para este período'],
        ['Costo total / ventas',p.costs_pct,'percent','Incluye publicidad y costos descontados'],
        ['Tasa de cancelación',p.cancellation_rate,'percent','Órdenes canceladas / total de órdenes'],
        ['Importe devuelto / ventas',p.refunds_pct,'percent','Devoluciones registradas / ventas brutas'],
        ['Presupuesto diario activo',p.daily_budget,'money','Promedio configurado actual; no es gasto histórico']
      ])}
      <section class="ml-metric-group"><h3>Resultados por campaña</h3><p class="ml-metrics-caption">Presupuesto y estado actuales; resultados del período seleccionado. Deslizá la tabla para ver las demás columnas.</p><div class="ml-metrics-table"><table><thead><tr><th>Campaña / estado</th><th>Presupuesto diario</th><th>ROAS objetivo</th><th>Gasto</th><th>Ingresos Ads</th><th>ROAS</th><th>ACOS</th><th>Clics</th><th>CTR</th><th>Conversión Ads</th><th>CPC</th><th>Costo por venta</th><th>Imp. ganadas</th><th>Perdidas por ranking</th><th>Perdidas por presupuesto</th></tr></thead><tbody>${p.campaigns.map(c => {
        const m = c.performance;
        const cells = [[c.daily_budget,'money'],[c.roas_target,'ratio'],[m.spend,'money'],[m.revenue,'money'],[m.roas,'ratio'],[m.acos,'percent'],[m.clicks,'number'],[m.ctr,'percent'],[m.cvr,'percent'],[m.cpc,'money'],[m.cpa,'money'],[c.top_impression_share,'percent'],[c.lost_impression_share_by_ad_rank,'percent'],[c.lost_impression_share_by_budget,'percent']];
        return `<tr><td>${escape(c.name)}<small>${escape(c.status === 'active' ? 'Activa' : c.status === 'paused' ? 'Pausada' : c.status)}</small></td>${cells.map(([v,t]) => `<td>${escape(format(v,t))}</td>`).join('')}</tr>`;
      }).join('') || '<tr><td colspan="15">Sin campañas disponibles.</td></tr>'}</tbody></table></div></section>
      <div class="ml-metrics-notes"><p>${escape(p.scope)}</p><p>${escape(p.traffic_note)}</p><p>${escape(p.attribution_note)} El ROAS total ML incluye ventas orgánicas: no demuestra que todas las ventas sean causadas por los anuncios. ROAS y ROI son métricas distintas.</p><p>“Pendiente” indica que falta un dato o que el denominador es cero. Los costos vigentes de mercadería se aplican al período consultado.</p></div>`;
    host.setAttribute('aria-busy','false');
  };
})();
