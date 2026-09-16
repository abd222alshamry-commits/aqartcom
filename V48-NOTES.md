# V48 — حجز المعاينات والمواعيد تلقائياً

- إنشاء موعد معاينة مرتبط بالعميل والعقار والمكتب وموظف المبيعات.
- فحص تعارض مواعيد الموظف قبل الحجز.
- اختيار موظف العقار أو أقل موظفي المكتب انشغالاً.
- الموعد يبدأ كـ scheduled ويحتاج تأكيد العميل.
- تأكيد، إلغاء وإعادة جدولة عبر API.
- تذكير WhatsApp تلقائي قبل الموعد (3 ساعات افتراضياً).
- تحديث Lead إلى مرحلة viewing وربط next_follow_up بالموعد.
- لوحة API للمدير لمراجعة مواعيد ChatGPT وتشغيل التذكيرات يدوياً.

## Endpoints
POST /api/ai-appointments/propose
POST /api/ai-appointments/:id/confirm
POST /api/ai-appointments/:id/cancel
POST /api/ai-appointments/:id/reschedule
GET /api/admin/ai-appointments
POST /api/admin/ai-appointments/reminders/run
