# V52 — Automatic Deal Closing

- Closes a deal only after the V51 electronic contract is fully signed and finalized.
- Explicit confirmation required: `أؤكد إغلاق الصفقة`.
- Sale commission remains 1%; rent commission remains 3%; payer remains seller.
- Marks deal completed and lead won.
- Marks property `sold` for sale or `rented` for rent, removing it from active marketplace searches.
- Creates/reuses the automatic `office_deal` electronic invoice for platform commission.
- Creates an immutable-style closure snapshot and event trail linking deal, contract, property, lead, invoice and commission.
- Idempotent: repeating the close request returns the existing closure instead of duplicating invoices/closures.

Endpoints:
- `POST /api/office/deals/:dealId/close-from-contract`
- `GET /api/office/deals/:dealId/closure`
- `GET /api/admin/deal-closures`
