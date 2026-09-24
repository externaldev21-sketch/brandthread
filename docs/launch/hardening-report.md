# Launch hardening report

Security, performance, and reliability audit of `artifacts/api-server` ahead
of launch, plus minimal mobile crash-isolation and a k6 load test. This PR
was produced by parallel, scope-isolated audits (buyer routes, seller/
manufacturer routes, webhooks/rate-limiting/transport security, performance,
reliability, mobile error boundaries, load testing) merged together, plus a
final integration pass that fixed the regressions the merge itself
introduced and re-verified everything.

**Scope discipline honored throughout:** no money/payout logic was changed
silently. Every fix that touches money-adjacent code is called out below and
was made in its own commit.

---

## 1. Money-adjacent findings (read first)

Two findings touch money or escrow logic. Both are flagged here as required
and were committed separately from routine fixes.

### 1.1 [HIGH] Missing role check on drop mutations, including the preorder-refund trigger
**File:** `artifacts/api-server/src/routes/drops.ts`
**Commit:** `SECURITY FIX (money): require manager+ role for drop mutations`

`drops.ts` only required `requireAuth` (any authenticated team member) on
`POST /`, `PATCH /:id`, `POST /:id/cancel-preorders`, and
`POST /:id/broadcast` — unlike sibling routes (`products.ts`, `inventory.ts`)
which require the `manager` team role for writes. Under `teamContext`, this
meant **any** active team member — including the lowest "staff" tier, whose
documented permissions are `orders:read, orders:fulfill` only — could create
or edit a seller's drops, and critically could call
`POST /:id/cancel-preorders`, which triggers full buyer refunds against a
preorder drop's held escrow funds via `failDrop`, or broadcast a live-drop
notification to the seller's followers.

**Fix:** added `requireRole("manager")` to the four mutating routes,
matching the `products.ts`/`inventory.ts` pattern. Read routes (`GET /`,
`GET /:id`, `GET /:id/broadcast-preview`) are unchanged and remain open to
any team member.

**Test:** `artifacts/api-server/src/routes/__tests__/drops-role-gate.test.ts`
— asserts all four mutating routes return `403 ROLE_REQUIRED` for a staff
member; verified to fail pre-fix and pass post-fix.

### 1.2 Real bug fixed in a background job (not money-adjacent, but touches notification delivery)
**File:** `artifacts/api-server/src/jobs/abandonedCartRecovery.ts`

Unlike every other job in `src/jobs/`, this job had no claim-before-act
step: it selected stale users, inserted a notification per user, *then*
marked cart items notified. Two overlapping runs (a slow run plus the next
scheduled interval, or two server instances) could both select the same
user before either marked it, sending duplicate "still thinking it over?"
notifications. Fixed by claiming rows first via a single conditional
`UPDATE ... RETURNING` (notifications are only inserted for rows this run
actually claimed) — the same pattern the other jobs already use.

### 1.3 `moneySweep.ts` — explicitly audited, no bug found, untouched
Reviewed closely alongside its callees (`failDrop`, `advanceDropEscrow` in
`lib/money/escrow.ts`, `sweepOrderReleases`, `recoverLabelCost`). State
transitions use conditional `UPDATE ... WHERE escrowState IN (...) RETURNING`
(atomic compare-and-swap) and the label-cost recovery step gates on a ledger
idempotency-key existence check. These look correctly race-safe against
concurrent/multi-instance execution. **No changes were made to this file or
its money-lifecycle dependencies.**

### Other money-adjacent code reviewed, found clean, untouched
- `webhooks.ts` (`handleCheckoutPaid`, escrow/refund/dispute handlers): oversold-order
  refunds, loyalty-redemption consumption inside the order transaction, and
  manufacturer transfer-reversal accounting all use idempotent ledger inserts.
- `returns.ts` (`refundOrder`), `drop-wallet.ts` (`releaseOrderFunds`),
  `disputes.ts` (Stripe dispute evidence): all re-verify ownership inside a
  row-locked transaction/precondition before moving money.
- `freelancer-jobs.ts`: role-gated, atomic status transitions, deterministic
  Stripe idempotency keys.
- Stripe webhook and RevenueCat webhook idempotency ledgers (see §2.1).

