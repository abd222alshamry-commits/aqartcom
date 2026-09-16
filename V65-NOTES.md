# عقارتكم V65 — التقرير التنفيذي اليومي التلقائي

- تقرير يومي تلقائي مبني على آخر 24 ساعة من بيانات المنصة.
- يلخص الصفقات، العملاء، العقارات، الفواتير، الفنادق، الإعلانات، المخاطر وأفضل المكاتب.
- يستخدم OpenAI لإنتاج ملخص تنفيذي وأولويات عند توفر المفتاح، مع fallback حتمي عند تعذر الخدمة.
- يحفظ التقارير في `daily_executive_reports` ولا ينفذ أي قرار مالي أو إداري.
- جدولة افتراضية الساعة 08:00 حسب `APP_TIMEZONE`.
- إرسال اختياري للمالك عبر WhatsApp عند ضبط `OWNER_WHATSAPP_NUMBER` وتكامل WhatsApp.
- API: GET `/api/admin/daily-executive-report`, POST `/api/admin/daily-executive-report/generate`, POST `/api/admin/daily-executive-report/:id/send`.
