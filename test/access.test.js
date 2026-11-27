const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate storage and stub the provider: never refresh production ML tokens.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pur-access-'));
process.env.DATA_DIR = dataDir;
process.env.DASHBOARD_PASSWORD = 'local-maintenance-test';
process.env.SESSION_SECRET = 'local-session-test';
process.env.ML_USER_ID = 'test-seller';
process.env.PASTA_UNIT_COST = '3000';
process.env.GUMMY_UNIT_COST = '6500';
const ml = require('../lib/mercadolibre');
ml.get = async () => ({ id: 'test-seller', nickname: 'PÜR prueba' });
ml.orders = async () => [];
ml.ads = async () => ({ available: true, cost: 0, campaigns: [] });
ml.visits = async () => ({ available: true, visits: 100 });
ml.shipping = async () => ({});
const app = require('../ml-server');
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('anonymous visitors can open both dashboards and load metrics without login', async () => {
  for (const route of ['/', '/mercadolibre', '/app.js', '/ml.js']) {
    const response = await fetch(base + route, { redirect: 'manual' });
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get('location'), null);
  }
  const response = await fetch(base + '/api/overview?from=2026-11-25&to=2026-11-25');
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.account, 'PÜR prueba');
  assert.equal(report.permissions.can_edit_costs, false);
  assert.equal(report.traffic.visits, 100);
  assert.equal(report.performance.visit_conversion, 0);
  const refresh = await fetch(base + '/api/refresh', { method: 'POST', headers: { Origin: base } });
  assert.equal(refresh.status, 200);
  for (const route of ['/login', '/ml-login.html']) {
    const oldLogin = await fetch(base + route, { redirect: 'manual' });
    assert.equal(oldLogin.status, 302);
    assert.equal(oldLogin.headers.get('location'), '/');
  }
});

test('public access cannot change costs, import financial data or expose customer CRM', async () => {
  for (const route of ['/api/settings', '/api/annual-review', '/api/meta-snapshot', '/api/crm/mensaje']) {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 403, route);
  }
  const crm = await fetch(base + '/api/crm/alertas');
  assert.equal(crm.status, 403);
  const crossOrigin = await fetch(base + '/api/refresh', { method: 'POST', headers: { Origin: 'https://other.example' } });
  assert.equal(crossOrigin.status, 403);
  assert.equal(fs.existsSync(path.join(dataDir, 'settings.json')), false);
});

test('existing maintenance sessions still support authorized cost updates', async () => {
  const login = await fetch(base + '/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.DASHBOARD_PASSWORD })
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const access = await fetch(base + '/api/access', { headers: { Cookie: cookie } });
  assert.equal((await access.json()).can_edit_costs, true);
  const update = await fetch(base + '/api/settings', {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ products: [{ id: 'MLA123', unit_cost: 3000 }] })
  });
  assert.equal(update.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'))).products.MLA123.unit_cost, 3000);
});