---

## 2. Security

### 2.1 Webhook security — reviewed, already solid
`webhooks.ts`, `stripeWebhookLedger.ts`, `ensureWebhookEvents.ts`:
- Stripe raw body is correctly preserved (`express.raw(...)` mounted before
  `express.json()` for the webhook paths) and `stripe.webhooks.constructEvent`
  verifies the signature; livemode is checked against the configured secret
  key.
- Idempotency: every Stripe event goes through a DB-backed claim/lease
  (`claimStripeWebhookEvent`/`completeStripeWebhookEvent`/
  `failStripeWebhookEvent`) with heartbeat renewal, so duplicate/retried
  deliveries are skipped or wait for the in-flight outcome. Sub-handlers
  additionally use `onConflictDoNothing` on a unique ledger key.
- RevenueCat webhook: timing-safe auth-header comparison plus a ledger
  insert with `onConflictDoNothing` for idempotency.
- No other inbound webhook receivers exist.

### 2.2 IDOR / ownership — buyer routes (HIGH-value area, no vulnerabilities found)
Audited: `orders.ts`, `cart-db.ts`, `buyer.ts`, `buyer-products.ts`,
`buyer-payments.ts`, `conversations.ts`, `saved.ts`, `drop-wallet.ts`,
`returns.ts`, `reviews.ts`, `post-comments.ts`, `notifications-feed.ts`,
`notification-prefs.ts`, `loyalty.ts`, `referrals.ts`, `waitlist.ts`,
`guest-checkout.ts`, `support.ts`, `support-chat.ts`, `safety.ts`,
`reports.ts`, `ip-cases.ts`, `disputes.ts` (read-only).

Every resource fetched by ID is consistently scoped to the authenticated
caller. Auth middleware is present everywhere required. Guest-checkout and
IP-case claimant flows use random, hashed-at-rest capability tokens (no raw
token stored, no enumeration). No secrets/PII found logged.

**[MEDIUM] Unvalidated file upload — `conversations.ts` `POST /upload-media`**
`mimeType` and `extension` were taken directly from the request body.
`extension` was only stripped of a leading `.`, so arbitrary characters
(including `/`, `..`) could reach the generated object-storage key, and
`Content-Type` was whatever the client claimed, with no allowlist. Not
cross-user IDOR (the `userId` path segment is server-derived), but an
uncontrolled-input weakness. **Fixed:** replaced with a fixed
mimeType→extension allowlist for the media types this feature supports;
client-supplied `extension` is no longer read; added a base64-charset check.
**Test:** `conversation-upload-media.test.ts` (3 cases, all passing).

### 2.3 IDOR / role checks — seller, manufacturer, store-admin routes
Audited 30+ route files covering seller settings/locations/metafields,
store, inventory, products, drops, bundles, discounts, boosts, ad campaigns,
analytics, customers, team, manufacturers, freelancers, shipping, taxes,
design-studio/mockup/logo/photography uploads, moderation, feature flags,
integrations, Shopify import. (`webhooks.ts`, `connect.ts`, `finance.ts`,
`subscription.ts`, `drop-wallet.ts` were explicitly out of this audit's
scope, reviewed by the buyer-routes/webhooks audits instead.)

