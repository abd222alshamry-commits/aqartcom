# V43 — عقارتكم المدار بواسطة ChatGPT

- OpenAI Responses API integration from the server only; API key is never sent to the browser.
- Function calling over real Aqartkom data: property search, market summary, property analysis, comparison, admin overview.
- Guarded admin write action: property moderation status requires admin role + explicit `confirmed_action: true`.
- Daily per-user/IP request limit and usage/audit log with token counts and latency.
- Admin usage endpoint: `GET /api/admin/chatgpt/usage?days=30`.
- Main endpoint: `POST /api/chatgpt` with `{ "message": "...", "confirmed_action": false }`.
- Existing V41/V42 deterministic assistant/advisor remain as fallback functionality.
