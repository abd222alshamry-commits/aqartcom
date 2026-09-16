# V61 — AI Marketing & Growth Engine

- Campaign registry with budget, channel, objective and UTM fields.
- Attribution endpoint for source/medium/campaign/content/term and landing path.
- KPI dashboard: spend, leads, CPL, CAC, ROAS, conversion rate.
- AI-style rule-based growth scanner flags spend-without-leads and low-ROAS campaigns.
- Recommendations require human review; V61 never spends money or changes ad-platform budgets automatically.
- Admin dashboard tab: التسويق والنمو.
- API endpoints under `/api/admin/marketing/*` and public attribution endpoint `/api/marketing/track`.
- External Meta/Google/TikTok ad-account synchronization requires provider credentials and is not faked in this build.
