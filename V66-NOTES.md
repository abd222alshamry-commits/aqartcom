# عقارتكم V66 — AI Business Autopilot

دورة إدارة موحدة تعمل دورياً فوق طبقات V54–V65: تراقب المبيعات والتحصيل والعقارات والصفقات والإعلانات وقرارات AI، وتحوّل الحالة إلى أولويات تشغيلية واضحة.

## الجديد
- `server/business-autopilot.js`
- فحص تلقائي كل 60 دقيقة افتراضياً (`AI_BUSINESS_AUTOPILOT_MINUTES`).
- سجل `ai_business_autopilot_runs` يحفظ snapshot والنتائج لكل دورة.
- `GET /api/admin/business-autopilot` لآخر نبضة تشغيلية وحالة الأمان.
- `POST /api/admin/business-autopilot/run` لتشغيل دورة فورية.
- تصنيف النتائج: sales / finance / properties / operations / marketing.

## حدود التنفيذ الآمن
Autopilot يراقب ويحلل ويقترح. التحويلات المالية، تعديل ميزانيات الإعلانات، اعتماد العقارات، إغلاق الصفقات والتغييرات الحساسة لا تتجاوز مسارات الموافقة المحمية الموجودة في الإصدارات السابقة.
