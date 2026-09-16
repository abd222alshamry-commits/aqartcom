# عقارتكم V45 — موظف المبيعات العقاري الذكي 24/7

- محادثة مبيعات حقيقية عبر OpenAI Responses API وFunction Calling.
- يفهم الاحتياج تدريجياً ويبحث في قاعدة عقارتكم فقط.
- يحفظ بيانات الاتصال فقط عندما يقدمها العميل طوعاً.
- Lead qualification من 0 إلى 100: new / cold / warm / hot.
- يحوّل العميل الجاد تلقائياً إلى المكتب المرتبط بالعقار، ثم إلى موظف نشط مع موازنة بسيطة للحمل.
- ينشئ Lead داخل CRM ويحدد متابعة خلال ساعتين.
- سجل كامل للمحادثات والتحويلات ولوحة API إدارية للأداء.
- لا توجد وعود بعائد أو أسعار مستقبلية؛ تحليلات السوق إرشادية.

## Environment
OPENAI_API_KEY=...
OPENAI_SALES_MODEL=gpt-5.6
AI_SALES_DAILY_LIMIT=120

## API
POST /api/sales-agent/chat
GET /api/admin/ai-sales
