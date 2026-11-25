# PÜR · Mercado Libre

Dashboard privado de ventas, Product Ads y resultado operativo. `npm start` ejecuta `ml-server.js`. El código anterior de Tienda Nube/Meta queda conservado en `server.js` y sus archivos originales; el servicio actual se concentra en Mercado Libre.

## Operación

Node 22, `npm ci`, `npm test`, `npm start`. Variables privadas: `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_ACCESS_TOKEN`, `ML_REFRESH_TOKEN`, `ML_USER_ID`, `ML_ADVERTISER_ID`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`, `PASTA_UNIT_COST`, `GUMMY_UNIT_COST`, `DATA_DIR` y `PORT`.

En Railway, `DATA_DIR=/data` debe apuntar al volumen persistente del servicio y debe haber una sola réplica. Se guardan tokens renovados y configuración de costos mediante reemplazo atómico. El refresh token es rotativo: no iniciar otra instancia de producción con las credenciales antiguas de las variables si el volumen ya tiene tokens nuevos. No copiar tokens a Git ni a los registros. Respaldar el volumen de forma privada.

Healthcheck público: `/api/health`. Las ventas, campañas y configuración requieren la sesión del dashboard. Sesión de 30 días, contraseña privada y cookies HttpOnly/SameSite. El acceso no usa las credenciales personales de Mercado Libre. No hay acciones para editar campañas, modificar pedidos, enviar mensajes o hacer pagos.

## Cálculo

Ventas de órdenes pagadas por fecha de creación en UTC−03; canceladas excluidas. Comisiones `order_items[].sale_fee × quantity`; costo por publicación o costo vigente por familia; envío real `senders[].cost` del vendedor, deduplicado por shipment; gasto Product Ads del mismo período; otros gastos cargados para ese rango exacto.

Los costos vigentes se aplican a todo el período elegido, no representan un historial de precios de adquisición. Los packs requieren costo de pack específico. Si faltan costos, comisiones, publicidad o envíos, el resultado queda pendiente. Devoluciones parciales reducen ingresos y dejan pendiente la revisión del recupero de costos. El resultado es operativo: no equivale a saldo disponible ni incluye impuestos, almacenamiento/cargos de Full o gastos fijos que no se hayan cargado. Las ventas atribuidas de Ads no se suman de nuevo a las ventas del canal.

Product Ads usa descubrimiento del anunciante PADS y búsqueda de campañas para su site con `api-version: 2`, métricas y paginación. Incluye campañas pausadas con métricas dentro del período. Ceros informados se muestran como tales; si todas las métricas son cero, aparece una advertencia para contrastar con Mercado Ads. Falta de permiso/datos queda como no disponible. Rango máximo 90 días. Las órdenes se paginan y dividen por fecha si exceden el límite de búsqueda; no se truncan silenciosamente.

Las consultas de ventas/envíos/publicidad tienen caché de 5 minutos. La configuración de costos se recalcula inmediatamente sobre la misma consulta. Los datos de compradores no se muestran ni guardan en el volumen. El diseño admite escritorio y móvil.

Documentación oficial consultada: [Product Ads](https://developers.mercadolibre.com.ar/product-ads-para-catalogo-y-user-products-lectura), [órdenes](https://developers.mercadolibre.com.ar/gestiona-ventas), [envíos](https://developers.mercadolibre.com.ar/envios).
