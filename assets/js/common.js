'use strict';
// Helpers shared by the website and the dashboard. No inline scripts anywhere (strict CSP).
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// Every dynamic string that ends up in innerHTML goes through esc() → no XSS from user-supplied text.
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const safeUrl = (u) => (/^https:\/\//i.test(u || '') ? u : '#');
const money = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const fmtDate = (ms) => new Date(ms).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { throw Object.assign(new Error('مفيش اتصال بالسيرفر'), { status: 0 }); }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || 'حصل خطأ، حاول تاني'), { status: res.status });
  return data;
}

function toast(msg, type = '') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg; t.setAttribute('role', 'status');
  box.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

// Modal: returns {el, close}. Closes on Esc / backdrop click / ✕.
function openModal(html, { onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="x" type="button" aria-label="إغلاق">×</button>${html}</div>`;
  const prevFocus = document.activeElement;
  const close = () => { document.removeEventListener('keydown', onKey); back.remove(); if (onClose) onClose(); prevFocus && prevFocus.focus && prevFocus.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $('.x', back).addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  const first = $('input, select, textarea, button.btn', back); if (first) first.focus();
  return { el: $('.modal', back), close };
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
