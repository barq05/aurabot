'use strict';
(() => {
  const app = $('#app');
  const S = { products: [], best: [], pms: [], invite: '', faq: [], hasOrders: false };
  const TYPES = { support: 'طلب دعم فني', complaint: 'شكوى', inquiry: 'استفسار' };
  const ORDER_ST = { placed: 'تم الطلب', paid: 'تم الدفع', delivered: 'تم التسليم', cancelled: 'ملغي' };
  const TICKET_ST = { open: 'مفتوحة', answered: 'تم الرد', closed: 'مغلقة' };
  const STEPS = [
    ['اختار المنتج', 'اختار المنتج اللي انت عايزه و اضغط شراء'],
    ['اختار طريقة الدفع', 'اختار طريقة الدفع المناسبة وسجّل بياناتك، والإدارة هتتواصل معاك لإتمام التحويل'],
    ['تابع الطلب', 'من قسم طلباتي تقدر تتابع حالة طلبك'],
    ['نسلّمك البوت', 'بعد اكمال الشراء الادارة بتشغلك البوت على سيرفرك'],
  ];

  // ───────── data ─────────
  async function loadPublic() {
    const d = await api('/public');
    S.products = d.products; S.best = d.bestSellerIds; S.pms = d.paymentMethods;
    S.invite = d.settings.discordInvite; S.faq = d.settings.faq;
  }
  async function refreshMe() {
    try { S.hasOrders = (await api('/me')).hasOrders; } catch { S.hasOrders = false; }
    $('#nav-orders').hidden = !S.hasOrders; // cosmetic only — the server enforces access on /api/orders
  }

  // ───────── templates ─────────
  const productCard = (p) => `
    <article class="card product">
      ${p.discount ? `<span class="badge-sale">خصم ${p.discount}%</span>` : ''}
      <h3>${esc(p.name)}</h3>
      <div class="price"><span class="amount">${money(p.finalPrice)}</span><span class="cur">ج . م</span></div>
      ${p.discount ? `<div class="old">${money(p.price)}</div>` : ''}
      ${p.giftName ? `<div class="gift">🎁 هدية مجانية:<br>${esc(p.giftName)}</div>` : ''}
      <div class="spacer"></div>
      <div class="actions">
        <button class="linkbtn" type="button" data-act="details" data-id="${p.id}">تفاصيل المنتج</button>
        <button class="btn sm" type="button" data-act="buy" data-id="${p.id}">شراء</button>
      </div>
    </article>`;
  const inviteBtn = (label, cls = 'btn') => `<a class="${cls}" href="${esc(safeUrl(S.invite))}" target="_blank" rel="noopener noreferrer">${label}</a>`;

  // ───────── pages ─────────
  const pages = {
    async home() {
      const best = S.best.map((id) => S.products.find((p) => p.id === id)).filter(Boolean);
      app.innerHTML = `
        <section class="hero">
          <div>
            <span class="chip">الصفحة الرئيسية</span>
            <h1>افضل خدمات شراء البوتات<br>بأفضل الاسعار<br>عند <span class="wordmark">AURABOT</span></h1>
            <p>بنصمم ونبيع بوتات جاهزة ومخصصة، ونتابع سيرفرك. اختار الباقة، ونسلّمك البوت شغّال.</p>
            <div class="hero-actions"><a class="btn" href="#/store">تصفح المتجر</a>${inviteBtn('سيرفر الديسكورد', 'btn ghost')}</div>
          </div>
          <img src="/assets/img/hero-a.png" alt="AURABOT" width="430" height="438">
        </section>

        ${best.length ? `<section class="section">
          <div class="section-head"><span class="chip" style="visibility:hidden">.</span><h2 class="section-title">الاكثر شراءً</h2>
            <a class="btn sm" href="#/store">تصفح باقي البوتات ←</a></div>
          <div class="grid">${best.map(productCard).join('')}</div></section>` : ''}

        <section class="section"><span class="chip">ازاي اطلب بوت ؟</span>
          <div class="steps">${STEPS.map(([t, d], i) => `<div class="card step"><span class="n">${i + 1}</span><h3>${t}</h3><p>${d}</p></div>`).join('')}</div>
        </section>

        ${S.pms.length ? `<section class="section"><span class="chip">طرق الدفع المتاحة :</span>
          <div class="pays">${S.pms.map((m) => `<div class="card pay"><h3>${esc(m.name)}</h3>${m.details ? `<p>${esc(m.details)}</p>` : ''}</div>`).join('')}</div></section>` : ''}

        <section class="section"><span class="chip">الاسئلة الشائعة :</span>
          ${S.faq.map((f, i) => `<details class="faq" ${i === 0 ? 'open' : ''}><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}
        </section>

        <section class="cta"><h2>جاهز نبدأ ؟</h2><p>ادخل سيرفر الديسكورد وقولنا إنت محتاج إيه.</p>${inviteBtn('خش سيرفر الديسكورد')}</section>`;
    },

    async store() {
      app.innerHTML = `<span class="chip">المنتجات :</span><div class="grid" style="margin-top:24px">
        ${S.products.length ? S.products.map(productCard).join('') : '<p class="empty">مفيش منتجات دلوقتي</p>'}</div>`;
    },

    async about() {
      app.innerHTML = `<section class="about"><img src="/assets/img/hero-a.png" alt="" width="260" height="265">
        <span class="wordmark grad-text">AURABOT</span>
        <h2>FOUNDER : Ahmed Gaber</h2>
        <p>احنا AURABOT لبيع بوتات ديسكورد بأفضل الامكانيات والاسعار، البوتات بكذا نوع بتبدا من بوتات الترحيب البسيطة لحد بوتات السيستم الضخمة.</p></section>`;
    },

    async tickets() {
      app.innerHTML = `<span class="chip">التذاكر :</span><p class="lead">ابعت طلب دعم أو شكوى وتابع الرد من هنا.</p>
        <div class="two-col" style="margin-top:18px">
          <form class="card panel" id="ticket-form" novalidate>
            <div class="field"><select class="input" name="type" aria-label="نوع التذكرة">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
            <div class="field"><input class="input" name="discordUser" maxlength="64" placeholder="يوزر الديسكورد (للتواصل)" aria-label="يوزر الديسكورد" required></div>
            <div class="field"><input class="input" name="subject" maxlength="100" placeholder="عنوان الرسالة" aria-label="عنوان الرسالة" required></div>
            <div class="field"><textarea class="input" name="message" maxlength="2000" placeholder="اشرح المشكلة بالتفصيل" aria-label="تفاصيل المشكلة" required></textarea></div>
            <button class="btn" type="submit">إرسال التذكرة</button>
          </form>
          <div class="card panel"><span class="chip">تذاكري :</span><div id="my-tickets" style="margin-top:14px"><div class="spinner"></div></div>
            <p class="lead" style="font-size:13px;margin-top:14px">التذاكر بتتحفظ على المتصفح ده. لو غيّرت الجهاز كلمنا على الديسكورد.</p></div>
        </div>`;
      $('#ticket-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target; const btn = $('button', f); btn.disabled = true;
        try {
          await api('/tickets', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
          f.reset(); toast('تم إرسال التذكرة ✅', 'ok'); await refreshMe(); await loadTickets();
        } catch (err) { toast(err.message, 'err'); } finally { btn.disabled = false; }
      });
      await loadTickets();
    },

    async orders() {
      let orders;
      try { orders = (await api('/orders')).orders; } catch (e) {
        toast(e.status === 403 ? e.message : 'حصل خطأ', 'err'); location.hash = '#/'; return;
      }
      app.innerHTML = `<section class="orders-box"><span class="chip">طلباتي :</span>
        <div class="grid" style="margin-top:22px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${orders.map((o) => `
          <article class="card order">
            <h3>رقم الطلب : <bdi dir="ltr">${esc(o.code)}</bdi></h3>
            <dl>
              <div><dt>الطلب :</dt><dd>${esc(o.productName)}</dd></div>
              <div><dt>السعر :</dt><dd>${money(o.price)} ج.م</dd></div>
              <div><dt>الحالة :</dt><dd><span class="badge b-${esc(o.status)}">${ORDER_ST[o.status] || esc(o.status)}</span></dd></div>
              <div><dt>طريقة الدفع :</dt><dd>${esc(o.paymentMethod)}</dd></div>
              <div><dt>ملاحظات :</dt><dd>${o.giftName ? `يوجد معه بوت هدية ( ${esc(o.giftName)} )` : 'لا يوجد ملاحظات'}${o.notes ? `<br>ملاحظتك: ${esc(o.notes)}` : ''}${o.adminNote ? `<br>من الإدارة: ${esc(o.adminNote)}` : ''}</dd></div>
              <div><dt>التاريخ :</dt><dd>${fmtDate(o.createdAt)}</dd></div>
            </dl>
            <div class="actions"><button class="btn sm" type="button" data-act="chat" data-code="${esc(o.code)}">دردشة الطلب</button></div>
          </article>`).join('')}</div></section>`;
    },
  };

  async function loadTickets() {
    const box = $('#my-tickets'); if (!box) return;
    const { tickets } = await api('/tickets');
    box.innerHTML = tickets.length ? tickets.map((t) => `
      <div class="ticket"><header><h4>#${t.id} — ${esc(t.subject)}</h4><span class="badge b-${esc(t.status)}">${TICKET_ST[t.status]}</span></header>
        <div class="meta">${TYPES[t.type] || ''} · ${fmtDate(t.createdAt)}</div>
        ${t.replies.map((r) => `<div class="msg ${r.author === 'admin' ? 'admin' : 'customer'}"><small>${r.author === 'admin' ? 'الإدارة' : 'أنت'} · ${fmtDate(r.createdAt)}</small>${esc(r.body)}</div>`).join('')}
        ${t.status !== 'closed' ? `<form class="reply-form" data-ticket="${t.id}"><input class="input" name="body" maxlength="2000" placeholder="اكتب ردك..." aria-label="ردك" required><button class="btn sm" type="submit">إرسال</button></form>` : ''}
      </div>`).join('') : '<p class="empty">لا يوجد تذاكر</p>';
  }

  // ───────── modals ─────────
  function detailsModal(p) {
    const m = openModal(`<h2>${esc(p.name)}</h2>
      <p style="white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--f-soft)">${esc(p.description) || 'لا يوجد وصف.'}</p>
      ${p.giftName ? `<div class="gift" style="margin:10px 0">🎁 هدية مجانية: ${esc(p.giftName)}</div>` : ''}
      <p class="amount" style="font-family:var(--f-head);font-size:38px;margin:8px 0">${money(p.finalPrice)} <small style="font-size:16px">ج . م</small></p>
      <div class="row-btns"><button class="btn" type="button" data-act="buy-from-details">شراء</button></div>`);
    $('[data-act="buy-from-details"]', m.el).addEventListener('click', () => { m.close(); buyModal(p); });
  }

  function buyModal(p) {
    if (!S.pms.length) return toast('مفيش طرق دفع متاحة دلوقتي، كلمنا على الديسكورد', 'err');
    const m = openModal(`<h2>شراء: ${esc(p.name)}</h2>
      <p class="lead" style="margin-top:-6px">السعر: <b>${money(p.finalPrice)} ج.م</b>${p.giftName ? ` + هدية: ${esc(p.giftName)}` : ''}</p>
      <form id="buy-form" novalidate>
        <div class="field"><label>طريقة الدفع</label><div class="pm-list">${S.pms.map((x, i) => `
          <label class="pm-opt"><input type="radio" name="paymentMethodId" value="${x.id}" ${i === 0 ? 'checked' : ''}><span>${esc(x.name)}${x.details ? `<small>${esc(x.details)}</small>` : ''}</span></label>`).join('')}</div></div>
        <div class="field"><label for="b-name">الاسم</label><input class="input" id="b-name" name="buyerName" maxlength="60" required></div>
        <div class="field"><label for="b-ds">يوزر الديسكورد</label><input class="input" id="b-ds" name="discordUser" maxlength="64" placeholder="username" required></div>
        <div class="field"><label for="b-sv">اسم أو رابط السيرفر اللي هنركّب عليه البوت</label><input class="input" id="b-sv" name="serverInfo" maxlength="120" required></div>
        <div class="field"><label for="b-nt">ملاحظات (اختياري)</label><textarea class="input" id="b-nt" name="notes" maxlength="500" style="min-height:70px"></textarea></div>
        <p class="lead" style="font-size:14px">الدفع والتأكيد بيتم مباشرة بينك وبين الإدارة على الديسكورد بعد تسجيل الطلب.</p>
        <div class="row-btns"><button class="btn" type="submit">تسجيل الطلب</button></div>
      </form>`);
    $('#buy-form', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target; const btn = $('button[type=submit]', f); btn.disabled = true;
      const body = Object.fromEntries(new FormData(f));
      body.productId = p.id; body.paymentMethodId = Number(body.paymentMethodId);
      try {
        const r = await api('/orders', { method: 'POST', body });
        await refreshMe();
        m.el.innerHTML = `<button class="x" type="button" aria-label="إغلاق">×</button>
          <h2>تم تسجيل طلبك ✅</h2>
          <p>رقم الطلب: <bdi class="wordmark" dir="ltr">${esc(r.code)}</bdi><br>المنتج: ${esc(r.productName)} — ${money(r.price)} ج.م<br>طريقة الدفع: ${esc(r.paymentMethod)}</p>
          <div class="access-box">كود استرجاع الطلب (احتفظ بيه، مش هيظهر تاني)<b>${esc(r.accessCode)}</b><small class="lead">بيفيدك لو فتحت طلباتك من جهاز تاني</small></div>
          <p>الخطوة الجاية: ادخل سيرفر الديسكورد وابعت رقم الطلب، وهنتفق معاك على الدفع والتسليم.</p>
          <div class="row-btns"><a class="btn ghost" href="#/orders" data-act="close-modals">طلباتي</a>${inviteBtn('سيرفر الديسكورد')}</div>`;
        $('.x', m.el).addEventListener('click', () => m.el.closest('.modal-back').remove());
        copyText(r.code);
      } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    });
  }

  function recoverModal() {
    const m = openModal(`<h2>استرجاع الطلبات</h2><p class="lead">اكتب رقم الطلب والكود اللي ظهرلك وقت الشراء.</p>
      <form id="rec-form" novalidate>
        <div class="field"><label for="r-code">رقم الطلب</label><input class="input" id="r-code" name="code" placeholder="#ABC123" maxlength="12" dir="ltr" required></div>
        <div class="field"><label for="r-acc">كود الاسترجاع</label><input class="input" id="r-acc" name="accessCode" placeholder="XXXX-XXXX" maxlength="12" dir="ltr" required></div>
        <div class="row-btns"><button class="btn" type="submit">استرجاع</button></div></form>`);
    $('#rec-form', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/orders/recover', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        await refreshMe(); m.close(); toast('تم الاسترجاع ✅', 'ok'); location.hash = '#/orders';
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  // ───────── events (delegation; no inline handlers because of the CSP) ─────────
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const p = S.products.find((x) => x.id === Number(el.dataset.id));
    switch (el.dataset.act) {
      case 'details': if (p) detailsModal(p); break;
      case 'buy': if (p) buyModal(p); break;
      case 'close-modals': $$('.modal-back').forEach((x) => x.remove()); break;
      case 'chat': { // order chat happens on Discord: copy the order number, then open the server
        const ok = await copyText(el.dataset.code);
        toast(ok ? `تم نسخ رقم الطلب ${el.dataset.code} — ابعته لنا على الديسكورد` : `رقم الطلب: ${el.dataset.code}`, 'ok');
        window.open(safeUrl(S.invite), '_blank', 'noopener,noreferrer'); break;
      }
    }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('.reply-form'); if (!f) return;
    e.preventDefault();
    try { await api(`/tickets/${f.dataset.ticket}/replies`, { method: 'POST', body: { body: new FormData(f).get('body') } }); await loadTickets(); }
    catch (err) { toast(err.message, 'err'); }
  });
  $('#recover-link').addEventListener('click', recoverModal);

  // ───────── router ─────────
  async function render() {
    const name = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'home';
    const page = pages[name] ? name : 'home';
    $$('.nav-links a').forEach((a) => a.classList.toggle('active', a.dataset.route === page));
    app.innerHTML = '<div class="spinner"></div>';
    try { await pages[page](); } catch (err) { app.innerHTML = `<p class="empty">${esc(err.message)}</p>`; }
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', render);
  (async () => {
    try { await Promise.all([loadPublic(), refreshMe()]); } catch (err) { app.innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
    render();
  })();
})();
