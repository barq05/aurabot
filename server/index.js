'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { q, tx, getSetting, setSetting } = require('./db');
const discord = require('./discord');
const H = require('./http');
const { HttpError, str, int, num } = H;

const ADMIN_COOKIE = 'aura_a';      // admin session  (sent only to /api/admin)
const CUSTOMER_COOKIE = 'aura_c';   // customer session
const ADMIN_TTL = 8 * 3600 * 1000;  // 8 hours
const REVERIFY_MS = 5 * 60 * 1000;  // re-check Discord roles every 5 minutes
const ORDER_STATUSES = ['placed', 'paid', 'delivered', 'cancelled'];
const TICKET_TYPES = ['support', 'complaint', 'inquiry'];
const TICKET_STATUSES = ['open', 'answered', 'closed'];
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion

const randomCode = (n) => Array.from(crypto.randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join('');
const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const finalPrice = (p) => Math.round(p.price * (100 - p.discount)) / 100;

// ───────────────────────── router ─────────────────────────
const routes = [];
const route = (method, pattern, handler, { admin = false } = {}) =>
  routes.push({ method, admin, handler, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') });

// ───────────────────────── customer identity (cookie-based, no login) ─────────────────────────
function customerIdFrom(req) {
  const t = H.parseCookies(req.headers.cookie)[CUSTOMER_COOKIE];
  if (!t) return null;
  const s = q.get('SELECT customer_id FROM customer_sessions WHERE token_hash = ?', H.hashToken(t));
  return s ? s.customer_id : null;
}
function startCustomerSession(res, customerId) {
  const t = H.token(32);
  q.run('INSERT INTO customer_sessions(token_hash, customer_id, created_at) VALUES(?,?,?)', H.hashToken(t), customerId, Date.now());
  H.addCookie(res, H.cookie(CUSTOMER_COOKIE, t, { maxAge: 365 * 86400, path: '/api', sameSite: 'Lax' }));
}
function ensureCustomer(req, res) {
  let id = customerIdFrom(req);
  if (!id) {
    id = Number(q.run('INSERT INTO customers(created_at) VALUES(?)', Date.now()).lastInsertRowid);
    startCustomerSession(res, id);
  }
  return id;
}
const orderCount = (cid) => (cid ? q.get('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?', cid).n : 0);

// ───────────────────────── DTO helpers ─────────────────────────
const productDTO = (p, gift) => ({
  id: p.id, name: p.name, description: p.description, price: p.price, discount: p.discount,
  finalPrice: finalPrice(p), giftName: gift ? gift.name : null, featured: !!p.featured,
});
const customerOrderDTO = (o) => ({
  code: o.code, productName: o.product_name, price: o.price, giftName: o.gift_name,
  paymentMethod: o.payment_method, status: o.status, notes: o.notes, adminNote: o.admin_note, createdAt: o.created_at,
});
const adminOrderDTO = (o) => ({
  id: o.id, code: o.code, productName: o.product_name, price: o.price, giftName: o.gift_name,
  paymentMethod: o.payment_method, buyerName: o.buyer_name, discordUser: o.discord_user, serverInfo: o.server_info,
  notes: o.notes, status: o.status, adminNote: o.admin_note, createdAt: o.created_at, updatedAt: o.updated_at,
});
const ticketDTO = (t) => ({
  id: t.id, type: t.type, subject: t.subject, discordUser: t.discord_user, status: t.status, createdAt: t.created_at, updatedAt: t.updated_at,
  replies: q.all('SELECT author, body, created_at AS createdAt FROM ticket_replies WHERE ticket_id = ? ORDER BY id', t.id),
});
const pmDTO = (m) => ({ id: m.id, name: m.name, details: m.details, active: !!m.active, sort: m.sort });

function activeProducts() {
  const rows = q.all('SELECT * FROM products WHERE active = 1 ORDER BY sort, id');
  const byId = new Map(q.all('SELECT * FROM products').map((p) => [p.id, p]));
  return rows.map((p) => productDTO(p, p.gift_product_id ? byId.get(p.gift_product_id) : null));
}

// ───────────────────────── PUBLIC API ─────────────────────────
route('GET', '/api/public', () => {
  const best = q.all(`SELECT p.id FROM products p WHERE p.active = 1
    ORDER BY p.featured DESC, (SELECT COUNT(*) FROM orders o WHERE o.product_id = p.id AND o.status != 'cancelled') DESC, p.sort, p.id LIMIT 4`);
  return {
    products: activeProducts(),
    bestSellerIds: best.map((r) => r.id),
    paymentMethods: q.all('SELECT * FROM payment_methods WHERE active = 1 ORDER BY sort, id').map(pmDTO),
    settings: { discordInvite: getSetting('discord_invite', ''), faq: getSetting('faq', []) },
  };
});

// Tells the site whether to show the "My Orders" link. This is only a UI hint; /api/orders enforces access.
route('GET', '/api/me', ({ req }) => {
  const n = orderCount(customerIdFrom(req));
  return { hasOrders: n > 0, orders: n };
});

route('POST', '/api/orders', async ({ req, res, ip }) => {
  H.rateLimit(`order:${ip}`, 10, 3600_000);
  const b = await H.readJson(req);
  const product = q.get('SELECT * FROM products WHERE id = ? AND active = 1', int(b.productId, 'المنتج', 1));
  const pm = q.get('SELECT * FROM payment_methods WHERE id = ? AND active = 1', int(b.paymentMethodId, 'طريقة الدفع', 1));
  if (!product) throw new HttpError(404, 'المنتج مش متاح');
  if (!pm) throw new HttpError(404, 'طريقة الدفع مش متاحة');
  const buyerName = str(b.buyerName, 'الاسم', 2, 60);
  const discordUser = str(b.discordUser, 'يوزر الديسكورد', 2, 64);
  const serverInfo = str(b.serverInfo, 'اسم أو رابط السيرفر', 2, 120);
  const notes = b.notes ? str(b.notes, 'الملاحظات', 0, 500) : '';
  const gift = product.gift_product_id ? q.get('SELECT name FROM products WHERE id = ?', product.gift_product_id) : null;

  const customerId = ensureCustomer(req, res);
  const access = randomCode(8); // shown ONCE to the customer; lets them restore access on another device
  let code;
  const now = Date.now();
  for (let i = 0; i < 8; i++) {
    code = '#' + randomCode(6);
    try {
      q.run(`INSERT INTO orders(code, customer_id, product_id, product_name, price, gift_name, payment_method, buyer_name,
        discord_user, server_info, notes, status, access_hash, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      code, customerId, product.id, product.name, finalPrice(product), gift ? gift.name : null, pm.name, buyerName,
      discordUser, serverInfo, notes, 'placed', H.hashToken(access), now, now);
      break;
    } catch (e) { if (i === 7 || !String(e.message).includes('UNIQUE')) throw e; }
  }
  discord.notify(`🛒 طلب جديد ${code}\nالمنتج: ${product.name} — ${finalPrice(product)} ج.م\nالدفع: ${pm.name}\nالعميل: ${buyerName} (${discordUser})\nالسيرفر: ${serverInfo}`);
  res.statusCode = 201;
  return { code, accessCode: `${access.slice(0, 4)}-${access.slice(4)}`, productName: product.name, price: finalPrice(product), paymentMethod: pm.name, giftName: gift ? gift.name : null };
});

// 🔒 My Orders: needs a valid customer session AND at least one order. Every row is filtered by that customer's id.
route('GET', '/api/orders', ({ req }) => {
  const cid = customerIdFrom(req);
  if (!cid || orderCount(cid) === 0) throw new HttpError(403, 'صفحة طلباتي متاحة للعملاء اللي عندهم طلبات بس');
  return { orders: q.all('SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC', cid).map(customerOrderDTO) };
});

route('POST', '/api/orders/recover', async ({ req, res, ip }) => {
  H.rateLimit(`recover:${ip}`, 8, 15 * 60_000);
  const b = await H.readJson(req);
  const code = '#' + normCode(b.code);
  const access = normCode(b.accessCode);
  const o = q.get('SELECT customer_id, access_hash FROM orders WHERE code = ?', code);
  const ok = o && access.length === 8 && H.safeEqual(o.access_hash, H.hashToken(access));
  if (!ok) throw new HttpError(404, 'رقم الطلب أو الكود غلط');
  startCustomerSession(res, o.customer_id);
  return { ok: true };
});

route('GET', '/api/tickets', ({ req }) => {
  const cid = customerIdFrom(req);
  if (!cid) return { tickets: [] };
  return { tickets: q.all('SELECT * FROM tickets WHERE customer_id = ? ORDER BY id DESC', cid).map(ticketDTO) };
});

route('POST', '/api/tickets', async ({ req, res, ip }) => {
  H.rateLimit(`ticket:${ip}`, 8, 3600_000);
  const b = await H.readJson(req);
  if (!TICKET_TYPES.includes(b.type)) throw new HttpError(400, 'نوع التذكرة غير صحيح');
  const subject = str(b.subject, 'عنوان الرسالة', 3, 100);
  const message = str(b.message, 'تفاصيل المشكلة', 10, 2000);
  const discordUser = str(b.discordUser, 'يوزر الديسكورد', 2, 64);
  const cid = ensureCustomer(req, res);
  const now = Date.now();
  const id = Number(q.run('INSERT INTO tickets(customer_id, type, subject, discord_user, created_at, updated_at) VALUES(?,?,?,?,?,?)',
    cid, b.type, subject, discordUser, now, now).lastInsertRowid);
  q.run('INSERT INTO ticket_replies(ticket_id, author, body, created_at) VALUES(?,?,?,?)', id, 'customer', message, now);
  discord.notify(`🎫 تذكرة جديدة #${id} (${b.type})\n${subject}\nالعميل: ${discordUser}`);
  res.statusCode = 201;
  return { id };
});

route('POST', '/api/tickets/:id/replies', async ({ req, res, params }) => {
  const cid = customerIdFrom(req);
  const t = cid && q.get('SELECT * FROM tickets WHERE id = ? AND customer_id = ?', int(params.id, 'id', 1), cid);
  if (!t) throw new HttpError(404, 'التذكرة مش موجودة');
  if (t.status === 'closed') throw new HttpError(400, 'التذكرة دي مقفولة');
  const body = str((await H.readJson(req)).body, 'الرد', 1, 2000);
  const now = Date.now();
  q.run('INSERT INTO ticket_replies(ticket_id, author, body, created_at) VALUES(?,?,?,?)', t.id, 'customer', body, now);
  q.run("UPDATE tickets SET status = 'open', updated_at = ? WHERE id = ?", now, t.id);
  res.statusCode = 201;
  return { ok: true };
});

// ───────────────────────── ADMIN AUTH (Discord OAuth2 + bot role check) ─────────────────────────
const dashRedirect = (res, err) => H.redirect(res, '/dashboard/' + (err ? `?error=${err}` : ''));

route('GET', '/api/admin/auth/login', ({ res }) => {
  if (!config.discord.ready) throw new HttpError(503, 'Discord غير مُعدّ على السيرفر. راجع ملف .env');
  const state = H.token(16);
  H.addCookie(res, H.cookie('aura_oauth', state, { maxAge: 600, path: '/api/admin/auth', sameSite: 'Lax' }));
  H.redirect(res, discord.authorizeUrl(state));
});

route('GET', '/api/admin/auth/callback', async ({ req, res, query, ip }) => {
  H.rateLimit(`oauthcb:${ip}`, 20, 15 * 60_000);
  const saved = H.parseCookies(req.headers.cookie).aura_oauth;
  H.addCookie(res, H.cookie('aura_oauth', '', { maxAge: 0, path: '/api/admin/auth', sameSite: 'Lax' }));
  if (!config.discord.ready) return dashRedirect(res, 'config');
  if (!saved || !query.state || !H.safeEqual(saved, query.state)) return dashRedirect(res, 'state'); // CSRF protection
  if (query.error || !query.code) return dashRedirect(res, 'cancelled');
  try {
    const tok = await discord.exchangeCode(String(query.code));
    const user = await discord.fetchUser(tok.access_token);
    discord.revoke(tok.access_token).catch(() => {});
    const member = await discord.fetchMember(user.id);        // server-side, using the bot token
    if (!member) return dashRedirect(res, 'not_member');
    if (!discord.hasAdminRole(member)) return dashRedirect(res, 'no_role');
    const t = H.token(32);
    const now = Date.now();
    q.run('INSERT INTO admin_sessions(token_hash, discord_id, username, avatar, created_at, expires_at, verified_at) VALUES(?,?,?,?,?,?,?)',
      H.hashToken(t), user.id, user.global_name || user.username, discord.avatarUrl(user), now, now + ADMIN_TTL, now);
    H.addCookie(res, H.cookie(ADMIN_COOKIE, t, { maxAge: ADMIN_TTL / 1000, path: '/api/admin', sameSite: 'Strict' }));
    return dashRedirect(res);
  } catch (e) {
    console.error('[admin login]', e.message);
    return dashRedirect(res, 'failed');
  }
});

route('POST', '/api/admin/auth/logout', ({ req, res }) => {
  const t = H.parseCookies(req.headers.cookie)[ADMIN_COOKIE];
  if (t) q.run('DELETE FROM admin_sessions WHERE token_hash = ?', H.hashToken(t));
  H.addCookie(res, H.cookie(ADMIN_COOKIE, '', { maxAge: 0, path: '/api/admin', sameSite: 'Strict' }));
  return { ok: true };
});

// Validates the admin cookie. Roles are re-checked against Discord every few minutes, so removing a
// role in Discord removes dashboard access shortly after. If Discord can't be reached we fail CLOSED.
async function requireAdmin(req) {
  const t = H.parseCookies(req.headers.cookie)[ADMIN_COOKIE];
  const h = t && H.hashToken(t);
  const s = h && q.get('SELECT * FROM admin_sessions WHERE token_hash = ?', h);
  if (!s || s.expires_at < Date.now()) {
    if (s) q.run('DELETE FROM admin_sessions WHERE token_hash = ?', h);
    throw new HttpError(401, 'سجّل دخولك الأول');
  }
  if (Date.now() - s.verified_at > REVERIFY_MS) {
    let ok = false;
    try { ok = discord.hasAdminRole(await discord.fetchMember(s.discord_id)); } catch (e) { console.warn('[reverify]', e.message); }
    if (!ok) { q.run('DELETE FROM admin_sessions WHERE discord_id = ?', s.discord_id); throw new HttpError(401, 'انتهت صلاحية الدخول'); } // revoke ALL of this person's sessions
    q.run('UPDATE admin_sessions SET verified_at = ? WHERE token_hash = ?', Date.now(), h);
  }
  return { discordId: s.discord_id, username: s.username, avatar: s.avatar };
}

route('GET', '/api/admin/me', ({ admin }) => admin, { admin: true });

route('GET', '/api/admin/stats', () => {
  const c = (sql) => q.get(sql).n;
  return {
    orders: c('SELECT COUNT(*) AS n FROM orders'),
    newOrders: c("SELECT COUNT(*) AS n FROM orders WHERE status = 'placed'"),
    paidOrders: c("SELECT COUNT(*) AS n FROM orders WHERE status IN ('paid','delivered')"),
    revenue: q.get("SELECT COALESCE(SUM(price),0) AS n FROM orders WHERE status IN ('paid','delivered')").n,
    openTickets: c("SELECT COUNT(*) AS n FROM tickets WHERE status != 'closed'"),
    products: c('SELECT COUNT(*) AS n FROM products WHERE active = 1'),
  };
}, { admin: true });

// ── products ──
function productInput(b, selfId) {
  let gift = null;
  if (b.giftProductId !== null && b.giftProductId !== undefined && b.giftProductId !== '') {
    gift = int(b.giftProductId, 'الهدية', 1);
    if (gift === selfId) throw new HttpError(400, 'المنتج مينفعش يبقى هدية لنفسه');
    if (!q.get('SELECT 1 AS x FROM products WHERE id = ?', gift)) throw new HttpError(400, 'منتج الهدية مش موجود');
  }
  return [str(b.name, 'الاسم', 2, 80), b.description ? str(b.description, 'الوصف', 0, 1000) : '', num(b.price, 'السعر'),
    int(b.discount ?? 0, 'الخصم', 0, 100), gift, b.featured ? 1 : 0, b.active === false ? 0 : 1, int(b.sort ?? 0, 'الترتيب', -9999, 9999)];
}
route('GET', '/api/admin/products', () => ({ products: q.all('SELECT * FROM products ORDER BY sort, id').map((p) => ({
  id: p.id, name: p.name, description: p.description, price: p.price, discount: p.discount, giftProductId: p.gift_product_id,
  featured: !!p.featured, active: !!p.active, sort: p.sort })) }), { admin: true });
route('POST', '/api/admin/products', async ({ req, res }) => {
  const v = productInput(await H.readJson(req), null);
  const id = q.run('INSERT INTO products(name, description, price, discount, gift_product_id, featured, active, sort, created_at) VALUES(?,?,?,?,?,?,?,?,?)', ...v, Date.now()).lastInsertRowid;
  res.statusCode = 201; return { id: Number(id) };
}, { admin: true });
route('PUT', '/api/admin/products/:id', async ({ req, params }) => {
  const id = int(params.id, 'id', 1);
  if (!q.get('SELECT 1 AS x FROM products WHERE id = ?', id)) throw new HttpError(404, 'مش موجود');
  q.run('UPDATE products SET name=?, description=?, price=?, discount=?, gift_product_id=?, featured=?, active=?, sort=? WHERE id=?', ...productInput(await H.readJson(req), id), id);
  return { ok: true };
}, { admin: true });
route('DELETE', '/api/admin/products/:id', ({ params }) => {
  const id = int(params.id, 'id', 1);
  tx(() => { q.run('UPDATE products SET gift_product_id = NULL WHERE gift_product_id = ?', id); q.run('DELETE FROM products WHERE id = ?', id); });
  return { ok: true }; // old orders keep their own copy of the product name/price
}, { admin: true });

// ── orders ──
route('GET', '/api/admin/orders', ({ query }) => {
  const st = ORDER_STATUSES.includes(query.status) ? query.status : null;
  const rows = st ? q.all('SELECT * FROM orders WHERE status = ? ORDER BY id DESC LIMIT 500', st) : q.all('SELECT * FROM orders ORDER BY id DESC LIMIT 500');
  return { orders: rows.map(adminOrderDTO) };
}, { admin: true });
route('PATCH', '/api/admin/orders/:id', async ({ req, params }) => {
  const id = int(params.id, 'id', 1);
  const o = q.get('SELECT * FROM orders WHERE id = ?', id);
  if (!o) throw new HttpError(404, 'مش موجود');
  const b = await H.readJson(req);
  const status = b.status === undefined ? o.status : b.status;
  if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'حالة غير صحيحة');
  const note = b.adminNote === undefined ? o.admin_note : (b.adminNote ? str(b.adminNote, 'الملاحظة', 0, 500) : '');
  q.run('UPDATE orders SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?', status, note, Date.now(), id);
  return { ok: true };
}, { admin: true });
route('DELETE', '/api/admin/orders/:id', ({ params }) => { q.run('DELETE FROM orders WHERE id = ?', int(params.id, 'id', 1)); return { ok: true }; }, { admin: true });

// ── tickets ──
route('GET', '/api/admin/tickets', () => ({ tickets: q.all('SELECT * FROM tickets ORDER BY updated_at DESC LIMIT 300').map(ticketDTO) }), { admin: true });
route('POST', '/api/admin/tickets/:id/replies', async ({ req, res, params }) => {
  const id = int(params.id, 'id', 1);
  if (!q.get('SELECT 1 AS x FROM tickets WHERE id = ?', id)) throw new HttpError(404, 'مش موجود');
  const body = str((await H.readJson(req)).body, 'الرد', 1, 2000);
  const now = Date.now();
  q.run('INSERT INTO ticket_replies(ticket_id, author, body, created_at) VALUES(?,?,?,?)', id, 'admin', body, now);
  q.run("UPDATE tickets SET status = 'answered', updated_at = ? WHERE id = ?", now, id);
  res.statusCode = 201; return { ok: true };
}, { admin: true });
route('PATCH', '/api/admin/tickets/:id', async ({ req, params }) => {
  const status = (await H.readJson(req)).status;
  if (!TICKET_STATUSES.includes(status)) throw new HttpError(400, 'حالة غير صحيحة');
  q.run('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?', status, Date.now(), int(params.id, 'id', 1));
  return { ok: true };
}, { admin: true });
route('DELETE', '/api/admin/tickets/:id', ({ params }) => { q.run('DELETE FROM tickets WHERE id = ?', int(params.id, 'id', 1)); return { ok: true }; }, { admin: true });

// ── payment methods ──
const pmInput = (b) => [str(b.name, 'الاسم', 2, 60), b.details ? str(b.details, 'التفاصيل', 0, 300) : '', b.active === false ? 0 : 1, int(b.sort ?? 0, 'الترتيب', -9999, 9999)];
route('GET', '/api/admin/payment-methods', () => ({ paymentMethods: q.all('SELECT * FROM payment_methods ORDER BY sort, id').map(pmDTO) }), { admin: true });
route('POST', '/api/admin/payment-methods', async ({ req, res }) => {
  const id = q.run('INSERT INTO payment_methods(name, details, active, sort) VALUES(?,?,?,?)', ...pmInput(await H.readJson(req))).lastInsertRowid;
  res.statusCode = 201; return { id: Number(id) };
}, { admin: true });
route('PUT', '/api/admin/payment-methods/:id', async ({ req, params }) => {
  q.run('UPDATE payment_methods SET name=?, details=?, active=?, sort=? WHERE id=?', ...pmInput(await H.readJson(req)), int(params.id, 'id', 1));
  return { ok: true };
}, { admin: true });
route('DELETE', '/api/admin/payment-methods/:id', ({ params }) => { q.run('DELETE FROM payment_methods WHERE id = ?', int(params.id, 'id', 1)); return { ok: true }; }, { admin: true });

// ── settings ──
route('GET', '/api/admin/settings', () => ({ discordInvite: getSetting('discord_invite', ''), faq: getSetting('faq', []) }), { admin: true });
route('PUT', '/api/admin/settings', async ({ req }) => {
  const b = await H.readJson(req);
  const invite = str(b.discordInvite, 'رابط الديسكورد', 10, 200);
  let u; try { u = new URL(invite); } catch { throw new HttpError(400, 'رابط الديسكورد غير صحيح'); }
  if (u.protocol !== 'https:') throw new HttpError(400, 'الرابط لازم يبدأ بـ https://'); // it becomes an <a href>, so no javascript: URLs
  if (!Array.isArray(b.faq) || b.faq.length > 20) throw new HttpError(400, 'الأسئلة الشائعة غير صحيحة');
  const faq = b.faq.map((f) => ({ q: str(f?.q, 'السؤال', 1, 200), a: str(f?.a, 'الإجابة', 1, 1000) }));
  setSetting('discord_invite', u.href);
  setSetting('faq', faq);
  return { ok: true };
}, { admin: true });

// ───────────────────────── static files (explicit allow-list) ─────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

function serveStatic(req, res, pathname) {
  if (pathname === '/dashboard') return H.redirect(res, '/dashboard/', 301);
  let rel = pathname === '/' ? '/index.html' : pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  const allowed = rel === '/index.html' || rel.startsWith('/assets/') || rel.startsWith('/dashboard/');
  let file;
  try { file = path.join(config.ROOT, decodeURIComponent(rel)); } catch { allowed && (file = null); }
  if (!allowed || !file || rel.includes('\0') || !file.startsWith(config.ROOT + path.sep)) return notFound(res);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    const ext = path.extname(file).toLowerCase();
    if (!MIME[ext]) return notFound(res);
    res.setHeader('Content-Type', MIME[ext]);
    res.setHeader('Content-Length', st.size);
    res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=3600');
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}
function notFound(res) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('Not found'); }

// ───────────────────────── server ─────────────────────────
function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://cdn.discordapp.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  try {
    const url = new URL(req.url, config.origin);
    const { pathname } = url;
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
      return serveStatic(req, res, pathname);
    }
    // CSRF defence in depth: browsers always send Origin on cross-site writes. Must match our own origin.
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== config.origin) throw new HttpError(403, 'Origin غير مسموح');

    let match = null; let params = {};
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(pathname);
      if (m) { match = r; params = m.groups || {}; break; }
    }
    if (!match) throw new HttpError(404, 'مش موجود');
    const ctx = { req, res, params, query: Object.fromEntries(url.searchParams), ip: H.clientIp(req) };
    if (match.admin) ctx.admin = await requireAdmin(req);
    const out = await match.handler(ctx);
    if (!res.writableEnded) H.json(res, out);
  } catch (e) {
    if (res.writableEnded) return;
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    res.statusCode = status;
    H.json(res, { error: status === 500 ? 'حصل خطأ في السيرفر' : e.message });
  }
});

setInterval(() => {
  const now = Date.now();
  q.run('DELETE FROM admin_sessions WHERE expires_at < ?', now);
}, 3600_000).unref();

server.listen(config.port, () => {
  console.log(`AURABOT running → ${config.baseUrl}  (dashboard: ${config.baseUrl}/dashboard/)`);
  if (!config.discord.ready) console.warn('⚠️  Discord not fully configured (.env): the Admin Dashboard login is disabled until DISCORD_* and ADMIN_ROLE_IDS are set.');
});
