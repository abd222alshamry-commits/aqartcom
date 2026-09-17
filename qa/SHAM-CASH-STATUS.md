# Sham Cash verification status — 2026-09-17

## Observed production state

- Render service `aqartcom-v93` uses branch `v93-render`.
- Six explicitly labelled demo hotels and eighteen room categories are published.
- Read-only quotes succeeded for all six hotels. Prices are demo USD values.
- `/api/payment-options?country=SY&currency=SYP` returned no enabled methods.
- Hotel booking supports payment on arrival. There is no implemented Sham Cash hotel payment flow.
- The existing Sham Cash code is an incoming-transfer verification adapter for office wallet top-ups and subscriptions, not a certified official merchant integration.

## Changes

- Require an explicitly configured HTTPS API endpoint, API credential and recipient. Removed the implicit third-party endpoint and duplicate provider setting from `.env.example`.
- Fail closed on unavailable or malformed provider responses, missing recipient/status/reference/time, mismatched amount/currency, outgoing transfers, and cancelled local payments.
- Bound provider requests to ten seconds and reject redirects.
- Serialize provider-reference settlement; keep wallet credit, ledger entry and payment status in the same database transaction.
- Correct the payment row lock to `FOR UPDATE OF p` so it does not lock a nullable outer join.
- Remove the unimplemented hotel online-payment choice and reject it server-side before creating a booking.
- Update an older video test to check the current in-page player instead of an obsolete direct-link expectation.

## Verification and limits

Tests use synthetic provider responses, an in-memory PostgreSQL-compatible PGlite database, and test-only Express authentication. They do not contact Sham Cash, create real transactions or credit a production wallet. PGlite does not exercise multi-connection advisory-lock contention.

Real-payment testing still requires an approved merchant/provider contract, documentation of the actual response fields, recipient ownership verification, API credentials set securely on Render, and a documented way to bind the incoming transfer to the correct customer's order. The current contract uses `resource=shamcash&action=find_tx` and expects `success`, `data.found`, and transaction ID/status/recipient/amount/currency/time. Do not assume that contract matches the official API. Do not enable a third-party gateway without the owner's explicit selection.

No real transfer, provider integration certification, visual browser test or physical Samsung-device test was completed in this session. The browser session failed to connect; live health, hotel data and quote endpoints were verified directly.