**[HIGH] Broken owner-scoping via wrong auth field — `seller-locations.ts`,
`seller-metafields.ts`, `seller-settings-route.ts`, and `live.ts`**
All four routers read `(req as any).userId` for the authenticated seller's
id. `requireAuth` only ever sets `req.clerkUserId` — `req.userId` is never
set by any middleware in the codebase. Every raw-SQL query scoped to
`owner_id = ${ownerId}` was therefore scoped to `owner_id = NULL`. Not
classic cross-tenant IDOR (Postgres `= NULL` never matches, so no seller
could read another seller's rows through these specific endpoints), but
every GET silently returned empty/404 for every seller, and every
POST/PATCH wrote orphaned rows not attributable to the real caller — these
features were effectively non-functional for everyone.
**Fixed:** `(req as any).userId` → `(req as any).clerkUserId` (19 occurrences
across the 4 files — `live.ts` was found by the seller-route audit as the
same bug but outside its assigned scope, then fixed in the final
integration pass).
**Test:** `seller-owner-scoping.test.ts` (8 cases) asserts the `owner_id`
bound SQL parameter always equals the authenticated caller's id, never
`undefined`; verified to fail pre-fix and pass post-fix. (`live.ts`'s fix
mirrors the same pattern; a live-streaming feature test was out of scope to
add here.)

No other vulnerabilities found in this scope. Upload endpoints
(design-studio, mockup, logo, photography, techpack, shopify-import) all
generate storage keys from `randomUUID()`, not user input — no path
traversal. No secrets/PII found logged.

### 2.4 Rate limiting and abuse protection
**Flaky test fixed:** `middlewares/rateLimit.test.ts` — rate-limit buckets
are persisted in a shared Postgres table keyed by a synthetic client IP.
Two tests picked IPs from a narrow random range
(`198.51.100.<1-200>`/`<1-100>`), which had a real chance of colliding with
another parallel test run's bucket key and tripping the limit before the
test's own requests — an intermittent 200→429 failure under `vitest run`'s
parallel workers. Replaced both with `crypto.randomUUID()`-based synthetic
addresses (`normalizeClientIp` does no IP-format validation, so this is a
legitimate synthetic identity) — collision-proof by construction.

**New rate limits added** (middleware-only; no handler logic touched):

| Route(s) | Policy | Limit |
|---|---|---|
| `conversations.ts` `POST /`, `POST /:id/messages` | `messaging` (new) | 30/min |
| `post-comments.ts` `POST /:postId/comments` | `comment` (new) | 20/min |
| `social.ts` `POST /follow`, `DELETE /follow/:userId` | `follow` (new) | 30/min |
| `reports.ts` `POST /` | `report` (new) | 10/5min |
| `safety.ts` `POST /muted-words` | `report` (new) | 10/5min |
| `buyer-payments.ts` `POST /:pmId/default`, `DELETE /:pmId` | `checkout` (existing) | 20/5min |
| `design-studio.ts` (router-wide) | `expensive` (existing) | 30/min |

Already covered by the global `appRateLimiter` path-regex policies (no
change needed): `auth.ts` (login/OTP), `guest-checkout.ts` (checkout),
`bg-removal.ts`/`mockup.ts`/`logo.ts`/`photography.ts`/`techpack.ts`
(uploads, via the `EXPENSIVE_PATH` policy match). The Design Studio
asset-upload route already had its own stricter `asset-upload` policy
(6/min) applied in `app.ts`'s admission chain — the new router-wide
`expensive` policy is a no-op there (guarded by the existing
`rateLimitApplied` flag), so it isn't double-counted.

### 2.5 CORS and security headers
`app.ts` had `cors({ credentials: true, origin: true })` — reflects any
`Origin` header, which combined with credentials is a real
cross-site-credentialed-request hole. **Fixed:** replaced with an allowlist
(`lib/webOrigin.ts`: `allowedWebOrigins()`/`isAllowedWebOrigin()`) covering
the canonical origin, active Replit dev/deployment/internal domains, and
localhost in dev. Requests with no `Origin` header (native mobile,
server-to-server) are unaffected.

Added a baseline security-headers middleware: `X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Resource-Policy`,
`Permissions-Policy`, and `Strict-Transport-Security` (production only).

### 2.6 Secrets / error hygiene — reviewed, already solid
`errorHandling.ts` returns only a generic message for unclassified errors in
every environment. `logger.ts` already redacts
`req.headers.authorization`, `req.headers.cookie`,
`res.headers['set-cookie']`. No logger/console calls found leaking
passwords/secrets/tokens/API keys anywhere in `src`.

---

## 3. Performance

### 3.1 New indexes (migration `lib/db/migrations/085_hot_path_performance_indexes.sql`)
All `CREATE INDEX IF NOT EXISTS`, non-destructive, no data/behavior change:

| Index | Why |
|---|---|
| `orders_owner_created_idx (owner_id, created_at DESC)` | `orders.owner_id` had **no index at all** — every seller-dashboard analytics query (revenue, order counts, customer stats) was a full sequential scan. |
| `orders_buyer_id_idx (buyer_id) WHERE buyer_id IS NOT NULL` | Buyer order history / guest checkout verification. |
| `orders_source_post_id_idx (source_post_id) WHERE source_post_id IS NOT NULL` | Post-purchase attribution (`posts.ts` `/:id/analytics` conversions). |
| `customers_owner_id_idx (owner_id)` | Also unindexed; seller dashboard customer count/list. |
| `products_owner_status_created_idx (owner_id, status, created_at DESC) WHERE deleted_at IS NULL` | `products.owner_id` also unindexed; seller catalog list + public storefront filter + post-tag validation. |
| `interactions_post_type_idx (post_id, type) WHERE post_id IS NOT NULL` | Feed/discover/post-detail like+repost counts filtered post_id-in-list AND type — only a single-column index existed before, forcing in-memory type filtering. |
| `seller_quote_requests_seller_created_idx (seller_id, created_at DESC)` | Avoids an in-memory sort on "my quote requests, newest first." |
| `manufacturers_public_directory_idx (verified_at DESC NULLS LAST, created_at DESC) WHERE is_public_directory = true AND status = 'active'` | Matches the public directory listing's exact filter+order shape. |

### 3.2 N+1 fix
**`guest-checkout.ts` `POST /session`:** cart-item validation ran one
`productVariants`+`products` query *per item* inside a `for` loop (up to 100
items → up to 100 round trips). Rewrote to a single `inArray(...)` batch
query before the loop, then O(1) map lookups inside it. **Before:** O(N)
round trips. **After:** O(1) — one query total, same validation semantics
(variant/product pairing, stock, status, same-seller checks all preserved).

### 3.3 Pagination added
(via the existing `lib/pagination.ts` helper, default 100, capped at
`MAX_PAGE_LIMIT`, with `X-Pagination-*` response headers)

Previously-unbounded list endpoints, now capped and paginated:
`posts.ts GET /mine`, `products.ts GET /`, `social.ts GET /following`,
`GET /followers`, `conversations.ts GET /` (the conversation-id lookup
itself is now ordered+paged before per-conversation detail is fetched, so a
large inbox no longer loads every conversation ever had), `seller-hub.ts
GET /manufacturers`, `GET /quote-requests`, `manufacturer-public.ts GET /`
(public directory). (`posts.ts /feed`, `public.ts /products` and `/posts`,
`social.ts /profile/:id/posts` and `/friends/activity` already had
pagination.)

### 3.4 HTTP caching
New `lib/httpCache.ts` → `setPublicCacheHeaders(res, {maxAgeSeconds,
staleWhileRevalidateSeconds})` (default 30s/120s). Applied only to
responses identical for every caller (no viewer/auth/block-list
dependence): `public.ts /products`, `/products/high-demand`,
`/products/:id/related`, `/products/:id`, `/drops`, `/drops/:id`,
`/trending` (60s/300s), `manufacturer-public.ts GET /`, `GET /:id`,
`GET /:id/reviews`. Deliberately **not** applied to `public.ts /posts`,
`/sellers/:sellerId`, `/profiles/:username`, `/search` — these factor in
the optional viewer's block relationship, so the response is
viewer-dependent and unsafe to cache without per-viewer variance.

### 3.5 What's left (found, not fixed — with reasons)
1. **Image resizing/compression:** `lib/objectStorage.ts` has no
   resize/compress/thumbnail logic anywhere. Product photos, post media,
   avatars, and manufacturer photos are stored and served at whatever
   resolution the client uploaded. This is a real gap; wiring in a resize
   pipeline (adding `sharp`, touching every upload path across
   `products.ts`/`posts.ts`/`post-video.ts`/manufacturer routes) is a
   cross-cutting change well beyond a contained fix and risked colliding
   with the parallel security-focused work on those same route files.
   **Top priority follow-up.**
2. **`live.ts` — `live_streams` table not in the tracked schema:** queried
   via raw SQL but does not exist anywhere in `@workspace/db`'s Drizzle
   schema or migrations, so no index could safely be added for it through
   this migration system. Flagging for whoever owns that table/feature.
3. **`conversations.ts` `sellerRecipients` vacation-status loop**
   (`POST /:id/messages`) sequentially awaits a per-recipient status check.
   Left alone: group DMs are rare (most conversations have exactly one
   other participant), and parallelizing changes the
   early-return-on-first-vacationing-seller semantics slightly — not worth
   the behavior-shape risk for a rare-cardinality path.
4. `buyer-products.ts`, `buyer-payments.ts`, `cart-db.ts`, `lifestyle.ts`
   reviewed, no N+1s/missing pagination/missing indexes worth adding (cart
   reads are single-row-by-PK, buyer-payments is pure Stripe API calls,
   lifestyle.ts does no DB reads).

---

## 4. Reliability

### 4.1 Global error handling
Design was already solid (consistent `{ error: { code, message, details? },
requestId }` envelope everywhere, including legacy `res.status(x).json()`
calls; global handler registered last; no stack traces/internals leak in
prod). **Gap closed:** error log lines carried `err`/`errorCode`/`status`
but no route or caller id — added `callerIdFor(req)` (Clerk `getAuth`,
falls back to `req.clerkUserId`, never throws) so every `req.log.error()`
call now logs `route`, `userId`, `requestId`.

### 4.2 Health / readiness
Split into liveness (`GET /healthz`, `/healthz/live` — process up, no
dependency checks) and readiness (`GET /healthz/ready` — checks Postgres
via `SELECT 1` with a 2s timeout, returns 503 with a per-check breakdown
when down). Fixed the rate limiter's health-path exemption (only matched
paths ending in `/healthz`) to also cover the new `/ready` and `/live`
sub-paths — otherwise a DB outage could make the rate limiter itself (which
queries the DB) fail readiness checks for the wrong reason.

