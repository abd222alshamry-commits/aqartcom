# عقارتكم V83 — AI Buyer & Seller Marketplace Agent

- قناة منظمة بين المشتري والبائع مرتبطة بالعقار والمكتب وCRM.
- إنشاء Lead تلقائياً عند بدء اهتمام جاد بعقار تابع لمكتب.
- رسائل وعروض سعر وسجل إجراءات مستقل وقابل للتدقيق.
- إرسال عرض سعر يتطلب العبارة: `أوافق على إرسال العرض`.
- لا يقبل السعر ولا يغلق الصفقة تلقائياً.
- تحويل العرض إلى مسار V50 الرسمي للتفاوض؛ قواعد عمولة عقارتكم محفوظة: بيع 1%، إيجار 3%، على البائع.
- قبول العرض، اعتماد الاتفاق، العقود وإغلاق الصفقة تبقى في مسارات الموافقة الحالية.

## API
- POST `/api/marketplace-agent/property/:id/start`
- GET `/api/marketplace-agent/threads`
- GET `/api/marketplace-agent/threads/:id`
- POST `/api/marketplace-agent/threads/:id/message`
- POST `/api/marketplace-agent/threads/:id/offer`
- POST `/api/marketplace-agent/threads/:id/handoff-negotiation`
