## V41 — المساعد العقاري الذكي

مساعد محادثة عربي يفهم وصف المستخدم، يستخرج المدينة ونوع العقار والبيع/الإيجار والغرف والميزانية والمساحة، ثم يبحث مباشرة في قاعدة بيانات عقارتكم ويحتفظ بسياق المحادثة.

# عقارتكم — V2.2 لوحة تحكم المالك والمكتب العقاري

نسخة مطورة من منصة عقارتكم السورية، مبنية على الواجهة السابقة مع PostgreSQL ونظام مستخدمين حقيقي ولوحة إدارة للعقارات.

## الجديد
- لوحة تحكم للمالك/المكتب العقاري.
- إحصائيات العقارات والمشاهدات والاستفسارات.
- إضافة العقارات من داخل لوحة التحكم.
- تعديل العقارات.
- حذف العقارات مع التحقق من ملكية العقار.
- رفع حتى 12 صورة للعقار، بحد أقصى 8MB للصورة.
- حذف صور العقار.
- تخزين بيانات الصور في PostgreSQL والملفات في مجلد `uploads/`.
- عداد مشاهدات حقيقي عند فتح صفحة العقار.
- نظام استفسارات للعقارات مع حالات: جديد، مقروء، تم الرد، مغلق.
- متابعة الاستفسارات من لوحة التحكم وتغيير حالتها.
- ربط كل العقارات بصاحب الحساب.

## التشغيل

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm start
```

ثم افتح:

`http://localhost:3000`

## قاعدة البيانات

يتم تشغيل `server/db/schema.sql` تلقائياً عند بدء الخادم. الجداول الجديدة:

- `property_images`
- `inquiries`

وتمت إضافة `views_count` إلى جدول `properties`.

## رفع الصور

حالياً الصور تحفظ محلياً داخل:

`uploads/`

عند نشر الموقع على بيئة إنتاج، يفضّل نقل التخزين إلى خدمة ملفات مثل S3-compatible object storage مع CDN، بدلاً من التخزين المحلي.

## واجهة API الجديدة

- `GET /api/me/dashboard`
- `PUT /api/me/properties/:id`
- `DELETE /api/me/properties/:id`
- `POST /api/me/properties/:id/images`
- `DELETE /api/me/properties/:id/images/:imageId`
- `GET /api/me/inquiries`
- `PATCH /api/me/inquiries/:id`
- `POST /api/properties/:id/inquiries`
- `GET /api/properties/:id` يزيد المشاهدات تلقائياً

## ملاحظات الإنتاج

قبل الإطلاق العام يفضّل إضافة: تخزين صور خارجي، ضغط الصور، فحص أعمق للملفات، CSRF protection، rate limiting، التحقق من الهاتف، رسائل SMS/Email، نسخ احتياطية للقاعدة، وسجل تدقيق للإدارة.

