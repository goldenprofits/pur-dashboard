const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ledger } = require('../lib/ledger');
const item = (q=1) => ({ quantity:q, unit_price:15000, sale_fee:3150, item:{id:'MLA123',title:'Pasta dental PÜR X1'} });
const order = (id,shipping=10,q=1) => ({ id,status:'paid',currency_id:'ARS',total_amount:15000*q,date_created:'2026-11-24T23:30:00-03:00',shipping:{id:shipping},order_items:[item(q)],payments:[{transaction_amount_refunded:0}] });
const ads = {available:true,cost:1000};
const settings = {defaults:{pasta:3000,gummy:6500}};
const calc = (o,s={10:2000},a=ads,c=settings) => ledger(o,s,a,c,'2026-11-24','2026-11-25');
test('multiple units, actual per-unit fees, and shared shipment charged once',()=>{
 const r=calc([order(1,10,2),order(2)]);
 assert.equal(r.summary.revenue,45000);assert.equal(r.summary.fees,9450);
 assert.equal(r.summary.cogs,9000);assert.equal(r.summary.shipping,2000);
 assert.equal(r.summary.profit,23550);assert.equal(r.daily[0].revenue,45000);
});
test('missing ads, shipment cost, or SKU cost never silently become a full profit',()=>{
 assert.equal(calc([order(1)],{},ads).summary.profit,null);
 assert.equal(calc([order(1)],{10:0},{available:false}).summary.profit,null);
 assert.equal(calc([order(1)],{10:0},ads,{}).summary.profit,null);
});
test('cancelled orders excluded and verified zero ad spend allowed',()=>{
 const x=order(2);x.status='cancelled';const r=calc([order(1),x],{10:0},{available:true,cost:0});
 assert.equal(r.summary.orders,1);assert.equal(r.summary.cancelled,1);assert.equal(r.summary.profit,8850);
});
test('bundles require full pack cost rather than single-unit defaults',()=>{
 const x=order(1);x.order_items[0].item.title='Pack x3 Pasta dental';
 assert.equal(calc([x]).summary.profit,null);
 assert.equal(calc([x],{10:0},ads,{products:{MLA123:{unit_cost:9000,confirmed:true}}}).summary.cogs,9000);
});
test('partial refund reduces revenue, flags cost recovery for review',()=>{
 const x=order(1);x.payments[0].transaction_amount_refunded=3000;const r=calc([x]);
 assert.equal(r.summary.revenue,12000);assert.equal(r.summary.profit,null);assert.match(r.summary.missing[0],/devoluciones/);
});
test('extra expenses attach only to the exact selected period',()=>{
 const r=calc([order(1)],{10:0},ads,{...settings,period_expenses:{'2026-11-24:2026-11-25':900,'2026-11-01:2026-11-30':10000}});
 assert.equal(r.summary.extra,900);assert.equal(r.summary.profit,6950);
});
test('mixing currencies is rejected',()=>{
 const x=order(1);x.currency_id='USD';assert.throws(()=>calc([x]),/moneda/);
});
