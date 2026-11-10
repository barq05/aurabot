'use strict';
const crypto = require('node:crypto');
const config = require('./config');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
// Tokens are random (not guessable); we store only a keyed hash so a DB leak doesn't leak live sessions.
const hashToken = (t) => crypto.createHmac('sha256', config.sessionSecret).update(String(t)).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ }
  }
  return out;
}

function cookie(name, value, { maxAge, path = '/', sameSite = 'Lax' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=${sameSite}`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  if (config.secureCookies) c += '; Secure';
  return c;
}

function addCookie(res, c) {
  const prev = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [].concat(prev, c));
}

function json(res, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data ?? {}));
}

function redirect(res, location, status = 302) {
  res.statusCode = status;
  res.setHeader('Location', location);
  res.end();
}

function readJson(req, max = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new HttpError(413, 'الطلب كبير أوي')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch { reject(new HttpError(400, 'بيانات غير صالحة')); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  if (config.trustProxy) {
    const parts = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    // Only the entry appended by OUR proxy (the last one) is trustworthy; earlier ones are client-controlled.
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { count: 1, reset: now + windowMs }); return; }
  if (++b.count > max) throw new HttpError(429, 'محاولات كتير، استنى شوية وجرب تاني');
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60_000).unref();

// ---- validation helpers ----
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
function str(v, field, min, max) {
  if (typeof v !== 'string') v = v == null ? '' : String(v);
  v = clean(v);
  if (v.length < min) throw new HttpError(400, `${field}: مطلوب${min > 1 ? ` (${min} حروف على الأقل)` : ''}`);
  if (v.length > max) throw new HttpError(400, `${field}: طويل أوي (الحد ${max} حرف)`);
  return v;
}
function int(v, field, min = 0, max = 1e9) {
  const n = Number(v);
  if (v === '' || v === null || !Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field}: قيمة غير صحيحة`);
  return n;
}
function num(v, field, min = 0, max = 1e7) {
  const n = Number(v);
  if (v === '' || v === null || !Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${field}: قيمة غير صحيحة`);
  return Math.round(n * 100) / 100;
}

module.exports = { HttpError, token, hashToken, safeEqual, parseCookies, cookie, addCookie, json, redirect, readJson, clientIp, rateLimit, str, int, num };
