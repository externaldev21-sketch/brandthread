# Reviewer access: demo accounts, payments, what Dev must do

Scope: a demo BUYER and demo SELLER for App Store / Google Play review, a
repeatable seed, and notes for the review form. Backend and docs only. There is
no review-mode banner, popup or other visible change in the app.

## What was added

| Piece | Where |
| --- | --- |
| Seed runner (Clerk + DB) | `artifacts/api-server/scripts/seedReviewAccounts.ts` |
| Pure plan / validation logic | `artifacts/api-server/src/scripts/reviewDemo/plan.ts` |
| Tests (no DB, no Clerk) | `artifacts/api-server/src/scripts/__tests__/reviewDemoPlan.test.ts` |
| Internal flag `users.is_review_account` | `lib/db/migrations/240_review_accounts.sql`, `lib/db/src/schema/index.ts` |
| Purge carve-out | `lib/db/src/testing/purge.ts` |
| Review form text (credential placeholders) | `REVIEW_NOTES.md` (repo root) |

## Running it

Env (all from a secret store, never committed):

```
REVIEW_DEMO_BUYER_EMAIL   REVIEW_DEMO_BUYER_PASSWORD
REVIEW_DEMO_SELLER_EMAIL  REVIEW_DEMO_SELLER_PASSWORD
REVIEW_DEMO_ASSET_BASE_URL   optional, https base serving <slug>.jpg images
DATABASE_URL, CLERK_SECRET_KEY   of the target (production) environment
```

```
pnpm --filter @workspace/api-server run seed:review-accounts -- --dry-run
pnpm --filter @workspace/api-server run seed:review-accounts -- --confirm-production
pnpm --filter @workspace/api-server run seed:review-accounts -- --render-notes   # stdout only
```

- `--dry-run` prints the plan counts and touches neither Clerk nor the database.
- A real run refuses to start without `--confirm-production`.
- Passwords must be 12+ characters. Emails must be real, deliverable addresses:
  the seed rejects reserved test TLDs (`.test`, `.invalid`, ...) because the
  purge tool matches those.
- Idempotent: every row is found by a natural key (email, username, SKU, order
  number, caption, follow pair) and updated or skipped. Existing Clerk users are
  reused and their password is not overwritten.
- Migration 240 must be applied first (`pnpm --filter @workspace/db run migrate`).

## What gets created

Seller "Atelier Demo" (`@atelier_demo`): avatar, logo, cover, bio, verified;
10 products (27 variants, sizes/colors, $18 to $128, two images each, active);
3 published posts. Buyer `@review_buyer`: follows the seller; 5 orders in
varied states (2 delivered with reviews, 1 shipped with tracking, 1
processing, 1 cancelled); a matching customer record on the seller side.

Images default to a public placeholder service (`picsum.photos`, deterministic
per product). For real product photography, upload `<slug>.jpg` files to a
bucket and set `REVIEW_DEMO_ASSET_BASE_URL`. Seeded orders carry no Stripe IDs
and no ledger rows, so nothing is refundable or payable from them.

## Internal flag and what it affects

The repo had no per-user "internal" flag (only `is_system_account`, which means
the Brandthread Agent). Added `users.is_review_account`:

- **Purge:** `db:purge-test-data` anchors on reserved test email TLDs and
  fixed-point expands from those users. It now also skips any user flagged
  `is_review_account`, even with a test-style email. (Rows of real-TLD users
  were never reachable by the purge; the flag is the second lock.)
- **Discovery and ranking: intentionally NOT hidden.** A reviewer has to be
  able to find the store from Discover and Search, and Apple requires a working
  app with content. The brand is plainly named "Atelier Demo". If Dev prefers
  to hide it from real users, the smallest change is adding
  `eq(users.isReviewAccount, false)` next to `isSystemAccount` in
  `routes/public.ts` (search), `routes/social.ts` and the ranking job, and
  pointing reviewers at the store via `@atelier_demo`. That trades discoverability
  for isolation, so it is left as a decision.
- **Analytics:** no analytics exclusion exists today for system accounts either.
  Demo orders are small and flagged through `users.is_review_account` for any
  later filter.

## Payments during review

Not implemented: a server-side review-account bypass. Checkout and money code
is owned by the orders/refunds session and is sensitive; a special case there
would be a new way to skip charging, which does not belong in production code
for this purpose. Options, in order of preference:

1. **Reviewers cannot complete a real charge, and do not need to.** Buyer Orders
   already shows the five seeded orders (delivered, shipped, processing,
   cancelled), tracking, reviews and the order detail screens. In the review
   notes, tell Apple that checkout is live Stripe and that they can reach the
   payment sheet without paying. This is the lowest-risk path and is what
   `REVIEW_NOTES.md` says.
2. **Test-mode backend for review.** If Apple insists on an end-to-end purchase,
   point a separate build's API base URL at a staging deployment that uses
   `sk_test_` / `pk_test_` keys and its own database (run this seed there). The
   reviewer then pays with `4242 4242 4242 4242`, any future expiry and any CVC.
   Requires a dedicated TestFlight/review build; needs Dev's Stripe and hosting.
3. **Thread Cash** cannot cover a whole order today (it is a capped checkout
   discount), so it is not a free path.

Seller subscriptions use RevenueCat / in-app purchase, so they work in the
StoreKit sandbox for reviewers with no change.

## What Dev must do

1. Choose the four secrets, store them in the secret manager, run `--dry-run`,
   apply migration 240 on production, then run with `--confirm-production`.
2. Sign in once as each demo user on a real device (Clerk may ask for device
   verification on first sign-in) and confirm the accounts land on Home /
   Dashboard with no onboarding.
3. Seller onboarding state beyond what is seeded (Stripe Connect, paid plan) is
   not faked. If the reviewer should see "subscribed", subscribe the demo seller
   in the StoreKit sandbox and say so in the notes. Verify seller screens that
   gate on plan or Connect status.
4. Run `--render-notes`, paste into App Store Connect Notes and the Play Console
   "App access" field. Enable the Clerk email/password strategy if it is off.
5. Re-check both logins the day you submit.

## Not verified

The seed was type-checked and its pure logic unit-tested; it was not run against
Clerk or a database from this environment (no production credentials, by design).
The first real run is the first test of the DB inserts; run `--dry-run` first and
check the rows in the seller dashboard afterward.
