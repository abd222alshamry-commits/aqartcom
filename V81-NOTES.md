# عقارتكم V81 — AI Investor Portfolio Manager

يدير المستثمر محافظ متعددة ويضيف عقارات من المنصة أو أصولاً يدوية. يحسب قيمة المحفظة والتكلفة والمكاسب غير المحققة والدخل والمصاريف والتدفق النقدي والعائد الإجمالي والصافي ودرجة مخاطر إرشادية، مع فصل كامل للعملات وعدم جمعها.

## APIs
- GET/POST `/api/investor/portfolios`
- POST `/api/investor/portfolios/:id/assets`
- DELETE `/api/investor/portfolios/:pid/assets/:aid`
- GET `/api/investor/portfolios/:id/advice`

التوصيات هي تحليلية فقط ولا تنفذ شراءً أو بيعاً أو تحويلاً مالياً.
