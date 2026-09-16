# V76 — AI Lead Attribution & Marketing ROI

- يتابع مسار العميل من النقرة/الزيارة إلى Lead ثم المعاينة والتفاوض والصفقة.
- يحتفظ بإسناد First Touch وLast Touch، ويستخدم Last Touch في لوحة ROI الافتراضية.
- مؤشرات: Leads، Qualified، Won، Deals، CPL، CPA، Lead→Deal، Revenue ROAS، Commission ROAS.
- يربط بيانات الإنفاق من Meta/Google/TikTok الموجودة في V62 مع CRM والصفقات.
- القيم المالية مفصولة حسب العملة ولا يتم جمع SAR/USD/SYP وغيرها.
- نقاط عامة: POST /api/marketing/touchpoint و POST /api/marketing/attribute-lead.
- لوحة الإدارة: GET /api/admin/marketing-roi?days=30.
- لا يغيّر ميزانيات الحملات ولا ينفذ إنفاقاً إعلانياً.
