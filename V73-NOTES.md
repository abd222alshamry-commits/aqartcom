# عقارتكم V73 — AI Virtual Staging & Renovation Studio

- إنشاء تصور تأثيث افتراضي أو تجديد اختياري من صورة العقار عبر OpenAI Image API.
- النموذج الافتراضي: `gpt-image-2` ويمكن تغييره عبر `OPENAI_IMAGE_MODEL`.
- يحافظ الـ prompt على العمارة والمنظور والأبعاد والفتحات الثابتة، ويمنع اختلاق مساحة أو نوافذ أو غرف أو إطلالات.
- كل ناتج مسجل `is_ai_visualization=true` ويجب عرضه للمستخدم بوسم **تصور بالذكاء الاصطناعي**.
- الصور الأصلية لا تُستبدل تلقائياً.
- الاعتماد يتطلب العبارة الصريحة: `أوافق على إضافة التصور`.
- الصور المولدة تحفظ في `uploads/virtual-staging/` وسجلها في `ai_virtual_staging_jobs`.
- لا يُقدَّم التصور على أنه الحالة الفعلية أو الحالية للعقار.

## API
- `POST /api/virtual-staging/generate` multipart: image, property_id, mode=staging|renovation, style, room_type, instructions
- `GET /api/virtual-staging/property/:id`
- `POST /api/virtual-staging/:id/approve`
- `GET /api/admin/virtual-staging`
