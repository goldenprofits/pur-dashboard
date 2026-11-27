const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('visits use the same Argentina calendar range and failures stay unknown', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pur-visits-'));
  process.env.DATA_DIR=dir;process.env.ML_USER_ID='123';
  const axios=require('axios'), original=axios.get;
  let calls=0;
  axios.get=async (url,options) => {
    calls++;
    assert.equal(url,'https://api.mercadolibre.com/users/123/items_visits');
    assert.equal(options.params.date_from,'2026-11-25T00:00:00.000-03:00');
    assert.equal(options.params.date_to,'2026-11-26T23:59:59.999-03:00');
    return {data:{total_visits:250}};
  };
  try {
    const ml=require('../lib/mercadolibre');
    const valid=await ml.visits('2026-11-25','2026-11-26');
    assert.equal(valid.available,true);assert.equal(valid.visits,250);
    const long=await ml.visits('2026-01-01','2026-11-26');
    assert.equal(long.available,false);assert.equal(long.visits,null);assert.equal(calls,1);
    axios.get=async()=>({data:{}});
    const missing=await ml.visits('2026-11-25','2026-11-26');
    assert.equal(missing.available,false);assert.equal(missing.visits,null);
    axios.get=async()=>{throw {response:{status:403}};};
    const denied=await ml.visits('2026-11-25','2026-11-26');
    assert.equal(denied.available,false);assert.equal(denied.visits,null);
  } finally {axios.get=original;fs.rmSync(dir,{recursive:true,force:true});}
});
