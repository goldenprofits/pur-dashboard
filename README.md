# PÜR · Dashboard de métricas

Dashboard de ventas, Product Ads y resultado operativo, visible sin contraseña por pedido del usuario. `npm start` ejecuta `ml-server.js`. La página principal conserva el diseño original de Tienda Nube, Mercado Libre y Meta. El detalle de Mercado Libre y la revisión anual están en `/mercadolibre`. Cada canal informa su estado por separado; una conexión caída no oculta los demás.

## Operación

Node 22, `npm ci`, `npm test`, `npm start`. Variables privadas: `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_ACCESS_TOKEN`, `ML_REFRESH_TOKEN`, `ML_USER_ID`, `ML_ADVERTISER_ID`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`, `PASTA_UNIT_COST`, `GUMMY_UNIT_COST`, `DATA_DIR` y `PORT`.

En Railway, `DATA_DIR=/data` debe apuntar al volumen persistente del servicio y debe haber una sola réplica. Se guardan tokens renovados y configuración de costos mediante reemplazo atómico. El refresh token es rotativo: no iniciar otra instancia de producción con las credenciales antiguas de las variables si el volumen ya tiene tokens nuevos. No copiar tokens a Git ni a los registros. Respaldar el volumen de forma privada.

Las páginas del dashboard, las consultas de métricas y la actualización de caché funcionan sin sesión. `/login` y `/ml-login.html` redirigen al dashboard. Los cambios de costos, importaciones de datos y el CRM de compradores conservan la sesión administrativa existente de 30 días; sus controles se ocultan a visitantes sin sesión. `DASHBOARD_PASSWORD` y `SESSION_SECRET` se usan solo para ese mantenimiento, sin pantalla de contraseña para consultar el dashboard. No hay acciones para editar campañas, modificar pedidos, enviar mensajes o hacer pagos desde las vistas del dashboard.

## Cálculo

El bloque superior de Mercado Libre y `/mercadolibre` muestran un mismo reporte completo: ROAS de ingresos atribuidos, ROAS total del canal (incluye ventas orgánicas), conversión de visitas y de clics, CTR, CPC, CPA, ACOS/TACOS, margen/ROI operativos, costos relativos y tabla de campañas. Las fórmulas se centralizan en `lib/performance.js`; ratios sin denominador o datos faltantes son `null`, no cero. No se suman porcentajes de campañas ni se confunden visitas/clics con personas únicas.

Las visitas se consultan en `/users/{seller}/items_visits` por las fechas calendario seleccionadas, con fin exclusivo al día siguiente. Las órdenes financieras usan UTC−03; por esa diferencia de cortes y por no ser personas únicas, el ratio de visitas se identifica como estimado. La API admite hasta150días: fallos o períodos mayores conservan la conversión pendiente, sin bloquear ventas ni resultados financieros. Si la API rechaza métricas opcionales de Ads, se recuperan las métricas básicas para conservar gasto y rentabilidad. Las métricas publicitarias tienen una ventana de atribución de hasta14días y pueden actualizarse; no equivalen a compradores únicos. El ROAS de equilibrio es una estimación del mix total vendido, no una orden para cambiar pujas.

Ventas de órdenes pagadas por fecha de creación en UTC−03; canceladas excluidas. Comisiones `order_items[].sale_fee × quantity`; costo por publicación o costo vigente por familia; envío real `senders[].cost` del vendedor, deduplicado por shipment; gasto Product Ads del mismo período; otros gastos cargados para ese rango exacto.

Los costos vigentes se aplican a todo el período elegido, no representan un historial de precios de adquisición. Los packs requieren costo de pack específico. Si faltan costos, comisiones, publicidad o envíos, el resultado queda pendiente. Devoluciones parciales reducen ingresos y dejan pendiente la revisión del recupero de costos. El resultado es operativo: no equivale a saldo disponible ni incluye impuestos, almacenamiento/cargos de Full o gastos fijos que no se hayan cargado. Las ventas atribuidas de Ads no se suman de nuevo a las ventas del canal.

Product Ads usa descubrimiento del anunciante PADS y búsqueda de campañas para su site con `api-version: 2`, métricas y paginación. Incluye campañas pausadas con métricas dentro del período. Ceros informados se muestran como tales. Falta de permiso/datos queda como no disponible. La API publicitaria permite consultar hasta 90 días hacia atrás; el histórico auditado de facturación se guarda por separado en el volumen mediante `/api/annual-review`, sin datos privados en Git. Las fechas del dashboard admiten hasta un año, pero no se calcula ganancia si faltan datos publicitarios del rango. Las órdenes se paginan y dividen por fecha si exceden el límite de búsqueda; no se truncan silenciosamente.

En `ads.campaigns`, `daily_budget` es el presupuesto promedio diario configurado, tomado de `budget` en Mercado Ads. El campo distinto `daily_budget` de la respuesta original se conserva como `platform_daily_budget` y no se usa para alertar sobre el presupuesto autorizado. Si falta `budget`, el promedio configurado queda desconocido; no se reemplaza por el otro campo ni por cero.

Las consultas de ventas/envíos/publicidad tienen caché de 5 minutos. La configuración de costos se recalcula inmediatamente sobre la misma consulta. Los datos de compradores no se muestran ni guardan en el volumen. El diseño admite escritorio y móvil.

Documentación oficial consultada: [Product Ads](https://developers.mercadolibre.com.ar/product-ads-para-catalogo-y-user-products-lectura), [órdenes](https://developers.mercadolibre.com.ar/gestiona-ventas), [envíos](https://developers.mercadolibre.com.ar/envios).

## Recuperación de gasto Meta

Si la conexión de Meta falla, `/api/meta` puede usar una consulta diaria verificada importada por sesión privada en `/api/meta-snapshot`. Se valida la cuenta y moneda USD, la cobertura diaria completa y la conciliación con los totales mensuales. Las fechas fuera de cobertura siguen sin datos. La interfaz muestra el corte de la consulta, avisa que debe renovarse la conexión automática y conserva las compras/ventas no disponibles como desconocidas. Los importes convertidos a pesos son estimaciones al tipo de cambio mostrado, no cargos bancarios históricos. Esta recuperación se guarda solo en el volumen privado; nunca en Git.
