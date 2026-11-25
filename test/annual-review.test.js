const { test }=require('node:test');
const assert=require('node:assert/strict');
const { validateReview }=require('../lib/annual-review');
const sample=()=>({seller_id:'123',year:2026,from:'2026-01-01',to:'2026-02-25',checked_at:'2026-02-25T12:00:00Z',complete:true,source_records:5,months:[{month:1,charges:100,refunds:20},{month:2,charges:200,refunds:10}]});
test('annual spending subtracts credits and calculates totals on the server',()=>{
 const d=validateReview({...sample(),totals:{net:99999}},'123');assert.equal(d.totals.net,270);assert.equal(d.months[0].net,80);
});
test('partial coverage and other sellers cannot be published as verified annual spending',()=>{
 assert.throws(()=>validateReview(sample(),'999'));
 assert.throws(()=>validateReview({...sample(),complete:false},'123'));
 assert.throws(()=>validateReview({...sample(),months:[{month:2,charges:100,refunds:0}]},'123'));
});
