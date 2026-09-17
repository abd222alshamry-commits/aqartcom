# Offer moderation and office listings — 2026-09-17

The owner can create a limited supervisor from `admin-team.html`, using either the review-only preset or the office supervisor preset (review + office offer creation). Permission changes and disabled accounts take effect through existing database-backed session checks. Full owner access remains unchanged.

`offer-review.html` provides one paginated, searchable queue for direct properties, hotels/furnished apartments/farms, and imported/manual office listings. Details include listing media, hotel rooms and stay conditions. Reviewers can approve, reject or return an offer to pending; rejection and pending require a reason. Listing updates and the review event are committed in one database transaction. A content revision prevents stale decisions from overwriting changed listings, media, rooms or newer review decisions.

Office creation selects a registered office or a configured office source. The server determines attribution and always creates a pending listing. The new offer enters the public office listings only after approval; rejection/pending removes it. The public office selector includes newly published offices, and known room counts are searchable. Unknown imported sources retain their pre-existing publication evidence restriction: review approval alone does not publish them. Demo offers cannot be approved as real offers.

Separate permissions:
- `offers.read`: listing content and review history.
- `offers.review`: review decisions.
- `offers.create`: create pending office listings.

These grants do not authorize user/team changes, finance, bookings, broad property edits or deletions. Creating a reviewer account remains restricted to a full administrator. No real supervisor accounts, production listings or reservations were created or changed during QA.

Validation:
- `npm test`: 97 passed, 0 failed. Includes API/real PostgreSQL-compatible SQL and DOM integration for office attribution, publication, grants, revocation, stale revisions, atomic audit rollback and supervisor creation presets.
- `npm run test:windows`: 27 HTML pages; 46 page/role scenarios; 107 checks; no DOM or server errors.
- JavaScript syntax and `git diff --check` passed.

DOM checks use jsdom and an isolated PGlite database. They do not constitute visual browser/device testing or an authenticated production test.
