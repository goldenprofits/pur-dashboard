require('dotenv').config();
const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const store = require('./lib/store');
const ml = require('./lib/mercadolibre');
const { ledger, arDate } = require('./lib/ledger');
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '2kb' }));
const password = process.env.DASHBOARD_PASSWORD;
const secret = process.env.SESSION_SECRET;
if (!password || !secret) throw new Error('Configurar DASHBOARD_PASSWORD y SESSION_SECRET antes de iniciar.');
const attempts = new Map();
function sign(s) { return crypto.createHmac('sha256', secret).update(s).digest('hex'); }
function equal(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x,y); }
function authenticated(req) {
  const token = (req.headers.cookie || '').split('; ').find(c => c.startsWith('pur_session='))?.slice(12);
  if (!token) return false;
  const [expires, signature] = token.split('.');
  return Number(expires) > Date.now() && equal(signature || '', sign(expires));
}
app.use((req,res,next) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  const origin = req.headers.origin;
  const loginFromEmbeddedBrowser = req.path === '/login' && origin === 'null';
  if (['POST','PUT','DELETE'].includes(req.method) && origin && origin !== `${req.protocol}://${req.get('host')}` && !loginFromEmbeddedBrowser) return res.sendStatus(403);
  next();
});
app.get('/api/health', (req,res) => res.json({ ok: true }));
app.get('/login', (req,res) => res.sendFile(path.join(__dirname, 'public/ml-login.html')));
app.post('/login', (req,res) => {
  const now = Date.now(), ip = req.ip;
  const entry = attempts.get(ip);
  if (entry && now - entry.at < 600000 && entry.count >= 10) return res.status(429).send('Esperá unos minutos para reintentar.');
  if (!equal(String(req.body.password || ''), password)) {
    attempts.set(ip, { at: entry && now - entry.at < 600000 ? entry.at : now, count: entry && now - entry.at < 600000 ? entry.count + 1 : 1 });
    return res.redirect('/login?error=1');
  }
  attempts.delete(ip);
  const expires = String(now + 30 * 86400000);
  res.cookie('pur_session', `${expires}.${sign(expires)}`, { httpOnly: true, secure: req.secure, sameSite: 'lax', maxAge: 30 * 86400000 });
  res.redirect('/');
});
app.use((req,res,next) => {
  if (authenticated(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Iniciá sesión para ver el dashboard.' });
  return res.redirect('/login');
});
app.post('/logout', (req,res) => { res.clearCookie('pur_session'); res.redirect('/login'); });
const envCost = name => process.env[name] !== undefined && Number.isFinite(Number(process.env[name])) ? Number(process.env[name]) : undefined;
let settings = store.read('settings.json', { products: {}, period_expenses: {}, defaults: { pasta: envCost('PASTA_UNIT_COST'), gummy: envCost('GUMMY_UNIT_COST') } });
let cache = new Map(), pending = new Map();
function dates(query) {
  const today = arDate(new Date().toISOString());
  const to = query.to || today;
  const from = query.from || arDate(new Date(Date.parse(`${today}T03:00:00Z`) - 29 * 86400000).toISOString());
  const valid = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0,10) === s;
  if (!valid(from) || !valid(to) || to < from || to > today || Date.parse(to) - Date.parse(from) > 89 * 86400000) throw new Error('Elegí un período válido de hasta 90 días, sin fechas futuras.');
  return { from, to };
}
app.get('/api/overview', async (req,res) => {
  try {
    const { from,to } = dates(req.query), key = `${from}:${to}`;
    let entry = cache.get(key);
    if (!entry || Date.now() - entry.at > 5 * 60000) {
      if (!pending.has(key)) pending.set(key, (async () => {
        const [account, orders, ads] = await Promise.all([ml.get('/users/me'), ml.orders(from,to), ml.ads(from,to)]);
        if (String(account.id) !== String(process.env.ML_USER_ID)) throw new Error('La cuenta conectada no coincide con PÜR.');
        const shipping = await ml.shipping(orders);
        const value = { at: Date.now(), account: account.nickname, orders, ads, shipping };
        cache.set(key,value); return value;
      })().finally(() => pending.delete(key)));
      entry = await pending.get(key);
    }
    const report = ledger(entry.orders, entry.shipping, entry.ads, settings, from,to);
    res.json({ ...report, ads: entry.ads, from,to, account: entry.account, fetched_at: new Date(entry.at).toISOString(),
      expense: settings.period_expenses?.[key] || 0, default_costs: settings.defaults, includes_today: to === arDate(new Date().toISOString()),
      note: 'Resultado operativo de órdenes pagadas, por fecha de creación. Antes de impuestos, cargos de Full y gastos fijos que no hayas cargado. Las ventas atribuidas a Ads ya están dentro de las ventas totales.' });
  } catch (e) { console.error('ML dashboard:', e.message); res.status(502).json({ error: e.message }); }
});
app.post('/api/settings', (req,res) => {
  const { products, expense } = req.body;
    const next = { ...settings, products: { ...settings.products }, period_expenses: { ...settings.period_expenses } };
  if (products) {
    if (!Array.isArray(products) || products.length > 100) return res.sendStatus(400);
    for (const p of products) {
      if (!/^ML[A-Z]\d+$/.test(p.id) || !Number.isFinite(p.unit_cost) || p.unit_cost < 0 || p.unit_cost > 100000000) return res.sendStatus(400);
      next.products[p.id] = { unit_cost: p.unit_cost, confirmed: true, updated_at: new Date().toISOString() };
    }
  }
  if (expense) {
    let d; try { d = dates(expense); } catch { return res.sendStatus(400); }
    if (!Number.isFinite(expense.amount) || expense.amount < 0 || expense.amount > 1000000000) return res.sendStatus(400);
    next.period_expenses[`${d.from}:${d.to}`] = expense.amount;
  }
  store.write('settings.json', next); settings = next;
  res.json({ ok: true });
});
app.post('/api/refresh', (req,res) => { cache.clear(); res.json({ ok: true }); });
app.get('/', (req,res) => res.sendFile(path.join(__dirname, 'public/ml.html')));
for (const name of ['ml.css','ml.js','pur-logo.png']) app.get(`/${name}`, (req,res) => res.sendFile(path.join(__dirname,'public',name)));
app.use((req,res) => res.sendStatus(404));
app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('PÜR Mercado Libre dashboard ready'));
