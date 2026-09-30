# Connectivity matrix

Generated 2026-09-30 against a real Postgres database (all migrations applied) and the real Express routers — no mocked DB layer. Produced by running the end-to-end connectivity suite below with three fresh test users the suite creates and cleans up itself each run (Seller S, Buyer A, Buyer B — never real accounts).

**Run it with:**

```
cd artifacts/api-server
TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/brandthread_test" \
  npx vitest run src/routes/__tests__/connectivity-suite.integration.test.ts \
                  src/routes/__tests__/connectivity-dm-routing.integration.test.ts \
                  src/routes/__tests__/connectivity-commerce-social.integration.test.ts
```

or, from `artifacts/api-server`:

```
TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/brandthread_test" pnpm run test:connectivity
```

**Result of the run this matrix reflects:** 3 test files, 37 tests, 37 passed, 0 failed.

Test files:
- `artifacts/api-server/src/routes/__tests__/connectivity-suite.integration.test.ts` — sections 1, 2, 6 (8 tests)
- `artifacts/api-server/src/routes/__tests__/connectivity-dm-routing.integration.test.ts` — section 3 (22 tests)
- `artifacts/api-server/src/routes/__tests__/connectivity-commerce-social.integration.test.ts` — sections 4, 5 (7 tests)

Every row below reflects what the suite actually verified on this run, not a prediction. Rows marked **GAP** are scenarios this suite deliberately does not assert a pass/fail for — the reason is given inline, and none of them were shallowly marked PASS to pad the table.

---

## 1. Follow connectivity

| component | what connects | PASS/FAIL | notes |
|---|---|---|---|
| Follow | A follows S → S's followers count +1 (real `COUNT` via `GET /api/social/status`, `/profile`), A's following +1 | PASS | verified via direct status/profile reads after the follow, not client state |
| Follow | S gets a `new_follower` notification, correct title/CTA for a fresh (non-mutual) follow | PASS | polled `notificationsFeed` row; `cta: "Follow back"` |
| Follow | Unfollow reverses the follow row AND the stale notification | PASS | both `follows` and `notificationsFeed` rows confirmed gone |
| Follow | Follow-back: notification copy differs ("followed you back", no CTA), `isMutual` flips true both sides | PASS | |
| Follow | Remove-follower (`DELETE /followers/:userId`) removes the relationship without notifying the removed follower, distinct from unfollow | PASS | |
| Block | Block removes any existing follow rows both directions, hides profile both ways, blocks re-follow with `code: BLOCKED` | PASS | |
| Feed ranking | A's feed starts showing S's posts/stories/lives after following | **GAP** | no cheap DB-level or single-endpoint way to assert feed ranking; flagged rather than half-tested (matches the task's own guidance) |

## 2. Profile connectivity

| component | what connects | PASS/FAIL | notes |
|---|---|---|---|
| Profile edit → public read | `PATCH /api/auth/profile` (brandName, bio, website) is visible live via `GET /api/social/profile/:userId` | PASS | confirmed both through the HTTP response and a direct `users` row read — same row, no snapshot/cache in between |
| Profile edit → conversation participant snapshot | `conversations.ts`'s routing reads `users.accountType` live off the same row (used for the seller-order-routing branch), not a value captured once at signup | PASS (by inspection + the DM-routing suite's seller-order tests, which depend on this being live) | |
| "Shows in chat header" / "shows in search" as deep UI assertions | — | **GAP** | out of scope per the task's own guidance — connectivity is established by confirming shared live data source above, not by hitting every consumer |

## 3. DM + message-request routing (`lib/conversationRouting.ts`)

All 22 cases below run against the real `conversations`/`social` routers and a real Postgres database.

