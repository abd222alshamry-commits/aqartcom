# Sham Cash verification status — 2026-09-17

## Observed production state

- Render service `aqartcom-v93` uses branch `v93-render`.
- Six explicitly labelled demo hotels and eighteen room categories are published.
- Read-only quotes succeeded for all six hotels. Prices are demo USD values.
- `/api/payment-options?country=SY&currency=SYP` returned no enabled methods.
- Hotel booking supports payment on arrival and a separate manual Sham Cash workflow. The manual option is visible; it is unavailable until the administrator configures the receiving account and currency. Demo hotels never accept money.
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


## Manual hotel transfer release

- `/shamcash-admin.html` is linked from the administrator dashboard. Administrators can set the recipient name, receiving address and/or uploaded QR image, settlement currency, and an explicit USD-to-SYP rate when needed. Configuration defaults to disabled with no account details; no example account is published.
- `/hotels.html` obtains a server quote with payment methods. Creating a manual-payment booking stores a recipient/amount/currency/rate snapshot, keeps the booking pending, and returns a private receipt link.
- Guests submit a transaction reference. The payment remains pending until an administrator confirms receipt or rejects it. Approval updates booking and invoice atomically; rejection cancels the booking. No real transfer or refund is performed by these actions.
- Private receipt links use a 256-bit token in a URL fragment. Only its hash is stored in the database, and the browser sends it as an authorization header. Payment tokens and guest contact information are excluded from customer receipt responses.
- Incoming references cannot be reused across manual hotel payments and the existing automatic Sham Cash wallet settlement. Changes to recipient settings prevent new transfers against old snapshots while allowing references for already sent transfers to be submitted for review.
- The end-to-end local test covers configuration and version conflicts, authorization, foreign-origin writes, stale quotes, token access, unpaid submission, repeat submission, approval, rejection, cancellation, duplicate references, office-wallet reuse and account changes. Test data stays in an in-memory database.
- Production activation still requires the owner's actual receiving details and chosen currency. The native Android binary has not been rebuilt for this release; this release adds the web workflow and compatible backend endpoints.
