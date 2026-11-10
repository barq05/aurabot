# AURABOT — الموقع + لوحة التحكم + البوت

```
/index.html            ← الموقع الرئيسي (Home / Store / Tickets / About / My Orders)
/dashboard/index.html  ← لوحة التحكم (دخول Discord فقط)
/server/               ← الـ Backend (Node.js بدون مكتبات خارجية + SQLite)
/bot/index.js          ← بوت Discord (اختياري للتشغيل، بيطبع تقرير الإعداد والـ Role IDs)
/assets/               ← CSS / JS / الصور / الخطوط
```

الموقع واللوحة بيشتغلوا من **نفس السيرفر ونفس الداتابيز** (`data/aurabot.db`)، فأي تعديل في اللوحة بيظهر في الموقع فورًا.

> ⚠️ **GitHub Pages مش هينفع** لوحده: بيستضيف ملفات ثابتة بس، والمشروع محتاج Backend (دخول Discord، الطلبات، الداتابيز).
> GitHub هنا مكان الكود، والتشغيل على استضافة Node (Render / Railway / VPS) — شوف "النشر" تحت.

## 1) التشغيل محليًا
```bash
cp .env.example .env      # وعبّي القيم (الخطوة 2)
npm install               # بس عشان البوت (discord.js). السيرفر نفسه مش محتاج مكتبات
npm start                 # http://localhost:3000   |   اللوحة: http://localhost:3000/dashboard/
```
محتاج **Node 22.13 أو أحدث**. افتح الموقع بنفس العنوان اللي في `BASE_URL` بالظبط (مش `127.0.0.1` لو كاتب `localhost`).

## 2) إعداد Discord (خطوة بخطوة)
1. ادخل [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → سمّيه AURABOT.
2. **General Information** → انسخ **Application ID** → `DISCORD_CLIENT_ID`.
3. **OAuth2** → **Reset Secret** → انسخ **Client Secret** → `DISCORD_CLIENT_SECRET` (بيظهر مرة واحدة).
4. **OAuth2 → Redirects → Add Redirect** وحط بالظبط: `BASE_URL/api/admin/auth/callback`
   (مثال: `http://localhost:3000/api/admin/auth/callback` ولما تنشر: `https://your-domain.com/api/admin/auth/callback`). لازم تطابق حرفيًا.
5. **Bot** → **Reset Token** → انسخه → `DISCORD_BOT_TOKEN`. **مفيش Privileged Intents محتاجة تتفعل.**
6. **ضيف البوت لسيرفرك** (ضروري، السيرفر بيستخدمه للتحقق من الرولز): **OAuth2 → URL Generator** → Scopes: `bot` → Permissions: `View Channels` + `Send Messages` (لو عايز إشعارات) → افتح الرابط واختار سيرفرك.
7. في Discord: **Settings → Advanced → Developer Mode** (شغّله). كليك يمين على اسم السيرفر → **Copy Server ID** → `DISCORD_GUILD_ID`.
8. **Role IDs المسموحة**: Server Settings → Roles → كليك يمين على الرول → **Copy Role ID**، وحطهم مفصولين بفاصلة في `ADMIN_ROLE_IDS=123,456`.
   (أو شغّل `npm run bot` وهيطبع كل الرولز مع الـ IDs.)
9. (اختياري) إشعارات الطلبات/التذاكر: كليك يمين على الروم → **Copy Channel ID** → `NOTIFY_CHANNEL_ID` (والبوت لازم يقدر يكتب فيه).

### إزاي الدخول بيتحقق؟
`Discord OAuth2 (scope: identify)` ← السيرفر بياخد هوية الشخص ← **السيرفر** بيسأل Discord بتوكن البوت: "هل الشخص ده عضو في السيرفر وعنده واحد من الرولز المسموحة؟" ← لو لأ يترفض، لو آه يتعمله session.
- الـ Client Secret وتوكن البوت **مش موجودين في أي ملف frontend**، بس في `.env` على السيرفر.
- الرولز بتتراجع كل 5 دقايق: لو سحبت الرول من حد وهو داخل، بيتطرد من اللوحة تلقائيًا (ولو Discord مش متاح، الدخول بيتقفل).
- الجلسة 8 ساعات، كوكي `HttpOnly` + `SameSite=Strict` ومحصور على `/api/admin`.

## 3) إزاي "طلباتي" متحمية؟
مفيش تسجيل دخول للعملاء. أول ما العميل يسجّل طلب أو تذكرة، السيرفر بيديله **كوكي جلسة عشوائي** (`HttpOnly`) مربوط بسجل عميل في الداتابيز.
- `GET /api/orders` بيرجع **403** لو مفيش جلسة أو مفيش ولا طلب، وكل طلب بيتفلتر بـ `customer_id` بتاع الجلسة (حد مقدرش يشوف طلبات حد تاني).
- لينك "طلباتي" بيظهر بس لو `/api/me` قال إن عنده طلبات، لكن الحماية الحقيقية في السيرفر.
- كل طلب ليه **كود استرجاع** (بيظهر مرة واحدة وقت الشراء) يفتح الطلبات من جهاز تاني (رابط "استرجع طلباتك" في الفوتر)، والمحاولات محدودة.

## 4) الدفع
مفيش بوابة دفع. العميل بيختار طريقة الدفع ويكتب بياناته بس، والاتفاق على الدفع والتسليم بيتم مباشرة على الديسكورد. زرار "دردشة الطلب" بينسخ رقم الطلب ويفتح سيرفرك. حالة الطلب (تم الطلب / تم الدفع / تم التسليم / ملغي) بتغيّرها من اللوحة.

## 5) الخطوط
شوف `assets/fonts/README.md`: حط ملفات الخطوط بنفس الأسماء، ولو مش موجودة بيستخدم بدائل من Google Fonts.

## 6) النشر (مثال Render)
1. ارفع المشروع على GitHub (`.env` و`data/` متجاهلين في `.gitignore`).
2. Render → **New → Web Service** → اختار الريبو. Build: `npm install` — Start: `npm start`.
3. Environment: كل متغيرات `.env.example`، مع:
   `BASE_URL=https://اسم-موقعك` ، `TRUST_PROXY=true` ، `DATA_DIR=/var/data`.
4. **Disk**: أضف Persistent Disk مربوط على `/var/data` (من غيره الداتابيز بتتمسح مع كل نشر). Railway/VPS نفس الفكرة (Volume).
5. ضيف رابط الـ Callback الجديد في Discord Developer Portal (الخطوة 2.4).
6. لو بتشغّل البوت (`npm run bot`) خليه Background Worker أو process تاني. الموقع شغّال من غيره.

## ملاحظات أمان
- لا تنشر `.env` ولا توتن البوت. لو اتسرّب: Reset Token / Reset Secret فورًا.
- نسخ احتياطي: انسخ ملف `data/aurabot.db` بشكل دوري.
- بيانات أول تشغيل (5 بوتات تجريبية وطرق دفع وأسئلة شائعة) تقدر تعدلها/تحذفها من اللوحة.
