const { test } = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('../lib/performance');
const summary = { gross:100000, refunds:0, revenue:100000, orders:10, units:15, total_orders:12, cancelled:2,
  fees:20000, cogs:30000, shipping:5000, extra:0, profit:35000 };
const ads = { available:true, cost:10000, total_amount:40000, advertising_items_quantity:4,
  direct_amount:35000, indirect_amount:5000, clicks:100, prints:10000, direct_units_quantity:5, indirect_units_quantity:1,
  campaigns:[{status:'active',daily_budget:60000},{status:'paused',daily_budget:50000}] };
test('all-channel revenue is distinct from attributed revenue, and visits distinct from ad clicks', () => {
  const p = performance({summary},{available:true,visits:500},ads);
  assert.equal(p.advertising.roas,4);
  assert.equal(p.roas_total,10);
  assert.equal(p.visit_conversion,2);
  assert.equal(p.advertising.cvr,4);
  assert.equal(p.advertising.ctr,1);
  assert.equal(p.advertising.cpc,100);
  assert.equal(p.advertising.cpa,2500);
  assert.equal(p.advertising.units,6);
  assert.equal(p.advertising.acos,25);
  assert.equal(p.tacos,10);
  assert.equal(p.margin,35);
  assert.equal(p.before_ads,45000);
  assert.equal(p.fees_pct,20);
  assert.equal(p.costs_pct,65);
  assert.equal(p.daily_budget,60000);
});
test('zero denominators are undefined while real zero returns stay zero', () => {
  const p = performance({summary:{...summary,revenue:0,orders:0,units:0,profit:-100}},
    {available:true,visits:0},{...ads,cost:100,total_amount:0,advertising_items_quantity:0,clicks:0,prints:0});
  assert.equal(p.advertising.roas,0);
  assert.equal(p.advertising.acos,null);
  assert.equal(p.advertising.cvr,null);
  assert.equal(p.visit_conversion,null);
  assert.equal(p.margin,null);
  assert.equal(p.profit,-100);
  assert.equal(p.profit_per_order,null);
});
test('missing visits do not erase financials, and missing costs do not manufacture net margins', () => {
  const p = performance({summary},{available:false,visits:null},ads);
  assert.equal(p.visits,null);assert.equal(p.visit_conversion,null);assert.equal(p.profit,35000);
  const incomplete = performance({summary:{...summary,profit:null}},{available:true,visits:500},ads);
  assert.equal(incomplete.margin,null);assert.equal(incomplete.roi,null);assert.equal(incomplete.before_ads_margin,null);
  assert.equal(incomplete.profit_per_visit,null);assert.equal(incomplete.advertising.roas,4);
  const noAds = performance({summary:{...summary,profit:null}},{available:true,visits:500},{available:false,campaigns:[]});
  assert.equal(noAds.advertising.spend,null);assert.equal(noAds.daily_budget,null);assert.equal(noAds.roas_total,null);
  assert.equal(noAds.visit_conversion,2);
});
