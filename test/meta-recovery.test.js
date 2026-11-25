const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateSnapshot,recoveredReport}=require('../lib/meta-recovery');
const sample=()=>({account_id:'123',currency:'USD',from:'2026-10-31',to:'2026-11-01',checked_at:'2026-11-01T15:00:00Z',daily:[{date:'2026-10-31',spend:10.25,impressions:100,clicks:10,purchases:null,revenue:null},{date:'2026-11-01',spend:2.5,impressions:50,clicks:2,purchases:null,revenue:null}],months:[{month:'2026-10',spend:10.25},{month:'2026-11',spend:2.5}]});
test('recovered Meta costs reconcile and stay in their selected calendar period',()=>{
 const s=validateSnapshot(sample(),'act_123');
 const r=recoveredReport(s,{date_from:'2026-11-01',date_to:'2026-11-01'});
 assert.equal(r.summary.spend,2.5);assert.equal(r.summary.purchases,null);assert.equal(r.summary.revenue,null);assert.equal(r.recovered,true);
});
test('uncovered dates never become zero spend',()=>{
 const s=validateSnapshot(sample(),'123');
 assert.equal(recoveredReport(s,{date_from:'2026-10-01',date_to:'2026-11-01'}),null);
 assert.equal(recoveredReport(s,{period:'day'},new Date('2026-11-02T15:00:00Z')),null);
});
test('wrong account, missing or duplicate dates, and unreconciled totals are rejected',()=>{
 assert.throws(()=>validateSnapshot(sample(),'456'));
 const a=sample();a.daily[1].date=a.daily[0].date;assert.throws(()=>validateSnapshot(a,'123'));
 const b=sample();b.months[0].spend=0;assert.throws(()=>validateSnapshot(b,'123'));
});