### 4.3 Graceful shutdown
Added SIGTERM/SIGINT handling to `index.ts`: `server.close()` stops new
connections and lets in-flight requests finish, then closes the Postgres
pool and flushes Sentry, with a 20s hard timeout
(`SHUTDOWN_TIMEOUT_MS`-overridable) that force-exits if draining hangs.
Guarded against re-entrant signal delivery.

### 4.4 Retries with backoff
New shared `lib/retry.ts` helper, applied only where safe:
- `shippo.ts`: `getRate`, `findTransaction`, `createShipment` (reads only).
  `purchaseTransaction` and `refundTransaction` deliberately **left
  unwrapped** — Shippo doesn't document a client-supplied idempotency key
  for either, and purchasing spends the seller's balance.
- `klaviyo.ts`: all calls are reads, wrapped via a shared `klaviyoGet()`.
- `push.ts`/`sendPush.ts`: Expo send wrapped — safe because delivery rows
  are already claimed idempotently per-token before sending, so a retry
  can't double-mark a delivery sent.
- `objectStorage.ts`: `signObjectURL` wrapped (no side effect).
- `stripe.ts`: uses the SDK's own `maxNetworkRetries: 2` instead of the
  shared helper — retries only transport failures and auto-generates a
  Stripe idempotency key per request. **No Stripe call was wrapped in the
  ad-hoc retry helper**, to avoid any risk of a retried charge/transfer/
  refund double-applying.
