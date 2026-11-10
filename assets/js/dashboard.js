'use strict';
(() => {
  const root = $('#root');
  const LOGIN_ERRORS = {
    not_member: 'حسابك مش عضو في سيرفر AURABOT.',
    no_role: 'حسابك مفيهوش رول إداري مسموح له بدخول لوحة التحكم.',
    cancelled: 'تم إلغاء تسجيل الدخول.',
    state: 'فشل التحقق الأمني. جرّب تسجّل دخول تاني.',
    failed: 'حصل خطأ أثناء تسجيل الدخول. جرّب تاني.',
    config: 'تسجيل الدخول غير مُعدّ على السيرفر (راجع ملف .env).',
  };
  const ORDER_ST = { placed: 'تم الطلب', paid: 'تم الدفع', delivered: 'تم التسليم', cancelled: 'ملغي' };
  const TICKET_ST = { open: 'مفتوحة', answered: 'تم الرد', closed: 'مغلقة' };
  const TYPES = { support: 'دعم فني', complaint: 'شكوى', inquiry: 'استفسار' };
  const TABS = [['overview', 'نظرة عامة'], ['products', 'المنتجات'], ['orders', 'الطلبات'], ['tickets', 'التذاكر'], ['payments', 'طرق الدفع'], ['settings', 'الإعدادات']];
  let tab = 'overview'; let selectedTicket = null; let counters = { newOrders: 0, openTickets: 0 };
  const opts = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');

  // ───────── login screen (Discord only; nothing secret in the browser) ─────────
  function loginView(errKey) {
    root.innerHTML = `<div class="login"><div class="box">
      <img src="/assets/img/hero-a.png" alt=""><span class="wordmark">AURABOT</span>
      <h1>لوحة التحكم</h1><p>الدخول للإدارة بس. سجّل دخولك بحساب Discord.</p>
      ${errKey ? `<div class="alert" role="alert">${esc(LOGIN_ERRORS[errKey] || LOGIN_ERRORS.failed)}</div>` : ''}
      <a class="btn" href="/api/admin/auth/login">تسجيل الدخول عبر Discord</a></div></div>`;
  }

  // ───────── shell ─────────
  function shell(me) {
    root.innerHTML = `<div class="shell">
      <aside class="side">
        <div class="brand"><img src="/assets/img/logo.png" alt=""><span class="wordmark grad-text">AURABOT</span></div>
        <nav aria-label="أقسام لوحة التحكم">${TABS.map(([k, v]) => `<button type="button" data-tab="${k}">${v}<span class="dot" data-dot="${k}" hidden></span></button>`).join('')}</nav>
        <div class="me">${me.avatar ? `<img src="${esc(me.avatar)}" alt="">` : '<span class="av"></span>'}<span>${esc(me.username)}</span>
          <button class="btn sm ghost" type="button" id="logout">خروج</button></div>
      </aside><main class="view" id="view"></main></div>`;
    $('#logout').addEventListener('click', async () => { try { await api('/admin/auth/logout', { method: 'POST', body: {} }); } catch {} loginView(); });
    $$('[data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  }
  async function go(t) {
    tab = t; history.replaceState(null, '', '#' + t);
    $$('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    const view = $('#view'); view.innerHTML = '<div class="spinner"></div>';
    try { await views[t](view); await updateDots(); } catch (e) {
      if (e.status === 401) { loginView(); return; }
      view.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  }
  async function updateDots() {
    try { counters = await api('/admin/stats'); } catch { return; }
    [['orders', counters.newOrders], ['tickets', counters.openTickets]].forEach(([k, n]) => { const d = $(`[data-dot="${k}"]`); if (d) { d.hidden = !n; d.textContent = n; } });
  }

  // ───────── generic form modal ─────────
  function fieldHtml(f) {
    const id = 'f-' + f.name, v = f.value ?? '';
    if (f.type === 'checkbox') return `<label class="check field"><input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
    let input;
    if (f.type === 'textarea') input = `<textarea class="input" id="${id}" name="${f.name}" maxlength="${f.max || 1000}">${esc(v)}</textarea>`;
    else if (f.type === 'select') input = `<select class="input" id="${id}" name="${f.name}">${f.options.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    else input = `<input class="input" id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${f.step ? `step="${f.step}"` : ''} maxlength="${f.max || 200}" ${f.required ? 'required' : ''}>`;
    return `<div class="field"><label for="${id}">${esc(f.label)}</label>${input}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</div>`;
  }
  function formModal({ title, fields, onSubmit, submit = 'حفظ' }) {
    const m = openModal(`<h2>${esc(title)}</h2><form novalidate>${fields.map(fieldHtml).join('')}<div class="row-btns"><button class="btn" type="submit">${submit}</button></div></form>`);
    $('form', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const vals = {};
      for (const f of fields) {
        const el = e.target.elements[f.name];
        vals[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'number' ? (el.value === '' ? null : Number(el.value)) : (f.nullable && el.value === '' ? null : f.numeric ? Number(el.value) : el.value);
      }
      const btn = $('button[type=submit]', e.target); btn.disabled = true;
      try { await onSubmit(vals); m.close(); } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    });
  }

  // ───────── views ─────────
  const views = {
    async overview(view) {
      const s = await api('/admin/stats');
      const card = (l, v) => `<div class="card stat"><small>${l}</small><b>${v}</b></div>`;
      view.innerHTML = `<h1>نظرة عامة</h1><div class="stats">
        ${card('كل الطلبات', s.orders)}${card('طلبات جديدة', s.newOrders)}${card('طلبات مدفوعة/مسلّمة', s.paidOrders)}
        ${card('الإيراد (ج.م)', money(s.revenue))}${card('تذاكر مفتوحة', s.openTickets)}${card('منتجات ظاهرة', s.products)}</div>`;
    },

    async products(view) {
      const { products } = await api('/admin/products');
      const giftOpts = (self) => [['', 'بدون هدية'], ...products.filter((p) => p.id !== self).map((p) => [p.id, p.name])];
      const fields = (p = {}) => [
        { name: 'name', label: 'اسم المنتج', value: p.name, required: true, max: 80 },
        { name: 'description', label: 'الوصف (بيظهر في "تفاصيل المنتج")', type: 'textarea', value: p.description, max: 1000 },
        { name: 'price', label: 'السعر (ج.م)', type: 'number', step: '0.01', value: p.price ?? 0 },
        { name: 'discount', label: 'خصم %', type: 'number', value: p.discount ?? 0 },
        { name: 'giftProductId', label: 'بوت هدية مع المنتج', type: 'select', options: giftOpts(p.id), value: p.giftProductId ?? '', nullable: true, numeric: true },
        { name: 'sort', label: 'الترتيب (الأصغر الأول)', type: 'number', value: p.sort ?? 0 },
        { name: 'featured', label: 'ضمن "الأكثر شراءً" (أولوية)', type: 'checkbox', value: p.featured },
        { name: 'active', label: 'ظاهر في المتجر', type: 'checkbox', value: p.active ?? true },
      ];
      view.innerHTML = `<div class="bar"><h1>المنتجات</h1><button class="btn" type="button" id="add">+ منتج جديد</button></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الاسم</th><th>السعر</th><th>خصم</th><th>هدية</th><th>مميز</th><th>الحالة</th><th></th></tr></thead><tbody>
        ${products.map((p) => `<tr><td>${esc(p.name)}</td><td>${money(p.price)}</td><td>${p.discount}%</td><td>${esc(products.find((x) => x.id === p.giftProductId)?.name || '—')}</td>
          <td>${p.featured ? '★' : ''}</td><td>${p.active ? 'ظاهر' : '<span class="muted">مخفي</span>'}</td>
          <td><div class="acts"><button class="btn sm" data-edit="${p.id}">تعديل</button><button class="btn sm danger" data-del="${p.id}">حذف</button></div></td></tr>`).join('')}
        </tbody></table></div>`;
      $('#add').onclick = () => formModal({ title: 'منتج جديد', fields: fields(), onSubmit: async (v) => { await api('/admin/products', { method: 'POST', body: v }); toast('تمت الإضافة', 'ok'); go('products'); } });
      $$('[data-edit]', view).forEach((b) => b.onclick = () => { const p = products.find((x) => x.id === Number(b.dataset.edit));
        formModal({ title: 'تعديل: ' + p.name, fields: fields(p), onSubmit: async (v) => { await api('/admin/products/' + p.id, { method: 'PUT', body: v }); toast('تم الحفظ', 'ok'); go('products'); } }); });
      $$('[data-del]', view).forEach((b) => b.onclick = async () => { if (!confirm('متأكد إنك عايز تحذف المنتج؟ (الطلبات القديمة هتفضل زي ما هي)')) return;
        try { await api('/admin/products/' + b.dataset.del, { method: 'DELETE' }); toast('تم الحذف', 'ok'); go('products'); } catch (e) { toast(e.message, 'err'); } });
    },

    async orders(view, filter = '') {
      const { orders } = await api('/admin/orders' + (filter ? `?status=${filter}` : ''));
      view.innerHTML = `<div class="bar"><h1>الطلبات</h1><select class="input" id="flt" style="width:auto" aria-label="فلتر الحالة"><option value="">كل الحالات</option>${opts(ORDER_ST, filter)}</select></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم الطلب</th><th>المنتج</th><th>السعر</th><th>العميل</th><th>الدفع</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead><tbody>
        ${orders.length ? orders.map((o) => `<tr><td dir="ltr">${esc(o.code)}</td><td>${esc(o.productName)}${o.giftName ? `<br><span class="muted">🎁 ${esc(o.giftName)}</span>` : ''}</td><td>${money(o.price)}</td>
          <td>${esc(o.buyerName)}<br><span class="muted" dir="ltr">${esc(o.discordUser)}</span></td><td>${esc(o.paymentMethod)}</td>
          <td><select data-status="${o.id}" aria-label="حالة الطلب">${opts(ORDER_ST, o.status)}</select></td><td class="muted">${fmtDate(o.createdAt)}</td>
          <td><button class="btn sm" data-open="${o.id}">تفاصيل</button></td></tr>`).join('') : '<tr><td colspan="8" class="muted" style="text-align:center;padding:30px">مفيش طلبات</td></tr>'}
        </tbody></table></div>`;
      $('#flt').onchange = (e) => views.orders(view, e.target.value);
      $$('[data-status]', view).forEach((s) => s.onchange = async () => { try { await api('/admin/orders/' + s.dataset.status, { method: 'PATCH', body: { status: s.value } }); toast('تم تحديث الحالة', 'ok'); updateDots(); } catch (e) { toast(e.message, 'err'); } });
      $$('[data-open]', view).forEach((b) => b.onclick = () => orderModal(orders.find((o) => o.id === Number(b.dataset.open)), () => views.orders(view, filter)));
    },

    async tickets(view) {
      const { tickets } = await api('/admin/tickets');
      if (!tickets.find((t) => t.id === selectedTicket)) selectedTicket = tickets[0]?.id ?? null;
      const t = tickets.find((x) => x.id === selectedTicket);
      view.innerHTML = `<h1>التذاكر</h1><div class="split"><div class="tlist">${tickets.length ? tickets.map((x) => `
        <button class="titem ${x.id === selectedTicket ? 'active' : ''}" data-t="${x.id}"><b>#${x.id} ${esc(x.subject)}</b>
          <span class="badge b-${esc(x.status)}">${TICKET_ST[x.status]}</span> <span class="muted">${TYPES[x.type] || ''} · ${fmtDate(x.updatedAt)}</span></button>`).join('') : '<p class="muted">مفيش تذاكر</p>'}</div>
        <div>${t ? `<div class="card detail"><dl><dt>العنوان</dt><dd>${esc(t.subject)}</dd><dt>النوع</dt><dd>${TYPES[t.type] || ''}</dd><dt>يوزر ديسكورد</dt><dd dir="ltr">${esc(t.discordUser)}</dd></dl>
          ${t.replies.map((r) => `<div class="msg ${r.author === 'admin' ? 'admin' : 'customer'}"><small>${r.author === 'admin' ? 'الإدارة' : 'العميل'} · ${fmtDate(r.createdAt)}</small>${esc(r.body)}</div>`).join('')}
          <form id="rf" class="field" style="margin-top:14px"><textarea class="input" name="body" maxlength="2000" placeholder="اكتب ردك..." required></textarea><div class="row-btns" style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" type="submit">إرسال الرد</button><select class="input" id="tst" style="width:auto" aria-label="حالة التذكرة">${opts(TICKET_ST, t.status)}</select><button class="btn danger" type="button" id="tdel">حذف</button></div></form></div>` : ''}</div></div>`;
      $$('[data-t]', view).forEach((b) => b.onclick = () => { selectedTicket = Number(b.dataset.t); views.tickets(view); });
      if (!t) return;
      $('#rf').onsubmit = async (e) => { e.preventDefault(); try { await api(`/admin/tickets/${t.id}/replies`, { method: 'POST', body: { body: new FormData(e.target).get('body') } }); toast('تم إرسال الرد', 'ok'); views.tickets(view); updateDots(); } catch (er) { toast(er.message, 'err'); } };
      $('#tst').onchange = async (e) => { try { await api('/admin/tickets/' + t.id, { method: 'PATCH', body: { status: e.target.value } }); toast('تم', 'ok'); views.tickets(view); updateDots(); } catch (er) { toast(er.message, 'err'); } };
      $('#tdel').onclick = async () => { if (!confirm('حذف التذكرة نهائيًا؟')) return; await api('/admin/tickets/' + t.id, { method: 'DELETE' }); views.tickets(view); updateDots(); };
    },

    async payments(view) {
      const { paymentMethods: list } = await api('/admin/payment-methods');
      const fields = (m = {}) => [
        { name: 'name', label: 'اسم طريقة الدفع', value: m.name, required: true, max: 60 },
        { name: 'details', label: 'تفاصيل بتظهر للعميل (اختياري)', type: 'textarea', value: m.details, max: 300, hint: 'مثال: "فودافون كاش — هنتواصل معاك على الديسكورد". متحطش أرقام حسابات حساسة لو مش عايزها تبقى عامة.' },
        { name: 'sort', label: 'الترتيب', type: 'number', value: m.sort ?? 0 },
        { name: 'active', label: 'مفعّلة', type: 'checkbox', value: m.active ?? true },
      ];
      view.innerHTML = `<div class="bar"><h1>طرق الدفع</h1><button class="btn" type="button" id="add">+ طريقة جديدة</button></div>
        ${list.map((m) => `<div class="card pm-card"><div><b style="font-family:var(--f-head);font-size:24px;font-weight:400">${esc(m.name)}</b> ${m.active ? '' : '<span class="muted">(معطّلة)</span>'}<br><span class="muted">${esc(m.details) || '—'}</span></div>
          <div class="acts"><button class="btn sm" data-edit="${m.id}">تعديل</button><button class="btn sm danger" data-del="${m.id}">حذف</button></div></div>`).join('')}`;
      $('#add').onclick = () => formModal({ title: 'طريقة دفع جديدة', fields: fields(), onSubmit: async (v) => { await api('/admin/payment-methods', { method: 'POST', body: v }); go('payments'); } });
      $$('[data-edit]', view).forEach((b) => b.onclick = () => { const m = list.find((x) => x.id === Number(b.dataset.edit)); formModal({ title: 'تعديل', fields: fields(m), onSubmit: async (v) => { await api('/admin/payment-methods/' + m.id, { method: 'PUT', body: v }); go('payments'); } }); });
      $$('[data-del]', view).forEach((b) => b.onclick = async () => { if (!confirm('حذف طريقة الدفع؟')) return; await api('/admin/payment-methods/' + b.dataset.del, { method: 'DELETE' }); go('payments'); });
    },

    async settings(view) {
      const s = await api('/admin/settings');
      const faqRow = (f = { q: '', a: '' }) => `<div class="faq-row"><input class="input" data-q placeholder="السؤال" maxlength="200" value="${esc(f.q)}"><textarea class="input" data-a placeholder="الإجابة" maxlength="1000" style="min-height:70px">${esc(f.a)}</textarea><button class="btn sm danger" type="button" data-rm style="justify-self:end">حذف السؤال</button></div>`;
      view.innerHTML = `<h1>الإعدادات</h1><div class="card detail" style="max-width:820px">
        <div class="field"><label for="inv">رابط سيرفر الديسكورد (https://...)</label><input class="input" id="inv" dir="ltr" maxlength="200" value="${esc(s.discordInvite)}"></div>
        <h3 style="margin:18px 0 10px">الأسئلة الشائعة</h3><div id="faqs">${s.faq.map(faqRow).join('')}</div>
        <div class="row-btns" style="display:flex;gap:8px;margin-top:10px"><button class="btn ghost" type="button" id="addq">+ سؤال</button><button class="btn" type="button" id="save">حفظ الإعدادات</button></div></div>`;
      const bind = () => $$('[data-rm]', view).forEach((b) => b.onclick = () => b.closest('.faq-row').remove());
      bind();
      $('#addq').onclick = () => { $('#faqs').insertAdjacentHTML('beforeend', faqRow()); bind(); };
      $('#save').onclick = async () => {
        const faq = $$('.faq-row', view).map((r) => ({ q: $('[data-q]', r).value, a: $('[data-a]', r).value })).filter((f) => f.q.trim() || f.a.trim());
        try { await api('/admin/settings', { method: 'PUT', body: { discordInvite: $('#inv').value, faq } }); toast('تم حفظ الإعدادات ✅', 'ok'); } catch (e) { toast(e.message, 'err'); }
      };
    },
  };

  function orderModal(o, refresh) {
    const m = openModal(`<h2>طلب <span dir="ltr">${esc(o.code)}</span></h2>
      <dl class="detail" style="display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0 0 14px;font-size:15px">
        <dt>المنتج</dt><dd>${esc(o.productName)} — ${money(o.price)} ج.م</dd>${o.giftName ? `<dt>الهدية</dt><dd>${esc(o.giftName)}</dd>` : ''}
        <dt>طريقة الدفع</dt><dd>${esc(o.paymentMethod)}</dd><dt>الاسم</dt><dd>${esc(o.buyerName)}</dd>
        <dt>ديسكورد</dt><dd dir="ltr">${esc(o.discordUser)}</dd><dt>السيرفر</dt><dd>${esc(o.serverInfo)}</dd>
        <dt>ملاحظات العميل</dt><dd>${esc(o.notes) || '—'}</dd><dt>التاريخ</dt><dd>${fmtDate(o.createdAt)}</dd></dl>
      <div class="field"><label for="os">الحالة</label><select class="input" id="os">${opts(ORDER_ST, o.status)}</select></div>
      <div class="field"><label for="on">ملاحظة بتظهر للعميل في "طلباتي"</label><textarea class="input" id="on" maxlength="500" style="min-height:70px">${esc(o.adminNote)}</textarea></div>
      <div class="row-btns"><button class="btn danger" type="button" id="od">حذف الطلب</button><button class="btn" type="button" id="osave">حفظ</button></div>`);
    $('#osave', m.el).onclick = async () => { try { await api('/admin/orders/' + o.id, { method: 'PATCH', body: { status: $('#os', m.el).value, adminNote: $('#on', m.el).value } }); m.close(); toast('تم الحفظ', 'ok'); refresh(); updateDots(); } catch (e) { toast(e.message, 'err'); } };
    $('#od', m.el).onclick = async () => { if (!confirm('حذف الطلب نهائيًا؟')) return; await api('/admin/orders/' + o.id, { method: 'DELETE' }); m.close(); refresh(); updateDots(); };
  }

  // ───────── boot ─────────
  (async () => {
    const err = new URLSearchParams(location.search).get('error');
    if (err) { history.replaceState(null, '', location.pathname); }
    try {
      const me = await api('/admin/me');
      shell(me);
      go(TABS.some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : 'overview');
    } catch (e) { loginView(err || (e.status === 401 ? '' : 'failed')); }
  })();
})();
