const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.DATA_DIR || path.join(__dirname, '..', '.data');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
function read(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
function write(name, value) {
  const target = path.join(dir, name);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, target);
}
module.exports = { read, write };