- Deliberately left alone: OpenAI client (has its own SDK default retries,
  out of scope), GCS calls in `objectStorage.ts` (SDK has built-in
  retry/backoff already).

### 4.5 Background job safety (double-processing prevention)
Reviewed all 7 files in `src/jobs/`. `teamInviteReminder.ts`,
`sellerTrialReminder.ts`, `designStudioObjectCleanup.ts`: already correctly
guarded with claim+lease patterns. `scheduledDropBroadcasts.ts`: claims the
drop row with `SELECT ... FOR UPDATE` inside a transaction — safe.
`computeTrending.ts`: upsert with no side effects beyond overwriting a
cache row — safe. `abandonedCartRecovery.ts`: real double-notification bug
found and fixed (§1.2). `moneySweep.ts`: audited, no bug found, untouched
(§1.3).

---

## 5. Mobile — error boundaries (small, scoped change)

Constraint: many other sessions are actively editing mobile screens, so
this change had to be minimal and could not touch individual screen files.

**Found:** most of the infrastructure already existed —
`components/ErrorBoundary.tsx` (class-based boundary + `ErrorFallback.tsx`
"Something went wrong" UI with retry), `lib/monitoring.ts` (Sentry wiring,
safe no-op when unconfigured), and `app/_layout.tsx` already wrapping the
whole app in one top-level `ErrorBoundary`.

