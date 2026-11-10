'use strict';
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const db = new DatabaseSync(path.join(config.dataDir, 'aurabot.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  gift_product_id INTEGER,
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  price REAL NOT NULL,
  gift_name TEXT,
  payment_method TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  discord_user TEXT NOT NULL,
  server_info TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'placed',
  admin_note TEXT NOT NULL DEFAULT '',
  access_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  discord_user TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets(customer_id);
CREATE TABLE IF NOT EXISTS ticket_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL,
  username TEXT NOT NULL,
  avatar TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  verified_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// node:sqlite rejects `undefined`; this keeps call sites tidy.
const nz = (v) => (v === undefined ? null : v);
const q = {
  get: (sql, ...p) => db.prepare(sql).get(...p.map(nz)),
  all: (sql, ...p) => db.prepare(sql).all(...p.map(nz)),
  run: (sql, ...p) => db.prepare(sql).run(...p.map(nz)),
};
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const getSetting = (key, fallback) => {
  const r = q.get('SELECT value FROM settings WHERE key = ?', key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return fallback; }
};
const setSetting = (key, value) =>
  q.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));

// ---- first-run demo content (mirrors the Canva design; edit/delete it from the dashboard) ----
if (!q.get('SELECT 1 AS x FROM products LIMIT 1')) {
  const now = Date.now();
  const ins = (name, price, discount, featured, sort) =>
    q.run('INSERT INTO products(name, description, price, discount, featured, sort, created_at) VALUES(?,?,?,?,?,?,?)',
      name, 'وصف المنتج هنا. عدّله من لوحة التحكم.', price, discount, featured, sort, now).lastInsertRowid;
  const p1 = ins('بوت تجريبي 1', 250, 10, 1, 1);
  ins('بوت تجريبي 2', 150, 0, 0, 2);
  const p3 = ins('بوت تجريبي 3', 200, 0, 0, 3);
  ins('بوت تجريبي 4', 300, 0, 0, 4);
  ins('بوت تجريبي 5', 120, 0, 0, 5);
  q.run('UPDATE products SET gift_product_id = ? WHERE id = ?', p3, p1);
}
if (!q.get('SELECT 1 AS x FROM payment_methods LIMIT 1')) {
  [1, 2, 3].forEach((n) => q.run('INSERT INTO payment_methods(name, details, sort) VALUES(?,?,?)', `طريقة الدفع ${n}`, '', n));
}
if (getSetting('faq', null) === null) {
  setSetting('faq', [
    { q: 'استلم البوت ازاي ؟', a: 'بنضيفه لسيرفرك بنفسنا، أو نسلمك التوكن والملفات لو الاستضافة عندك.' },
    { q: 'مدة التسليم قد ايه ؟', a: 'بنبلغك بميعاد التسليم على الديسكورد بعد ما نتفق على الطلب.' },
    { q: 'اعمل ايه لو البوت وقف او فيه مشكلة ؟', a: 'افتح تذكرة دعم فني من صفحة التذاكر وهنرد عليك.' },
  ]);
}
if (getSetting('discord_invite', null) === null) setSetting('discord_invite', 'https://discord.gg/jYq3eZmSHe');

module.exports = { db, q, tx, getSetting, setSetting };