## V2.3 — صفحة تفاصيل العقار ولوحة الإدارة
- `property.html?id=ID`: صفحة تفاصيل احترافية، معرض صور، بيانات المالك، اتصال وواتساب، خريطة OpenStreetMap، المفضلة، والاستفسارات.
- `admin.html`: لوحة إدارة المستخدمين والعقارات والإعلانات والاستفسارات.
- متغيرات المدير في `.env`: `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. عند تشغيل الخادم لأول مرة يتم إنشاء حساب المدير تلقائياً إذا لم يكن موجوداً.
- يجب تغيير كلمة مرور المدير الافتراضية قبل النشر.

## نظام المكاتب العقارية المتقدم — V3.0

يتضمن V3.0 نظام CRM متكامل للمكاتب العقارية:
- مكتب مستقل مع بيانات المكتب والتوثيق.
- موظفون ومسوقون مرتبطون بالمكتب.
- إدارة العقارات وتعيينها للمسوقين.
- CRM للعملاء المحتملين ومراحل البيع.
- إدارة مواعيد ومعاينات العقارات.
- تسجيل الصفقات والعمولات.
- تقارير أداء الموظفين والعقارات وقيمة الصفقات.
- صفحة `office.html` كنقطة دخول لنظام المكتب.

### طريقة الاستخدام
1. سجل الدخول بحساب من نوع `agent` أو أنشئ حساباً عادياً ثم افتح `/office.html`.
2. إذا لم يكن لديك مكتب، اختر «إنشاء مكتب عقاري».
3. بعد إنشاء المكتب ستظهر لوحة CRM كاملة.
4. من «الموظفون» يمكن إنشاء حسابات المسوقين وربطهم بالمكتب.
5. العقارات التي ينشئها أعضاء المكتب ترتبط بالمكتب تلقائياً.

> في الإنتاج يجب تغيير كلمة مرور المدير الافتراضية في `.env` واستخدام HTTPS وتخزين الصور/الفيديوهات في Object Storage أو CDN.

## V3.5 — اشتراكات ونمو المكاتب
- `office-growth.html`: الباقات، الإعلانات المدفوعة، التوثيق، والمدفوعات.
- `office-public.html?slug=...`: صفحة عامة احترافية لكل مكتب.
- `checkout.html`: صفحة الدفع؛ الوضع الافتراضي `mock` للتطوير فقط.
- الجداول: `office_plans`, `office_subscriptions`, `office_ads`, `office_verifications`, `payments`.
- قبل الإنتاج يجب ربط مزود دفع حقيقي من جهة الخادم وإضافة Webhook للتحقق من المدفوعات، وعدم الاعتماد على الدفع التجريبي.


## V4 — سوق الإعلانات
- ترتيب تلقائي للعقارات المدفوعة في الصفحة الرئيسية ونتائج البحث.
- مواضع إعلانية: الصفحة الرئيسية، نتائج البحث، مميز، صفحة المدينة.
- أولوية وميزانية لكل حملة.
- تسجيل مرات الظهور والنقرات وCTR.
- لوحة المكتب لقياس أداء الحملات ونشر الحملات الموقوفة/المعلقة.
- العقارات المدفوعة تظهر أولاً فقط عندما تكون الحملة نشطة وضمن تاريخها وبعد اعتمادها.

## V4.1 — إحصائيات الحملات
- عداد ظهور (Impressions) لكل حملة.
- عداد نقرات لكل حملة.
- عداد نقرات واتساب لكل حملة.
- تسجيل تفاعلات واتساب عبر `/api/ads/events` باستخدام `event_type=whatsapp`.
- عرض إجمالي الظهور والنقرات والواتساب في سوق الإعلانات.
- عرض عداد واتساب بجانب كل حملة.


## V5 — البحث الجغرافي والخريطة
- البحث عن العقارات حسب نقطة جغرافية ونطاق 2/5/10/25/50 كم.
- تحديد نقطة البحث بالنقر على الخريطة.
- زر لاستخدام موقع المستخدم عبر متصفح الهاتف/الكمبيوتر بعد موافقته.
- عرض العقارات المطابقة على الخريطة مع تمييز الإعلان الممول.
- ترتيب العقارات الممولة داخل النطاق الجغرافي قبل العقارات العادية، مع مراعاة ترتيب المزاد الحالي.
- إضافة وتعديل إحداثيات العقار من خريطة داخل نموذج المالك.
- تخزين latitude/longitude وفهرستها في PostgreSQL.
- الخرائط تعتمد على Leaflet وOpenStreetMap.

## V6 — بوابة الدفع الحقيقية للمحفظة والإشتراكات
- تمت إضافة تكامل Moyasar كخيار دفع حقيقي/اختباري عبر `PAYMENT_PROVIDER=moyasar`.
- نموذج الدفع يعمل من الواجهة عبر Publishable Key، بينما التحقق النهائي من الدفع يتم من الخادم عبر Secret Key.
- يتم التحقق من `status` و`amount` و`currency` قبل إضافة رصيد المحفظة أو تفعيل الاشتراك.
- تمت إضافة Webhook: `POST /api/payments/moyasar/webhook` مع التحقق من `MOYASAR_WEBHOOK_SECRET`.
- الوضع `mock` يبقى متاحاً للتطوير المحلي.
- قبل الإنتاج: استخدم HTTPS، مفاتيح Live، واضبط Webhook في لوحة Moyasar.

## Sham Cash
- Added Sham Cash payment option for advertising wallet top-ups in SYP.
- Server verifies the entered Sham Cash transaction ID against the configured API before crediting the wallet.
- Configure `SHAM_CASH_API_BASE_URL`, `SHAM_CASH_API_KEY`, `SHAM_CASH_ACCOUNT_ADDRESS`, and `SHAM_CASH_RECIPIENT_LABEL` in `.env`.
- The payment connector uses a Sham Cash API-compatible REST endpoint; obtain API access/credentials from the official Sham Cash API program before production use.

## V8 — لوحة الإدارة المالية
- لوحة مالية كاملة للمدير: إجمالي المدفوعات، المدفوع، المعلق، الفاشل والمسترد.
- عرض جميع عمليات Moyasar وشام كاش وسيرياتيل كاش.
- اعتماد/رفض التحويلات اليدوية من الإدارة.
- عند اعتماد شحن المحفظة، يضاف الرصيد تلقائياً ويُسجل في دفتر المحفظة.
- استرداد المدفوعات مع تسجيل عملية الاسترداد.
- كشف حساب مستقل لكل مكتب.
- رقم فاتورة مالية تلقائي لكل عملية مدفوعة.
- إصدار فاتورة PDF من لوحة الإدارة.
- إضافة حقول مرجعية للعملية وحالة المراجعة والمراجع الإداري.
- سيرياتيل كاش يعمل كتحويل يدوي مع مراجعة الإدارة، ولا يتم اعتماد الرصيد قبل الموافقة.

### ملاحظة PDF
يستخدم خادم PDF محلياً عبر Chromium headless. يجب توفر Chromium في بيئة الإنتاج، أو استبداله بخدمة/محرك PDF مناسب للبيئة المستهدفة.

## V9 — Global Payments
- Added Stripe Checkout as a global payment option.
- Stripe-hosted Checkout can dynamically show cards and enabled methods such as Apple Pay and Google Pay according to Stripe account settings, currency, customer location and eligibility.
- Added PayPal Orders v2: server-side order creation and capture after buyer approval.
- Existing Moyasar, Sham Cash and Syriatel Cash remain available in the same payment selection.
- Global providers require supported currencies; SYP remains reserved for the Syrian cash methods in the current implementation.
- Stripe secret key and PayPal credentials must remain server-side in `.env`.

## V10 — العملات المتعددة ووسائل الدفع حسب الدولة
- اختيار الدولة في شحن المحفظة مع اقتراح العملة تلقائياً.
- اختيار العملة من العملات المدعومة.
- API عام: `GET /api/payment-options?country=SA&currency=SAR` يعيد وسائل الدفع المفعلة والمتاحة.
- وسائل الدفع تتغير حسب العملة والدولة وحالة إعداد مفاتيح المزود على الخادم.
- SYP: Sham Cash / Syriatel Cash.
- SAR: Moyasar + Stripe/PayPal عند تفعيلهما.
- العملات العالمية: Stripe/PayPal حسب العملة وإعداد الحساب.
- يمنع تغيير عملة محفظة المكتب عند وجود رصيد قائم.

## V11 — Multi-currency FX
- Cached exchange rates table
- Automatic refresh from configurable FX provider
- `/api/fx/rates`
- `/api/fx/convert`
- Wallet top-up shows estimated converted amount and live cached rate
- Configure `FX_PROVIDER_URL`, `FX_BASE_CURRENCY`, and `FX_CACHE_TTL_MS`
- Do not use FX conversion as a settlement amount unless the selected payment provider supports that currency; it is primarily for display/quote purposes.

## V14 — Saved Searches & Alerts
- Users can save their current property search with currency, price, city, type, rooms and map radius.
- In-app notifications are generated when a newly published property matches a saved search.
- Price matching converts the new property's currency to the saved search currency using the existing FX service.
- Geographic saved searches respect latitude/longitude and radius.
- Users can list, enable/disable alerts, delete saved searches, and view notifications.

## V15 — Multi-channel saved-search notifications
- In-app notifications per saved search.
- Web Push notifications using VAPID + service worker.
- Email notifications via SMTP/Nodemailer.
- WhatsApp notifications via Meta WhatsApp Cloud API.
- Each saved search stores independent notification channel preferences.
- Delivery attempts are logged in `notification_deliveries`.

### Environment
Set these in `.env` for the channels you want:
- `APP_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`

Generate VAPID keys once with:
`npx web-push generate-vapid-keys`

Push requires HTTPS in production (localhost is allowed for development). WhatsApp requires a configured Meta WhatsApp Business Cloud API sender and recipient eligibility according to Meta's current messaging rules.

## تفعيل التنبيهات متعددة القنوات
بعد تثبيت الحزم شغّل:
`npm run setup:notifications`

سيولّد مفاتيح VAPID تلقائياً ويضعها في `.env`. يجب إدخال بيانات SMTP وWhatsApp Cloud API الفعلية يدوياً في `.env`. لا تضع أي مفتاح سري في JavaScript أو صفحات HTML.

للتشغيل الإنتاجي استخدم HTTPS، وفعّل SMTP موثوقاً، وأنشئ تطبيق Meta/WhatsApp Cloud API مع رقم أعمال وقوالب WhatsApp المعتمدة عند الحاجة، ثم اختبر القنوات من تبويب "التنبيهات" في لوحة الإدارة.

## V17 — مراقبة السوق العقاري السوري
- لوحة `/market-monitor.html` داخل الإدارة.
- ربط مصادر Facebook Pages وInstagram Professional/Business accounts عبر Meta Graph API باستخدام صلاحيات وحسابات يملكها المستخدم.
- مزامنة تلقائية كل 24 ساعة (قابلة للتعديل) مع سقف يومي افتراضي 1000 إعلان.
- استخراج تلقائي للنص، الهاتف، المدينة، المنطقة، نوع العقار، بيع/إيجار، السعر، العملة، المساحة والغرف.
- إزالة التكرار وحفظ رابط المصدر والبيانات الخام.
- مراجعة الإدارة قبل اعتماد الإعلان.
- لا يتجاوز النظام صلاحيات Meta ولا يحاول تنزيل محتوى محمي أو تجاوز قيود الوصول.
- ملاحظة: Meta Ad Library API لا توفر حالياً بحثاً عاماً عن كل الإعلانات العقارية السورية؛ لذلك V17 يعتمد على صفحات/حسابات Meta التي تم ربطها رسمياً بالحساب والتصاريح المناسبة، وليس كشط الصفحات الخاصة أو تجاوز المنصة.

### إعداد V17
أضف إلى `.env`:
`META_GRAPH_API_VERSION=v23.0`
`META_MARKET_ACCESS_TOKEN=...`
`MARKET_SYNC_INTERVAL_HOURS=24`
`MARKET_DAILY_LIMIT=1000`


## عمولة بيع العقار
عمولة عقارتكم على عمليات البيع هي 1% من قيمة البيع، وتكون على ذمة البائع. لا تُحتسب هذه العمولة على عقود الإيجار. يتم احتسابها تلقائياً عند تسجيل الصفقة، مع حفظ نسبة العمولة وقيمتها والطرف الملزم بها.

## V19 — لوحة شركاء الفنادق
- `/hotel-partner.html` لوحة الفندق.
- إدارة الفنادق والغرف والأسعار الموسمية.
- إدارة الحجوزات والإلغاء.
- عروض موسمية وخصومات.
- حجب التوفر للصيانة أو الاستخدام الخاص.
- حساب التوفر قبل قبول الحجز.
- APIs عامة للفنادق والحجز.


## V23 — Automatic OTA Mapping
- Discovers Booking.com room types/rate plans using the official room-rate/product retrieval endpoint.
- Discovers Agoda rooms/rate plans through YCS GetProduct.
- Expedia discovery uses the catalog endpoint supplied by the approved Expedia Connectivity contract.
- Stores external catalogs and calculates room-name/type similarity suggestions.
- One-click mapping or automatic mapping above a configurable confidence threshold.
- No silent guessing below the threshold.
- Production access still requires each OTA's official partner/connectivity approval and credentials.

## V24 — Full Hotel OTA Onboarding
- معالج تجهيز لكل فندق مع Booking.com وAgoda وExpedia Group.
- اختبار الاتصال والوصول إلى Property/Hotel ID قبل اكتشاف الكتالوج.
- اكتشاف الغرف وRate Plans ثم شاشة مراجعة قبل التفعيل.
- تحذيرات للغرف المحلية غير المربوطة، والمنتجات الخارجية غير المربوطة، والربط الخارجي المكرر.
- اعتماد صريح للمطابقة قبل إنشاء/تفعيل الربط.
- بعد الاعتماد تبدأ مزامنة أول 365 يوماً في الخلفية مع تتبع التقدم والنجاح/الفشل.
- مزامنة Booking تستخدم B.XML `/hotels/xml/availability` مع batching حسب القيم المتطابقة، بما يتوافق مع توصية Booking بتحميل سنة على الأقل وتقسيم التحديثات إلى دفعات.
- Expedia يبقى معتمداً على endpoint والعقد المعتمدين من Expedia Connectivity؛ لا يتم اختراع endpoint إنتاجي غير موثق.

## V25 — Real-time OTA Reservations

- Booking.com: reservation retrieval from the official Reservations API and acknowledgement of processed messages. The implementation polls the OTA reservation queues and handles new, modified and cancelled reservations.
- Agoda: BookingListV2 polling plus the existing webhook endpoint for Booking Hint. Booking Hint can deliver new/modified/cancelled notifications near real time; full details should be retrieved through Agoda's Booking Detail flow when the property is certified for it.
- Expedia: reservation polling uses `EXPEDIA_RESERVATIONS_URL`, which must be supplied from the approved Expedia Connectivity contract; no production endpoint is invented by the application.
- Every external reservation is stored in `hotel_external_reservations` and mirrored to the local hotel booking.
- Reservation ingestion uses PostgreSQL advisory locks per room and an availability check to prevent overbooking.
- Amendments/cancellations update the local booking and immediately trigger an inventory refresh to all active channels for the affected stay dates.
- Office → الفندق → قنوات الحجز now includes "جلب الحجوزات الآن" plus imported reservation and reservation-sync logs.

## V30 — Automatic Hotel Settlements
- Per-hotel weekly/monthly automatic payout schedules.
- Reconciliation gate blocks payout batching when invoice variances/unmatched records exceed tolerance.
- Multi-hotel payout batches (single currency), approval and paid workflow.
- Central immutable-style accounting ledger entries when a batch is paid.
- Admin tab: التسوية الآلية with settings, manual scheduler run, reconciliation checks, batch creation and ledger.

## V33 — Automatic invoicing
Invoices are generated automatically and idempotently for hotel commissions, completed property deals, subscriptions, advertising and hotel payout commissions. See `V33-NOTES.md`.


## V34
Added Executive Business Intelligence dashboard. See V34-NOTES.md.

## V35 — ذكاء العقارات
- تقدير سعر العقار اعتماداً على عقارات مقارنة داخل المنصة (median price/m²).
- مقارنة السعر بالسوق الداخلي وتصنيف: أعلى / أقل / قريب من السوق.
- نسبة ثقة وشرح نطاق المقارنات.
- كشف احتمالية الإعلانات المكررة من النص والموقع والمساحة والسعر.
- Recommendation score وترشيحات شخصية اعتماداً على المفضلة.
- لوحة إدارة لتنبيهات التسعير والتكرار وإعادة التحليل.
- ملاحظة: هذا تحليل إرشادي داخلي، وليس تقييماً عقارياً معتمداً أو نموذج ML مدرباً على معاملات سوق خارجية.

## V36 — Smart Market Map
Adds city/neighborhood price-per-m², demand, price trend, and investment-opportunity analytics with daily snapshots and an admin dashboard.

## V37
Interactive geographic market Heatmap using Leaflet + OpenStreetMap. Admin can switch between price-per-sqm, demand and investment heat layers, filter by city/mode/type, inspect property markers and district clusters. See V37-NOTES.md.

## V38 — Automatic Geocoding
Adds map-coverage monitoring, automatic geocoding for listings without coordinates, an audit trail, and manual coordinate correction. Configure `GEOCODER_*` variables in `.env` for production.

## V39 Advanced geographic search
Adds radius, hand-drawn polygon search, approximate travel-time filters, reusable saved search areas, and compatible saved-search alert fields. Travel time is explicitly an estimate, not a live routing/traffic ETA.


## V40 — Personalized recommendations
See `V40-NOTES.md`. Adds behavioral/content-based property recommendations from views, favorites, inquiries and saved searches, with match score, reasons, feedback and cold-start handling.


## V42
أضيف المستشار العقاري الكامل: مقارنة العقارات، سعر المتر، العائد الاستثماري، المزايا والعيوب، ترتيب الخيارات وملخص السوق.

## V43 — ChatGPT-managed Aqartkom
Set `OPENAI_API_KEY` on the server and optionally `OPENAI_MODEL` / `CHATGPT_DAILY_LIMIT`. The new `/api/chatgpt` endpoint uses the OpenAI Responses API with guarded function calling into Aqartkom. Admin-changing actions are role checked and require explicit confirmation. The API key stays server-side.

## V44 — مدير عقارتكم الذكي
أضيف مركز تشغيل استباقي للمدير يجمع مراجعات العقارات، متابعة العملاء، مشاكل الفنادق والتنبيهات المالية في قائمة عمل واحدة. ينفذ فحصاً دورياً ويسجل كل إجراء في Audit Log. الإجراءات الحساسة لا تُنفذ تلقائياً؛ اعتماد/رفض العقار من المركز يتطلب تأكيداً صريحاً، بينما الدفعات والحسابات والعمولات تبقى في مساراتها الإدارية المحمية.

## V45 — AI Sales Agent 24/7
راجع `V45-NOTES.md`. يضيف موظف مبيعات محادثي، تأهيل Leads وتحويلاً آلياً آمناً إلى CRM والمكتب/الموظف المناسب.

## V46 — WhatsApp + Omnichannel AI Sales
راجع `V46-NOTES.md`. يربط موظف المبيعات الذكي بواتساب Cloud API مع جلسة موحدة، deduplication للويبهوك، توقيع Meta، وتحويل العميل إلى CRM والمكتب عبر منطق V45.


## V47
أضيف نظام المتابعة الآلية الذكية للعملاء عبر WhatsApp مع جدولة حسب درجة التأهيل وإرسال العقارات الجديدة المطابقة. راجع `V47-NOTES.md`.

## V48 — AI Viewing Appointments
ChatGPT sales workflow can now create property viewing appointments, check agent conflicts, assign an office agent, confirm/cancel/reschedule appointments, update the CRM lead, and send automatic WhatsApp reminders. See `V48-NOTES.md`.

## V49 — ما بعد المعاينة والتفاوض الذكي
بعد اكتمال المعاينة، يطلب النظام رأي العميل، يسجل التقييم والاعتراضات، يقترح بدائل مناسبة، وينقل العميل الجاد إلى مرحلة التفاوض. فتح التفاوض لا يعني قبول العرض أو إغلاق الصفقة؛ القرارات النهائية تبقى للمكتب والعميل.

## V50 — AI Negotiation Manager
إدارة العروض والعروض المضادة، سجل التفاوض، حساب عمولة المنصة تلقائياً (بيع 1% / إيجار 3% على البائع)، وتجهيز اتفاق للاعتماد مع خطوات تأكيد منفصلة للاعتماد وإتمام الصفقة. راجع `V50-NOTES.md`.

## V51 — العقود الإلكترونية
يضيف V51 إنشاء عقد إلكتروني من اتفاق تفاوض V50 المعتمد، مراجعة وتوقيع الأطراف بسجل تدقيق، PDF، واعتماد نهائي منفصل. هذا سجل موافقة إلكترونية داخل المنصة وليس بديلاً تلقائياً عن التوثيق الرسمي أو مزود توقيع رقمي معتمد حيث يكون مطلوباً.


## V52
Automatic post-contract deal closing: completed deal, won lead, sold/rented property, commission invoice, and final closure audit file. See `V52-NOTES.md`.

## V53 — مركز قيادة ChatGPT للمالك
يوحد مؤشرات العقارات والصفقات والعملاء والفنادق والمحاسبة في مركز إداري واحد، مع محادثة ChatGPT تعتمد على بيانات المنصة الحقيقية وأدوات قراءة آمنة.

## V54 — AI Executive Manager
مركز تنفيذي ذكي يكتشف المشكلات، ينشئ مقترحات، ويطلب موافقة المدير قبل تنفيذ الإجراءات المسموح بها، مع Audit Trail كامل. راجع `V54-NOTES.md`.


## V55
أضيفت لوحة مرئية موحدة للمدير التنفيذي الذكي داخل لوحة الإدارة. راجع `V55-NOTES.md`.


## V56
أضيف مركز أوامر صوتية عربي للمدير التنفيذي، مع تحويل الكلام إلى أمر إداري وإجابة صوتية، دون تجاوز ضوابط الموافقة.


## V57
محادثة صوتية عربية مباشرة ثنائية الاتجاه مع المدير التنفيذي: استماع ثم تحليل ثم رد صوتي ثم استماع تلقائي من جديد، مع بقاء الموافقات الحساسة محمية.

## V58 — Realtime WebRTC Voice
The executive dashboard now supports OpenAI Realtime speech-to-speech over WebRTC with semantic turn detection and interruption. Configure `OPENAI_API_KEY`, optionally `OPENAI_REALTIME_MODEL` and `OPENAI_REALTIME_VOICE`, and serve over HTTPS in production.

## V59 — Production launch
See `V59-NOTES.md`. Run `npm run check`, configure `.env`, then deploy with `docker compose up -d --build`. Health endpoints: `/api/health` and `/api/ready`.

## V60 — تطبيق الجوال PWA
الإصدار 60 يضيف Manifest وService Worker ووضع Offline وتثبيت التطبيق وإشعارات Web Push. راجع V60-NOTES.md.

## V61 — التسويق والنمو الذكي
أضيف مركز حملات وتسويق موحد مع UTM attribution ومؤشرات CPL/CAC/ROAS والتحويلات وتوصيات تحسين قابلة للمراجعة. لا ينفذ النظام إنفاقاً إعلانياً تلقائياً دون ربط حسابات الإعلانات وموافقة صريحة.

## V62 — Meta Ads + Google Ads + TikTok Ads
أضيفت طبقة موحدة لاستيراد أداء الحملات الحقيقية من Meta وGoogle وTikTok وربط الإنفاق والنقرات والتحويلات بمركز التسويق في عقارتكم. نقاط الإدارة: `/api/admin/ad-platforms/status` و`/api/admin/ad-platforms/:platform/sync` و`/api/admin/ad-platforms/sync-all` و`/api/admin/ad-platforms/dashboard`.

## V63 — AI Ads Autopilot
محرك يومي لتحليل أداء الحملات وإنشاء قرارات مقترحة مع موافقة إدارية محمية قبل أي تعديل خارجي. راجع `V63-NOTES.md`.

## V65 — التقرير التنفيذي اليومي
يولد تقريراً تنفيذياً صباحياً تلقائياً للمالك من بيانات عقارتكم، يحفظه للتاريخ، ويمكن إرساله عبر WhatsApp. اضبط `DAILY_EXECUTIVE_REPORT_HOUR` و`OWNER_WHATSAPP_NUMBER` عند الحاجة.

## V66 — AI Business Autopilot
أضيفت دورة إدارة تلقائية موحدة تراقب مؤشرات المنصة وتحدد المخاطر والفرص والأولويات، مع إبقاء الإجراءات الحساسة خلف الموافقات المحمية. راجع `V66-NOTES.md`.

## V67 — AI Fraud & Trust Center
لوحة مركزية لدرجة الثقة وإشارات الاحتيال للعقارات والحسابات. الفحص آلي لكن الحظر والرفض ليسا آليين.

## V69 — Advanced Property Ownership Verification
Adds private ownership-document review, document fingerprint reuse/conflict detection, owner-name consistency checks, ownership scoring, audit trail, and a public-safe verified-ownership badge endpoint. Legal-document approval remains admin-only.

## V73 — AI Virtual Staging & Renovation Studio
يدعم إنشاء تصورات اختيارية للتأثيث والتجديد مع الحفاظ على الصور الأصلية ووسم كل ناتج بوضوح بأنه «تصور بالذكاء الاصطناعي». راجع `V73-NOTES.md`.

## V76
أضيف AI Lead Attribution & Marketing ROI لقياس رحلة العميل والعائد الحقيقي حتى الصفقة والعمولة، مع فصل العملات.

## V79
يتضمن AI Demand Forecast & Market Prediction لتوقع الطلب واتجاه السعر وسرعة الصفقة والفرص الاستثمارية من بيانات المنصة التاريخية.

## V81 — AI Investor Portfolio Manager
إدارة محافظ المستثمرين، العائد والتدفق النقدي والمكاسب غير المحققة والمخاطر والتنويع، مع توصيات احتفاظ/مراجعة إرشادية وفصل العملات.

## V82 — AI Property Matchmaker
مطابقة ذكية بين طلب العميل والعقارات مع Match Score وتحويل العميل إلى CRM المكتب. لا يتضمن تمويلاً عقارياً.

## V83 — AI Buyer & Seller Marketplace Agent
وسيط سوق ذكي يربط المشتري والبائع والمكتب في مسار واحد من الاهتمام والعرض حتى التفاوض الرسمي، مع موافقات صريحة للقرارات النهائية. راجع `V83-NOTES.md`.

## V84 — AI Deal Room
غرفة صفقة موحدة تعرض رحلة الصفقة من العميل والمعاينة إلى التفاوض والعقد والتوقيع والإغلاق، مع مستندات وسجل أحداث وعمولة المنصة، دون تجاوز الموافقات الصريحة.

## V85 — AI Transaction Coordinator
منسّق ذكي لكل معاملة يحوّل محتوى غرفة الصفقة إلى خطة تنفيذ مرتبة، ويعرض نسبة الإنجاز والمهام المتأخرة ودرجة المخاطر والخطوة التالية. لا يقبل عرضًا ولا يوقّع عقدًا ولا يغلق صفقة تلقائيًا.

## V86 — AI Neighborhood Guide
دليل ذكي داخل صفحة العقار يعرض مؤشر الطلب والأسعار ومتوسط سعر المتر ومعلومات الحي والخدمات المتحققة، دون إضافة التمويل أو الفحص القانوني أو نقل الملكية والتسليم.

## V87 — AI Property Comparison
مقارنة ذكية بين عقارين وحتى أربعة عقارات حسب السعر وسعر المتر والمساحة والغرف والحي والطلب، مع ترتيب وتوصية تعتمد على أولوية المستخدم.

## V88 — Smart Map Search
خريطة عقارية كاملة تتيح البحث في النطاق الظاهر، رسم منطقة أو دائرة، تطبيق الفلاتر، مشاهدة الأسعار، إضافة العقارات للمقارنة، وحفظ منطقة البحث.

## V89 — Smart Property Request
صفحة عربية يفهم فيها النظام وصف العميل، يعرض العقارات الأقرب لطلبه، ثم يرسل الطلب بعد موافقته إلى المكاتب المناسبة ويمنحه رقم متابعة.

## V90 — Property Request Tracking
لوحة متابعة متكاملة للعميل والمكتب: اقتراح العقارات، قبولها أو رفضها، طلب المعاينة وتأكيدها، وإدارة حالة الطلب حتى يتحول إلى مسار CRM.

## V91 — Smart Messaging Center
صندوق محادثات موحد يربط العميل بالمكتب حول العقار المقترح، مع المرفقات والردود السريعة وغير المقروء والتلخيص وتذكير المعاينة وحماية بيانات التواصل.