**What was actually missing:** per-tab crash isolation. Added
`TabScreenErrorFallback` to `components/ErrorBoundary.tsx`, wired via Expo
Router's `unstable_screenErrorBoundary={TabScreenErrorFallback}` prop on
both tab navigators (`app/(tabs)/_layout.tsx` seller tabs,
`app/(buyer)/_layout.tsx` buyer tabs) — Expo Router wraps each
individually-registered tab screen's content in its own error boundary
automatically from this one prop, so no screen files were touched.

**Diff size:** 4 files — one new export in the shared component, one
import + one prop line in each of the two tab-navigator layout files, plus
one new test file (`components/__tests__/ErrorBoundary.test.tsx`).

---

## 6. Load testing

`scripts/loadtest/launch-day.js` (k6) simulates launch-day traffic across 6
weighted scenarios: browse feed, discover/search, view product, add to
cart, checkout up to a Stripe test-mode Checkout Session, and messaging.
Each has realistic think-time, `check()` assertions, and per-scenario +
global thresholds (p95 latency, error rate) that fail the run if crossed.
Full instructions: `docs/launch/load-test.md`.

**Status: not yet run against a live server.** This sandbox has no
provisioned Clerk/Stripe test credentials and DB setup requires
privilege-escalation commands blocked by the environment's security
policy. The script itself was validated (k6 installed and run against a
closed port to confirm every scenario function executes without a runtime
error and all checks/thresholds fire as designed) — no fabricated timing
numbers are reported anywhere. **Run it against a staging deploy before
launch and record real numbers in `docs/launch/load-test.md`.**

---

## 7. Verification performed in this PR

- **Typecheck:** `pnpm run typecheck` (all workspace libs + every artifact,
  including `api-server` and `mobile`) — **clean, 0 errors.**
  - One regression was introduced by merging the parallel security and
    performance branches together: inserting a middleware argument between
    a route path and its handler (`router.post("/:id/messages",
    rateLimit(...), handler)`) breaks Express 5's literal-path-based
    inference for `req.params`, widening string params to
    `string | string[]`. Fixed at the four affected call sites
    (`conversations.ts`, `social.ts`, `buyer-payments.ts`) with an explicit
    param-shape assertion.
- **api-server tests:** `npx vitest run` — **327 passed, 13 skipped, 0
  failed** across the 45 test files runnable without a live Postgres
  connection. The remaining 61 test files require `DATABASE_URL` (a live
  DB) and could not run in this sandbox — this is a pre-existing sandbox
  limitation (no provisionable DB credentials here), not a code issue; run
  them in CI, which has a real `DATABASE_URL`.
  - One test (`message-report-deduplication.test.ts`) broke as a direct
    result of adding rate limiting to `reports.ts` (its isolated router
    mount has no real DB, and the rate limiter correctly fails closed with
    503 on a DB error) — fixed by stubbing the rate limiter the same way
    `requireAuth` was already stubbed in that test.
  - The previously-flaky `rateLimit.test.ts` fix (see §2.4) could not be
    re-verified live in this sandbox for the same DB-access reason; please
    run it a few times / under parallel workers in CI to confirm the flake
    is gone.
- **mobile tests:** `npx vitest run` — **151 files, 2096 tests, all
  passing**, including the new `ErrorBoundary` tests.
- **Migration** reviewed for safety: purely additive (`CREATE INDEX IF NOT
  EXISTS`), no data or behavior change, consistent with the existing
  migration style.

## 8. Summary of what's left (follow-ups, not blockers)

1. Image resizing/compression pipeline (§3.5.1) — top priority.
2. `live.ts`'s `live_streams` table needs to be added to the tracked
   Drizzle schema/migrations so it can get proper indexing (§3.5.2).
3. Run the k6 load test (§6) against a real staging deploy and record
   results here.
4. Run the full `api-server` test suite (including `rateLimit.test.ts`
   repeated/parallel runs) against a real `DATABASE_URL` in CI to confirm
   everything in this report that could only be verified by static
   review/non-DB tests in this sandbox.
