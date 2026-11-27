const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('budget monitoring uses the configured average, never the different platform daily amount or spend', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pur-budget-'));
  process.env.DATA_DIR = dir;
  process.env.ML_ADVERTISER_ID = '123';
  const axios = require('axios');
  const originalGet = axios.get;
  const metrics = { clicks: 0, prints: 0, cost: 0, total_amount: 0, direct_amount: 0, indirect_amount: 0, advertising_items_quantity: 0 };
  const campaigns = [
    { id: 1, status: 'active', budget: 78000, daily_budget: 144348, metrics: { ...metrics, cost: 27067.1 } },
    { id: 2, status: 'active', budget: 18000, daily_budget: 35846, metrics: { ...metrics, cost: 6085.42 } },
    { id: 3, status: 'paused', budget: 60000, daily_budget: 60000, metrics }
  ];
  axios.get = async url => ({ data: url.endsWith('/advertising/advertisers')
    ? { advertisers: [{ advertiser_id: 123, site_id: 'MLA', advertiser_name: 'Test' }] }
    : { paging: { total: campaigns.length }, results: campaigns } });
  try {
    const ml = require('../lib/mercadolibre');
    const report = await ml.ads('2026-11-26', '2026-11-26');
    assert.equal(report.available, true);
    const active = report.campaigns.filter(c => c.status === 'active');
    assert.equal(active.reduce((sum, c) => sum + c.daily_budget, 0), 96000);
    assert.equal(active.reduce((sum, c) => sum + c.platform_daily_budget, 0), 180194);
    assert.equal(report.cost, 33152.52);

    delete campaigns[0].budget;
    const missing = await ml.ads('2026-11-26', '2026-11-26');
    assert.equal(missing.campaigns[0].daily_budget, null);
    assert.equal(missing.cost, 33152.52);
  } finally {
    axios.get = originalGet;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
