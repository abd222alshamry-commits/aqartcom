# عقارتكم V63 — AI Ads Autopilot

- تحليل آخر 14 يوماً من Meta / Google / TikTok من بيانات V62.
- اقتراح إيقاف الحملات التي تنفق دون تحويلات أو ذات ROAS منخفض.
- اكتشاف الحملات الرابحة واقتراح مراجعة رفع الميزانية تدريجياً.
- لا تنفيذ مالي/إعلاني دون تأكيد إداري حرفي: `أوافق على تعديل الحملة`.
- Google Ads: تنفيذ محمي لحالة الحملة (PAUSED / ENABLED) عبر CampaignService mutate.
- Meta وTikTok: التحليل والاقتراح يعملان، بينما التعديل الخارجي المباشر يبقى محجوباً حتى إعداد واجهة mutation وصلاحيات الحساب المعتمدة؛ لا توجد محاكاة لتنفيذ غير مؤكد.
- سجل تدقيق كامل للاقتراحات والموافقات والتنفيذ والفشل.
- حدود قابلة للضبط: `AI_ADS_MIN_SPEND`, `AI_ADS_BAD_ROAS`, `AI_ADS_GOOD_ROAS`.

## API
- POST `/api/admin/ads-autopilot/scan`
- GET `/api/admin/ads-autopilot?status=proposed|all`
- POST `/api/admin/ads-autopilot/proposals/:id/execute`
- POST `/api/admin/ads-autopilot/proposals/:id/dismiss`