| component | what connects | PASS/FAIL | notes |
|---|---|---|---|
| Routing | Non-follower, no order → recipient's Requests, `isRequest: true`, `requestedBy` = sender | PASS | |
| Routing | Recipient cannot reply before accepting: `POST /:id/messages` → 403 `REQUEST_NOT_ACCEPTED`; requester CAN still send follow-ups while pending | PASS | |
| Routing | `PATCH /:id/accept` moves it to both inboxes (`isRequest: false`, `requestedBy: null`); only the non-requester may accept (requester accepting their own request → 403) | PASS | |
| Routing | `DELETE /:id` (decline) removes the conversation entirely | PASS | |
| Routing | Recipient already follows sender → straight to main inbox, no accept needed | PASS | |
| Routing | Seller recipient + buyer sender WITH a real paid order → straight to main inbox | PASS | |
| Routing | Seller recipient + buyer sender with NO order → Requests | PASS | |
| Routing | An order on a DIFFERENT buyer Clerk ID (narratively "the same person") does NOT count | PASS | |
| Routing | A fully refunded order does NOT count as real | PASS | |
| Routing | A partially refunded order STILL counts as real (per the documented rule) | PASS | |
| Routing | A cancelled order does NOT count | PASS | |
| Routing | An unpaid order (`paidAt` null) does NOT count | PASS | |
| Routing | Seller → buyer (unsolicited, buyer doesn't follow seller) → Requests, no special-casing for sellers as senders | PASS | |
| Routing | Seller ↔ seller: same universal rule applies (Requests when not followed, main inbox once followed) | PASS | |
| Auto-promotion | Pending request auto-moves to main inbox when the recipient follows the sender back | PASS | via `POST /api/social/follow`, re-fetched via `GET /:id` |
| Auto-promotion | Pending request auto-moves to main inbox when the buyer places a real paid order afterward | PASS | full Stripe webhook route is impractical to drive per-case here (needs a fresh checkout session per test); calls `promotePendingRequestsOnOrder` directly, the exact function `webhooks.ts`'s `handleCheckoutPaid` calls — the commerce section separately drives the real webhook route end-to-end for order visibility/notification |
| Regression guard | A like or a comment on a post never creates a `conversations`/`messages` row | PASS | row counts compared before/after; guards against future regression, was already true today |
| Read receipts, typing, persistence | — | Covered elsewhere | `conversation-two-account-e2e.test.ts` (re-run clean, 1/1 passed) |
| Typing indicator edge cases | — | Covered elsewhere | `conversation-typing.test.ts` |
| Attachments/media upload | — | Covered elsewhere | `conversation-upload-media.test.ts` |
| Reactions | — | Covered elsewhere | `message-reactions.test.ts` |
| Mute, block-mid-conversation | — | Covered elsewhere | `conversation-two-account-e2e.test.ts`, `social-follow.integration.test.ts`'s block-race case |
| Migrating existing conversations | — | **N/A — explicitly dropped** | Dev's rule 5 was withdrawn; no migration code exists and none was tested |

## 4. Commerce connections

| component | what connects | PASS/FAIL | notes |
|---|---|---|---|
| Save → DB | A saves S's product (`POST /api/buyer/saved`) is queryable by product, attributed to A | PASS | |
| Save → seller-facing count | A seller-facing "product insights / likes-saves count" endpoint | **GAP (real, handed off — see below)** | no such endpoint exists today; `lib/stockNotifications.ts` reads `savedItems` by product only to fan out back-in-stock alerts, never to surface a count. Not fixed — this is a product/seller-dashboard feature gap, not a DM-routing/social-backend bug, and outside this task's fix authority |
| Real paid order → seller orders list | A real paid order, driven through the REAL `/api/webhooks/stripe` route (mocked Stripe SDK + signature check only, same seam as `paid-checkout-notification.integration.test.ts`), shows up in `GET /api/orders` (seller) | PASS | |
| Real paid order → seller dashboard totals | Same order reflected in `GET /api/seller/profile`'s `metrics.orders` / `metrics.revenueCents` | PASS | |
| Real paid order → notification | `new_order_received` notification published, deep-linked to the exact order id | PASS | |
| Thread Cash balance | — | **GAP** | separate money subsystem with its own dedicated integration coverage (`thread-cash.integration.test.ts`, `thread-cash-send.integration.test.ts`); out of scope for cheap testing here per the task's own guidance |

## 5. Social content connections

| component | what connects | PASS/FAIL | notes |
|---|---|---|---|
| Post like | A's like on S's post → `notifyPostLike` reaches S (`notificationsFeed` row) AND the post's own `likeCount` (`GET /api/posts/:id`) reflects it | PASS | |
| Post comment | A's comment on S's post → `notifyCommentActivity` reaches S AND the post's own comment list reflects it | PASS | |
| Story view | `POST /stories/:id/view` reflected in the author's `GET /stories/:id/viewers` | PASS | |
| Story reply | — | Covered elsewhere | routed through the same DM/request pipeline as section 3 (no separate story-reply conversation-creation code path exists); not duplicated |

## 6. Account-switch isolation

| component | what connects | PASS/FAIL | notes |
|---|---|---|---|
| Conversations | B (a different Clerk ID) cannot read A's conversation with S (`GET /:id` → 404, `GET /:id/messages` → 403), and A's conversation never appears in B's own conversation list | PASS | new coverage — no prior test existed for this |
| Follows | B's and A's follow status toward S read independently (A follows, B does not) | PASS | |
| Orders | A real order under A's account (with S) does not leak into B's `GET /api/buyer/orders`, even scoped to the same seller | PASS | reuses the `ownerId`/`buyerId` scoping pattern from `seller-orders-list.integration.test.ts` / `inventory-list.integration.test.ts`, framed explicitly as the account-switch case |

---

## Bugs found while writing this suite

None found in conversations/social/orders-messaging backend logic that needed fixing — every scenario passed against the code as already implemented by the orchestrating session's DM-routing change. No changes were made to application code; only new test files (and this doc) were added.

## Bugs found but NOT fixed (different area — handed off)

- **No seller-facing "product likes/saves count" read endpoint.** A buyer saving a seller's product (`POST /api/buyer/saved`) persists correctly and is attributable per-product, but there is no endpoint that surfaces that count back to the seller (grepped `routes/products.ts`, `routes/seller-profile.ts`, `lib/stockNotifications.ts` — the latter reads `savedItems` by product only to fan out back-in-stock alerts, never a count). This is a seller-dashboard/product-insights feature gap, not a bug in the DM-routing/social-backend work this suite targets — handing off for a session that owns seller product analytics.

## Known, documented gaps (not bugs — noted plainly rather than shallow-tested)

- **Feed ranking** (section 1): "A's feed starts showing S's posts/stories/lives after following" has no cheap DB-level or single-endpoint assertion available.
- **Thread Cash balance** (section 4): out of scope here; has its own dedicated integration test files.
- **Deep UI connectivity** ("shows in chat header", "shows in search") (section 2): established instead via the shared live data source (same `users` row read by both the profile-edit route and the public-profile/search routes), per the task's own guidance not to hit every consumer.
