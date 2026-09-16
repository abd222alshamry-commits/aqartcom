# V33 — Automatic invoicing

Automatic, idempotent invoice generation for:
- hotel booking platform commissions
- completed real-estate sale/rent commissions (sale 1%, rent 3%)
- paid office subscriptions
- wallet top-ups / paid advertising funding
- consumed paid-ad invoices
- paid hotel payout-cycle platform commissions

Admin endpoints:
- POST /api/admin/einvoices/auto-generate
- GET /api/admin/einvoices/auto-runs

A scheduler scans every 5 minutes by default. `source_type + source_id` uniqueness prevents duplicate invoices.
