# Full read wave 1: API routes + middleware

Every file under `artifacts/api-server/src/routes` and `artifacts/api-server/src/middlewares` (source; tests excluded): **284 files, 89,917 lines, 89,917 read.** Read in 15 slices in parallel. Line counts are `wc -l` of `origin/dev` at 71a99506.

## Decisions only Dev can make (found, NOT changed)
1. **Seller payout gate was silently dropped by a merge.** `9b4a8041` added a gate that blocks publishing until Stripe payouts are ready. Merge `9419cd86` (pr-1089) dropped it from `products.ts` and `product-bulk.ts`. The app still calls the gate's `GET /api/products/payout-gate`, but the server no longer has that route; it now gets a clean 404 instead of a 500. `shopify.ts` still enforces the gate, and `payout-gate.integration.test.ts` fails on dev. Restoring it would block every seller without Stripe from publishing. To restore: `git show 9b4a8041 -- artifacts/api-server/src/routes/products.ts artifacts/api-server/src/routes/product-bulk.ts`. To drop it instead: delete the mobile hook and the shopify.ts gate.
2. **Native-subscription cancel error code mismatch.** `mobile/app/billing.tsx:212` only handles `NATIVE_SUBSCRIPTION`, but `subscription.ts:583` sends `MANAGE_IN_STORE`. So App Store and Play sellers see a generic error instead of "Manage in store". The existing tests contradict each other on which code is right. Pick one.
3. **Feed video: crop or letterbox?** `post-video-contract.test.ts` (failing on dev) expects crop, but `lib/mediaQuality.ts composeClipChain` deliberately letterboxes.
4. **Guest shipping is a visible money change I made. Please confirm.** At a seller with no shipping zones or rates, guest checkout charged **$0** shipping, so the seller paid for the label. Signed-in checkout charges the standard rate (`lib/defaultShipping.ts`, which says "not free"). Guests now pay the same standard rate. Revert the `flatRateShipping` hunk in `guest-checkout.ts` if $0 for guests was intended.


---
### Slice s00 log (middleware + routes/index.ts + routes/admin)
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/middlewares/.gitkeep | 0 | 0 | 0 | 0 |
| src/middlewares/aiSafetyGuard.ts | 190 | 190 | 1 | 1 |
| src/middlewares/bodySchemas.ts | 161 | 161 | 0 | 0 |
| src/middlewares/clerkProxyMiddleware.ts | 146 | 146 | 0 | 0 |
| src/middlewares/compression.ts | 29 | 29 | 0 | 0 |
| src/middlewares/errorHandling.ts | 93 | 93 | 0 | 0 |
| src/middlewares/featureGate.ts | 60 | 60 | 1 | 1 |
| src/middlewares/nativeStoreRail.ts | 28 | 28 | 0 | 0 |
| src/middlewares/packerAccess.ts | 121 | 121 | 0 | 0 |
| src/middlewares/pushBroadcastAllowance.ts | 50 | 50 | 0 | 0 |
| src/middlewares/rateLimit.ts | 564 | 564 | 0 | 0 |
| src/middlewares/requireAiConsent.ts | 75 | 75 | 0 | 0 |
| src/middlewares/requireAuth.ts | 140 | 140 | 0 | 0 |
| src/middlewares/requireRole.ts | 438 | 438 | 0 | 0 |
| src/middlewares/responseCache.ts | 173 | 173 | 2 | 2 |
| src/middlewares/reviewTextModeration.ts | 36 | 36 | 1 | 1 |
| src/middlewares/securityHeaders.ts | 42 | 42 | 0 | 0 |
| src/middlewares/teamRouteRules.ts | 79 | 79 | 1 | 1 |
| src/middlewares/validateRequest.ts | 93 | 93 | 0 | 0 |
| src/routes/admin/access.ts | 105 | 105 | 0 | 0 |
| src/routes/admin/b2b.ts | 77 | 77 | 1 | 1 |
| src/routes/admin/commerce.ts | 247 | 247 | 1 | 1 |
| src/routes/admin/growth.ts | 372 | 372 | 0 | 0 |
| src/routes/admin/guard.ts | 35 | 35 | 0 | 0 |
| src/routes/admin/index.ts | 56 | 56 | 0 | 0 |
| src/routes/admin/insights.ts | 150 | 150 | 0 | 0 |
| src/routes/admin/killSwitches.ts | 66 | 66 | 0 | 0 |
| src/routes/admin/manufacturerTrust.ts | 136 | 136 | 0 | 0 |
| src/routes/admin/metrics.ts | 97 | 97 | 0 | 0 |
| src/routes/admin/money.ts | 321 | 321 | 0 | 0 |
| src/routes/admin/platformBalance.ts | 32 | 32 | 0 | 0 |
| src/routes/admin/safety.ts | 178 | 178 | 0 | 0 |
| src/routes/admin/shippingAdjustments.ts | 53 | 53 | 0 | 0 |
| src/routes/admin/trust.ts | 92 | 92 | 0 | 0 |
| src/routes/admin/users.ts | 203 | 203 | 0 | 0 |
| src/routes/admin/util.ts | 29 | 29 | 0 | 0 |
| src/routes/index.ts | 618 | 618 | 3 | 3 |

Root cause behind several of these gate bypasses: Express 5 matches routes ignoring case and trailing slashes, but `req.path`/`req.baseUrl` keep the caller's spelling. Gates that compared raw paths could be walked past by respelling the path (e.g. `/api/SELLER-HUB/RFQS/`).

#### Fixes (tests: `wave1-s00-middleware-paths.test.ts`, `wave1-s00-index-mounts.integration.test.ts`, `middlewares/__tests__/responseCache.test.ts`; all 22 new assertions fail on HEAD)
- `index.ts` — **AI metering bypass**. `/support-chat` was mounted twice. The first mount sat *above* `aiCreditsGate`, so support chat never hit its per-user daily ceiling or the global AI cap. Removed the early mount.
- `index.ts` — **mount order**. Nine `/seller/*` routers sat below the `/seller` catch-all, so its team rule ("writes need products") ran first. As a result, viewer/marketing/finance/orders members couldn't save their own `PUT /seller/notification-prefs`, and marketing couldn't `POST /seller/product-feed`. The mounts moved above the catch-all, following the file's own rule. payment-settings, quick-replies and away-message only had the products write gate through the catch-all, so explicit `writes:"products"` rules now keep their behaviour unchanged.
- `index.ts` — the duplicate `/affiliate` mount was removed.
- `teamRouteRules.ts` — **role-gate bypass**. A viewer could `PUT /api/STORE` and skip the products write gate. Every rule was affected, including the owner-only `/seller/verification`. Lookups are now normalized.
- `featureGate.ts` — **plan-gate bypass**. `/seller-hub/RFQS` or `/rfqs/` skipped the Growth plan gate. The path is now normalized.
- `reviewTextModeration.ts` — **moderation bypass**. `/reviews/:id/REPLY` skipped the content filter on seller replies. The path is now normalized.
- `aiSafetyGuard.ts` — **prompt-filter bypass**. Any text that merely *started* with `http(s)://` or `data:` was treated as binary and never scanned, as was any long text with no spaces in its first 600 chars (e.g. CJK prompts). Only a whole URL, a data URI or a long base64 run now counts as binary.
- `responseCache.ts` — **draft leak once REDIS_URL is set**. A seller's private "Preview as buyer" of their own draft (`private, no-store`) filled the shared `anon` entry and was served to every visitor for 15s. Private and no-store responses are no longer cached there.
- `responseCache.ts` — signed-in viewers with blocks were served the shared `anon` entry, so blocked sellers' products showed. Those viewers now bypass the cache.
- `admin/commerce.ts` — `?status=delivered` returned 400 even though delivered is a real status. It is now accepted.
- `admin/b2b.ts` — a fractional `limit` returned 500; it is now truncated.

#### Cross-slice (proposed)
- `lib/aiConsent.ts` `EXTRA_AI_PATHS` checks the raw path. This is masked today by the catalogue rule. Hardening: normalize the path first.

#### Suspected — not changed
- aiSafetyGuard truncates text to 6000 chars before moderation, so a prompt can be hidden after the cutoff.
- The profile cache can be filled by an admin who sees the official account (pre-launch only).
- admin/growth double boost review returns 500 instead of 409.
- admin/money: dispute evidence is read-modify-write with no lock. When Stripe succeeds but the DB fails, the message wrongly says "Nothing was sent".
- pushBroadcastAllowance weekly count is check-then-send.

#### Judgment calls — not changed
- Rate-limit identity is the store owner under team context, so team members share the owner's buckets.
- `/seller/payment-settings` stays gated on products (not payouts).
- A packer's order view includes money fields (documented).
- The manufacturerTrust audit write happens outside the decision transaction.

#### Tests note
- plan-gates "live /start" fails because live.ts was changed by s06/s07. drops-role-gate's drizzle mock lacks `sql`. admin-money revenue expects 27800 but gets 17800 (from lib/admin/revenue.ts). See coordinator verification.


---
### Slice s01 log
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/routes/access.ts | 88 | 88 | 0 | 0 |
| src/routes/account-deletion-public.ts | 155 | 155 | 0 | 0 |
| src/routes/account-mutes.ts | 89 | 89 | 0 | 0 |
| src/routes/account-status.ts | 35 | 35 | 0 | 0 |
| src/routes/accounts.ts | 271 | 271 | 0 | 0 |
| src/routes/ad-campaigns.ts | 1018 | 1018 | 4 | 4 |
| src/routes/admin-promotions.ts | 261 | 261 | 0 | 0 |
| src/routes/ads-serve.ts | 91 | 91 | 0 | 0 |
| src/routes/affiliate-creator.ts | 319 | 319 | 2 | 2 |
| src/routes/affiliate-public.ts | 57 | 57 | 0 | 0 |
| src/routes/age.ts | 96 | 96 | 0 | 0 |
| src/routes/ai-consent.ts | 49 | 49 | 0 | 0 |
| src/routes/ai-credits.ts | 99 | 99 | 0 | 0 |
| src/routes/ai-helpers.ts | 425 | 425 | 0 | 0 |
| src/routes/ai.ts | 656 | 656 | 0 | 0 |
| src/routes/analytics-insights.ts | 797 | 797 | 1 | 1 |
| src/routes/analytics-reports.ts | 496 | 496 | 1 | 1 |
| src/routes/analytics.ts | 826 | 826 | 3 | 3 |
| src/routes/analyticsAdvanced.ts | 69 | 69 | 0 | 0 |
| src/routes/analyticsCustomers.ts | 44 | 44 | 0 | 0 |
| src/routes/app-config.ts | 98 | 98 | 0 | 0 |
| src/routes/app-installs.ts | 54 | 54 | 0 | 0 |

#### Fixes
- `ad-campaigns.ts` — a non-uuid `:id` returned 500 on every `/:id/*` route; it now returns 404. Test: `wave1-s01-ad-campaigns.test.ts`.
- `ad-campaigns.ts` — a non-uuid `ctaDestinationId` (shop_now/view_product) returned 500; it now gets the same 422 as an unknown product.
- `ad-campaigns.ts` PATCH — **money race**. Status was checked, then the write happened without re-checking. A `/pay` landing in between left a raised `budgetCents` behind a Checkout Session priced at the old budget, so the seller got more ad delivery than they paid for. The UPDATE now requires status draft/failed and returns 409 if the campaign moved.
- `ad-campaigns.ts` `/pay` — **the opposite race**. A PATCH between reading the campaign and saving the Stripe session left the same under-payment. The save now requires the same budget, duration and an allowed status. On a mismatch it expires the stray session, bumps `checkoutSessionVersion` so the retry gets a fresh idempotency key, and returns 409 `campaign_changed`. It also no longer overwrites a cancelled campaign.
- `affiliate-creator.ts` — a non-uuid invite id returned 500; it now returns 404. Test: `wave1-s01-affiliate-creator.test.ts`.
- `affiliate-creator.ts` `/payout-account/onboard` — a double tap created two Stripe Express accounts, and the losing call onboarded the account that wasn't linked to the creator, so payouts never reached it. The route now onboards the saved account.
- `analytics-insights.ts` `split()` — **k-anonymity leak**. When one half (new or returning) was hidden, the total was still shown, so total minus the shown half revealed the hidden group. The total is now null in that case. Test: `analytics-insights.integration.test.ts`.
- `analytics-reports.ts` — **permission hole**. There was no `requirePermission`, so staff/orders team members could read profit, fees, costs and creator commissions. It now requires `requirePermission("analytics")`, the same gate as /analytics/insights. Test: `wave1-s01-analytics.test.ts`.
- `analytics.ts` `/customers?limit=-5` returned 500; the limit is now clamped to 1–50.
- `analytics.ts` customer stats — all guest orders (buyer_id NULL) were grouped as one repeat "customer", which skewed the average and could push repeatRate above 100%. Guests are now excluded.
- `analytics.ts` `/advanced` counted unpaid and gross orders, contradicting the file's stated single revenue definition (paid, not cancelled, net of refunds). It now uses that definition, and the comment is fixed.

#### Cross-slice (not fixed — proposed patch)
- `lib/iapPromotionsStore.ts` `activateCampaign`: a budget raised while the IAP purchase is in flight gets activated for the cheaper purchase. Proposed fix: add `eq(adCampaigns.budgetCents, verifiedCents)` to the UPDATE WHERE.
- `routes/index.ts:524-525`: the affiliate router is mounted twice (s00's file).
- `lib/aiCredits/ledger.ts:442`: the `before` cursor passes `Date.parse` but Postgres rejects it (e.g. `"1"`), giving a 500.

#### Suspected — not changed
- `ai.ts` `maxTokens` is not checked. `/suggestions` caps the list at 10 orders, so its count can be wrong, and it calls pending orders "paid". `brand-memory/rebuild` includes soft-deleted products.
- `account-mutes` DELETE with a users.id uuid doesn't remove the row stored by clerkId. The app uses `/api/safety/mutes`, not this router.
- `account-deletion-public`: the resend cooldown is check-then-insert.
- `ad-campaigns` media arrays are read-modify-write, so two concurrent uploads can drop one.
- analytics-insights: the goals cap (10) is count-then-insert.

#### Judgment calls — not changed
- `/api/analytics/*` (home, dashboard, and `/customers` with buyer emails) has no team-permission gate. It's open to every team role.
- `admin-promotions`: approving a boost books `spentCents = budgetCents` up front.
- `/pay/verify` has no marketing permission check. The `"failed"` status is still accepted, though nothing sets it any more.
- Product revenue uses line-item prices, while content and advanced revenue use order totals.


---
### Slice s02 log
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/routes/auth.ts | 1556 | 1556 | 2 | 2 |
| src/routes/avatar-video.ts | 265 | 265 | 0 | 0 |
| src/routes/bg-removal.ts | 255 | 255 | 3 | 3 |
| src/routes/boosts.ts | 917 | 917 | 2 | 2 |
| src/routes/brand-membership.ts | 59 | 59 | 0 | 0 |
| src/routes/brandthread-agent.ts | 206 | 206 | 1 | 1 |
| src/routes/bundles.ts | 327 | 327 | 0 | 0 |
| src/routes/buyer-activity.ts | 95 | 95 | 0 | 0 |
| src/routes/buyer-payments.ts | 156 | 156 | 1 | 1 |
| src/routes/buyer-preferences.ts | 55 | 55 | 0 | 0 |
| src/routes/buyer-products.ts | 118 | 118 | 1 | 1 |
| src/routes/buyer-recommended-brands.ts | 102 | 102 | 0 | 0 |
| src/routes/buyer.ts | 2034 | 2034 | 2 | 2 |

#### Fixes
- `auth.ts` POST `/password-reset/confirm` — **account takeover risk**. A wrong guess never used up the 6-digit code; the only limit was per IP, so guesses spread over many IPs could sweep all 10⁶ codes within the TTL. Attempts are now counted per code, atomically (`consumeRateLimitBucket`). After 5 the code is burned and the endpoint returns 400 `TOO_MANY_ATTEMPTS`. Test: `wave1-s02-auth.test.ts`.
- `auth.ts` — a repeated query key (array) on `/username/check`, `/email/check` and `/account-types` returned 500; only strings are accepted now.
- `bg-removal.ts` GET `/results/*` — **fully broken**. The Express 5 wildcard is an array, and `decodeURIComponent` comma-joined it, so every real key got 403. The ownership check was a substring match, not an exact prefix. The stream had no error handler. Fixed: the segments are joined, an exact `<prefix>/bg-removal/<user>/<uuid>.png` match is required, and the stream uses `pipeline`. Test: `wave1-s02-bg-removal-results.test.ts`.
- `boosts.ts` — a non-uuid id returned 500; it now returns 404. The PATCH pause/cancel write was unconditional, so it could overwrite a status change made concurrently. It now requires the status it read and returns 409 if that changed. Test: `wave1-s02-boosts.test.ts`.
- `brandthread-agent.ts` and `buyer-products.ts` — a non-uuid id returned 500; it now returns 404. Test: `wave1-s02-agent-and-reserve-ids.test.ts`.
- `buyer-payments.ts` — an unknown payment-method id returned 500 with the raw Stripe message; it now returns 404. Test: `buyer-payment-methods.integration.test.ts`.
- `buyer.ts` POST `/checkout/session` — **money**. Rewards points were capped against the total *before* the seller's discount code, so code plus points could exceed the order. Stripe clamps the combined coupon, but the checkout row still recorded the full points discount and the seller was topped up for that full amount. Points are now capped against the total after the code. Test: `wave1-s02-buyer-checkout.test.ts`.
- `buyer.ts` GET `/orders/:id` — a non-uuid id returned 500; it now returns 400.

#### Cross-slice (proposed)
- `checkout-intent.ts:408` may have the same points-plus-code over-discount (it reserves loyalty against `subtotalCents + shippingCents`).

#### Suspected — not changed
- boosts: `activateBoostBySessionId` leaves a paid boost in `pending_payment` with no refund if the post became ineligible. `/summary` builds the month in local time and counts spend by createdAt.
- bundles: staff need both products-write and marketing permissions.
- auth: `/account-types` returns real names for any 8 Clerk ids. `/sync` runs two sign-in alert systems, so a new sign-in can produce two emails. The PATCH `/privacy` response leaves out some fields.
- buyer: the checkout idempotency-key lookup isn't scoped to the buyer. An unknown Stripe session returns 500 (the code checks `status`, but Stripe errors carry `statusCode`). `/reserve` never checks `isPreOrder`.
- avatar-video `/avatar-media/*` runs a `LIKE '%…'` scan on users, and `_` acts as a wildcard.

#### Judgment calls — not changed
- `/email/check` reveals whether an email is registered.
- buyer.ts runs an `ALTER TABLE … IF NOT EXISTS` at import time.
- The agent's `senderInitials` come from the username.

#### Tests note
- buyer-checkout-session.integration (8, seller has no plan, so SELLER_PLAN_LIMIT) and auth-username-screening race tests (2, spy on db.update while the code writes via tx) also fail on HEAD.


---
### Slice s03 log
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/routes/call.ts | 844 | 844 | 1 | 1 |
| src/routes/cart-db.ts | 137 | 137 | 0 | 0 |
| src/routes/catalog-public.ts | 39 | 39 | 0 | 0 |
| src/routes/checkout-config.ts | 15 | 15 | 0 | 0 |
| src/routes/checkout-extras.ts | 172 | 172 | 0 | 0 |
| src/routes/checkout-intent.ts | 860 | 860 | 0 | 0 |
| src/routes/clerk-status.ts | 20 | 20 | 0 | 0 |
| src/routes/close-friends.ts | 188 | 188 | 0 | 0 |
| src/routes/closet.ts | 114 | 114 | 1 | 1 |
| src/routes/collections.ts | 165 | 165 | 1 | 1 |
| src/routes/comment-media.ts | 105 | 105 | 0 | 0 |
| src/routes/communities.ts | 988 | 988 | 3 | 3 |
| src/routes/config-live.ts | 17 | 17 | 0 | 0 |
| src/routes/connect.ts | 399 | 399 | 0 | 0 |
| src/routes/conversations.ts | 1818 | 1818 | 6 | 6 |
| src/routes/customers.ts | 160 | 160 | 0 | 0 |
| src/routes/data-export-jobs.ts | 173 | 173 | 1 | 1 |
| src/routes/day-one.ts | 24 | 24 | 0 | 0 |

#### Fixes (test: `wave1-s03-input-validation.test.ts`; all 19 cases fail on HEAD)
- `communities.ts` `requireAdmin` returned the truthy `res.status(403).json(...)`, so every admin route (PATCH, invite reset, remove/ban/unban, bans, requests, approve, deny) **carried on after sending its 403** and threw a TypeError. It now returns null.
- `communities.ts` GET `/:id/messages`: a fractional or huge `before`/`after` returned 500; it now returns 400. PATCH `/:id/read`: a fractional `seq` returned 500; it now falls back to the head.
- `conversations.ts` group create: a duplicate invitee, or the creator listed as an invitee, broke the participant PK with a 500 *after* inserting the group, leaving an orphan. Invitees are now de-duplicated, the creator is excluded, and the inserts run in one transaction.
- `conversations.ts` 1:1 create with yourself inserted a conversation and then 500'd; it now returns 400.
- `conversations.ts` GET messages: `limit=abc` or a negative limit, or a bad `before`, returned 500. The limit is clamped to 1..100 and a bad `before` gets 400.
- `conversations.ts`: a non-uuid `replyToId`, card `meta.*Id` or reaction `messageId` returned 500. These are now dropped, or answered with 400/404.
- `call.ts` `/token`, `/token/renew`, `/events`: a non-uuid or non-string threadId returned 500; it now returns 400/403.
- `closet.ts`: the id regex accepted 36 dashes; it now uses a strict uuid check. `collections.ts` and `data-export-jobs.ts`: a non-uuid id returned 500; it now returns 404 or no-ops.

#### Cross-slice (proposed)
- Map Postgres 22P02 (invalid uuid/bigint text) to 400 in `middlewares/errorHandling.ts`. This systemically kills the remaining non-uuid `:id` 500s.
- `lib/discounts.ts` `reserveDiscountCapacity` compares a guest's `guest:<email>` key against the raw `guest_email`, so a guest's own abandoned checkout counts against them and can trigger MAX_USES_REACHED.
- Stale tests (fail on HEAD): messages-realtime-e2e "deleted" hint (DELETE is now delete-for-me); call-dm-push-data times out.

#### Suspected — not changed
- call.ts legacy DM POST `/token` skips `evaluateCallPolicy` (blocked participants can still get a token).
- connect.ts `/refresh`: the signed state (valid 24h) can mint an Express **dashboard login link** for a completed account, and it skips the age check.
- checkout-intent: the Thread Cash secondary check ignores bundle discounts (no money effect). The retry `like key\_%` can prefix-match another key's rows.
- variantMatrix exposes `remaining` even when `showRemainingCounter` is off.
- conversations.ts has a dead second PATCH `/:id/archive` handler.
- communities approve-request doesn't re-check blocks.
- customers POST/PUT do no validation and have an email race.

#### Contract
- `api.ts:4248` closeFriends types `friends[].username`, but the server returns `handle`, so username is always undefined (mobile side).

#### Judgment calls — not changed
- Group create skips DM-privacy and vacation checks (documented).
- Conversation display names are supplied by the client.
- The communities invite preview reveals private group details.
- Collection `coverImageUrl` accepts any string.
- Either participant can post theme and disappearing-message system lines.


---
### Slice s04 log
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/routes/design-studio.ts | 549 | 549 | 0 | 0 |
| src/routes/discount-codes.ts | 639 | 639 | 3 | 3 |
| src/routes/discover-public.ts | 228 | 228 | 0 | 0 |
| src/routes/discovery.ts | 410 | 410 | 0 | 0 |
| src/routes/display-preferences.ts | 41 | 41 | 0 | 0 |
| src/routes/disputes.ts | 570 | 570 | 2 | 2 |
| src/routes/drop-waitlist-public.ts | 91 | 91 | 0 | 0 |
| src/routes/drop-wallet.ts | 182 | 182 | 1 | 1 |
| src/routes/drops.ts | 642 | 642 | 5 | 5 |
| src/routes/email-marketing-public.ts | 131 | 131 | 0 | 0 |
| src/routes/email-marketing-webhook.ts | 91 | 91 | 0 | 0 |
| src/routes/email-marketing.ts | 358 | 358 | 1 | 1 |
| src/routes/email-opt-in.ts | 45 | 45 | 0 | 0 |
| src/routes/feature-flags.ts | 88 | 88 | 0 | 0 |
| src/routes/featured-public.ts | 87 | 87 | 0 | 0 |
| src/routes/featured-slots.ts | 512 | 512 | 1 | 1 |
| src/routes/feed-followed-fresh.ts | 196 | 196 | 1 | 1 |
| src/routes/feed.ts | 478 | 478 | 0 | 0 |
| src/routes/fees.ts | 40 | 40 | 0 | 0 |
| src/routes/finance-statements.ts | 208 | 208 | 0 | 0 |

#### Fixes (test: `wave1-s04-audit.test.ts`, 23 cases, all fail on HEAD)
- `drops.ts` — **the end time could never be removed**. The app sends `endsAt: null` when "Set an end time" is turned off (seller-drop-create.tsx:427), and the server ignored the null. Null now clears it.
- `drops.ts` PATCH did not enforce the endsAt > releaseAt rule that create enforces. The effective window is now checked against the stored values.
- `drops.ts` — a non-uuid `:id` returned 500 on every route except `/hype`. An invalid `estimatedPayoutDate` (create) or `estimatedShipDate` (PATCH, non-escrow) stored an Invalid Date and returned 500. All now return 400/404.
- `discount-codes.ts` `GET /validate` — client `items` went to lib/discounts unchecked, so `[null]` returned 500 and a non-numeric price gave `appliedAmountCents: NaN`. Lines are now validated. `subtotalCents=Infinity` passed the `isNaN` check; it now uses `isFinite`.
- `discount-codes.ts` `GET /:id/uses` returned the whole redemption ledger with no limit. It now has opt-in paging (max 500); the bare array is unchanged when no params are sent.
- `disputes.ts` — a non-uuid id returned 500; it now returns 404. Evidence `description?.trim()` on a non-string returned 500 and had no length cap; it is now type-checked with a 20k cap.
- `drop-wallet.ts`, `featured-slots.ts` — a non-uuid id returned 500; it now returns 404.
- `email-marketing.ts` GET `/campaigns` — **N+1** (one stats query per campaign, up to 100), replaced by one grouped query. Same response shape.
- `feed-followed-fresh.ts` — tagged products weren't filtered, so deleted, draft or archived products showed as shoppable tags. Its header promises the same rules as `/posts/feed`; it now applies `taggedProductVisibleTo`.

#### Contract
- Mobile `api.ts:2315,2319` `dropWallets.deposit`/`payShipping` call endpoints the server retired with 410. They are dead client methods.
- `POST /api/buyer/email-opt-in` has no caller in mobile, though its header says checkout and Follow use it.

#### Cross-slice (proposed)
- discovery.ts and public.ts `/api/public/products` spread full `products` rows to the public, including internal `planHiddenAt`, `removalKind` and `demandCount`. Map them through `toPublicProduct`.

#### Suspected — not changed
- design-studio GET `/projects` signs URLs for every asset across all projects. Concurrent uploads with the same upload id give a 500 (unique index).
- discount-codes PATCH doesn't ownership-check `productIds` (create does).
- disputes `/accept` on a closed dispute calls Stripe close again, so the seller sees a 502.
- email-marketing-webhook: a signed JSON `null` body returns 500.
- feed `/for-you`: cached posts aren't rechecked for deletion or moderation within the cache TTL.
- `loadClassifiable` loads all active products with no limit.
- drops PATCH `heroImageUrl: null` is ignored (the app's intent is unconfirmed).

#### Judgment calls — not changed
- `/discount-codes/:id/uses` shows guest buyers' emails to the seller (intended per comment).
- Closing a collecting pre-order drop via PATCH status doesn't refund.
- `/config/features` is public and cached 60s.


---
### Slice s05 log
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/routes/finance.ts | 1538 | 1538 | 4 | 4 |
| src/routes/first-run-tips.ts | 85 | 85 | 0 | 0 |
| src/routes/first-week.ts | 147 | 147 | 1 | 1 |
| src/routes/fits.ts | 489 | 489 | 0 | 0 |
| src/routes/follow-requests.ts | 206 | 206 | 1 (comment) | 1 |
| src/routes/freelancer-connect.ts | 187 | 187 | 2 | 2 |
| src/routes/freelancer-jobs.ts | 1190 | 1190 | 0 | 0 |
| src/routes/freelancers.ts | 327 | 327 | 2 | 2 |
| src/routes/fx.ts | 51 | 51 | 0 | 0 |
| src/routes/geo-postal.ts | 31 | 31 | 0 | 0 |
| src/routes/gift-cards.ts | 262 | 262 | 1 | 1 |
| src/routes/giveawayLanding.ts | 84 | 84 | 0 | 0 |
| src/routes/giveaways.ts | 402 | 402 | 2 | 2 |
| src/routes/growth.ts | 604 | 604 | 0 | 0 |
| src/routes/growthPublic.ts | 182 | 182 | 0 | 0 |
| src/routes/guest-checkout.ts | 533 | 533 | 2 | 2 |

#### Fixes
- `finance.ts` GET /summary — **overstated available balance**. /summary subtracted only label reservations, while /balance, /payout-schedule and POST /payout also subtract cash-outs still processing, so the seller saw more money than they could cash out. It now subtracts processing USD cash-outs too. Test: `wave1-s05-finance.test.ts`.
- `finance.ts` /payouts and /transactions — a negative or fractional `limit` and an array `type` went straight to Stripe, which answers 400. Both are now clamped to valid values. The header comment was also corrected.
- `first-week.ts` — **the reward bypassed the Thread Cash earn gate** (kill switch and monthly budget), which earnGate.ts says every reward must pass. It now calls `assertThreadCashEarnAllowed` and `reserveRewardsBudget`. Test: `wave1-s05-first-week.integration.test.ts`.
- `freelancer-connect.ts` POST /onboard — **open redirect**. Client `refreshUrl`/`returnUrl` went to Stripe account links unchecked; they now pass the same allow-list as seller Connect. `accounts.create` had no idempotency key, so a double tap created two Express accounts; one was added. Test: `wave1-s05-misc.integration.test.ts`.
- `freelancers.ts` GET / — **suspended and deleted accounts were listed as hireable**; they are now filtered out. A min/max rate outside int4 returned 500; both are now clamped.
- `gift-cards.ts` — a non-uuid card id returned 500 on confirm, mine and void; it now returns 404.
- `giveaways.ts` PATCH — **dates could be moved into another open giveaway's period**, which POST forbids. PATCH now takes the same advisory lock and overlap check and answers 409. `/rules-template` with an array query returned 500; only strings are used now.
- `guest-checkout.ts` — **money**. The guest discount code was validated and capped against the subtotal *before* bundle savings, while signed-in checkout uses the post-bundle cart. Example: a $25 item with $5 bundle savings and a 20% code gave $5 off instead of $4. It now uses the post-bundle amount. Test: `wave1-s05-guest-checkout-money.integration.test.ts`.
- `guest-checkout.ts` — **money**. A seller with no shipping zones or rates charged guests $0 shipping, so the seller paid the label, while signed-in checkout charges the standard rate (`lib/defaultShipping.ts`, "not free"). Guests now pay the same standard rate. *This is a visible change for guests at such sellers ($0 to $5.99), so Dev should confirm.* An existing test expectation was updated: the platform fee goes from 100 to 130 because shipping is now in the fee basis.
- `follow-requests.ts` — the header comment now notes that its close-friends handlers are shadowed by close-friends.ts.

#### Cross-slice (proposed)
- `lib/threadCash/earnGate.ts` `REWARD_SOURCES` lacks `"first_week"`, so first-week grants aren't counted against the monthly budget.
- The close-friends handlers in follow-requests.ts are dead code.

#### Suspected — not changed
- finance: the hold estimate ignores `platformFeeRefundedCents`. Raw `err.message` is returned in catch blocks. statement.csv descriptions aren't escaped against formula injection.
- freelancer-jobs: success/cancel URLs aren't checked. The /cancel paymentStatus write is unconditional. Hiring a suspended or blocked freelancer is not prevented.
- freelancer-connect: new accounts don't get `applyNewAccountPayoutDelay`.
- growth: the bio links cap is count-then-insert. linkStats counts fully refunded orders.
- growthPublic serves bio pages of suspended sellers.
- gift-cards /mine makes one `storeNameFor` query per seller (max 200).
- first-run-tips `tipId` is unbounded.
- follow-requests approve doesn't check whether the requester is suspended.

#### Judgment calls — not changed
- POST /payout holds its advisory lock across the Stripe call.
- freelancers GET /:id returns inactive profiles.
- Stitch attribution survives deletion of the original.
- Giveaway winners' names are public.
- The live-rate quote uses the pre-bundle subtotal (same as signed-in).

#### Tests note
- bundles.integration (2) and moneyFlows.integration (1) also fail on HEAD.


---
### Slice s06 log
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/routes/hashtags.ts | 411 | 411 | 2 | 2 |
| src/routes/health.ts | 93 | 93 | 0 | 0 |
| src/routes/hidden-words.ts | 48 | 48 | 0 | 0 |
| src/routes/iap-promotions.ts | 166 | 166 | 1 | 1 |
| src/routes/integrations.ts | 116 | 116 | 0 | 0 |
| src/routes/interaction-settings.ts | 116 | 116 | 0 | 0 |
| src/routes/inventory.ts | 147 | 147 | 4 | 4 |
| src/routes/ip-cases.ts | 463 | 463 | 2 | 2 |
| src/routes/ipNoticePage.ts | 144 | 144 | 0 | 0 |
| src/routes/launch-waitlist.ts | 29 | 29 | 0 | 0 |
| src/routes/lifestyle.ts | 149 | 149 | 1 | 1 |
| src/routes/link-preview.ts | 22 | 22 | 0 | 0 |
| src/routes/live-analytics.ts | 194 | 194 | 0 | 0 |
| src/routes/live-auctions.ts | 103 | 103 | 1 | 1 |
| src/routes/live-cohost.ts | 307 | 307 | 2 | 2 |
| src/routes/live-commerce.ts | 251 | 251 | 1 | 1 |
| src/routes/live-moderation.ts | 249 | 249 | 1 | 1 |
| src/routes/live-replays.ts | 201 | 201 | 1 | 1 |
| src/routes/live-shopping.ts | 110 | 110 | 1 | 1 |
| src/routes/live-tips.ts | 52 | 52 | 1 | 1 |
| src/routes/live.ts | 724 | 724 | 2 | 2 |
| src/routes/liveActivities.ts | 138 | 138 | 0 | 0 |
| src/routes/logo.ts | 278 | 278 | 1 | 1 |
| src/routes/loyalty.ts | 449 | 449 | 1 | 1 |
| src/routes/manufacturer-connect.ts | 277 | 277 | 1 | 1 |
| src/routes/manufacturer-flow.ts | 482 | 482 | 1 | 1 |
| src/routes/manufacturer-public.ts | 529 | 529 | 1 | 1 |

#### Fixes
- `manufacturer-flow.ts` POST `/orders/:orderId/updates` — **object-path IDOR**. A manufacturer could put any `/objects/...` path in `imageObjectPaths` and get back a signed download URL for it; the seller then saw that file too. In effect, **anyone's private upload was readable**. Each path must now exist and pass `canAccessObjectEntity` for the caller, otherwise 422 `PHOTO_NOT_OWNED`. Test: `manufacturer-order-cards.integration.test.ts` (extended).
- `lifestyle.ts` — the rate-limit key used `req.auth?.userId`, but `req.auth` is a function in @clerk/express v2, so **all users shared one global bucket** (5 per minute platform-wide). It now uses `clerkUserId`. Test: `wave1-s06-lifestyle-ratelimit.test.ts`.
- `inventory.ts` PATCH `/:variantId/adjust`:
  - a non-uuid id caused a 500; now 404.
  - a missing body caused a 500; now 400.
  - int4 overflow caused a 500; now 400.
  - **variants of soft-deleted products could be adjusted**, which fired back-in-stock alerts for a product buyers can't see. Now 404.
  - Test: `wave1-s06-inventory-adjust.integration.test.ts`.
- Raw `e.message` (Postgres constraint and column names) was returned on 500s across live-auctions, live-cohost, live-moderation, live-commerce, live-replays, live-shopping, live-tips and live. These now log the error and return a generic message. Tests: `wave1-s06-live-error-leaks.test.ts`, `wave1-s06-live-auctions-errors.test.ts`.
- `live-cohost.ts` — a double-tap invite hit the unique index and returned a 500 with the constraint text. It now uses `ON CONFLICT DO NOTHING` and answers 409 "Already invited". Test: `wave1-s06-live-cohost-invite.integration.test.ts`.
- `logo.ts` — any reservation failure, including a DB error, returned 429 ("sample already used") with the raw message. Only the two known codes now map to 409/429; anything else is a generic 503. Test: `wave1-s06-onboarding-sample-errors.integration.test.ts`.
- Malformed input that returned 500, now 400/404:
  - `live.ts` `?since=garbage`
  - `hashtags.ts` tampered cursor
  - `iap-promotions.ts` non-uuid id (verify gave a misleading 502)
  - `ip-cases.ts` non-uuid listing/case ids
  - `manufacturer-public.ts` `?sort=constructor` / `__proto__` (prototype key)
  - `loyalty.ts` `/redeem` and `manufacturer-connect.ts` `/onboard` with no body
- `hashtags.ts` GET `/following` — **N+1**: one count query per followed tag (up to 500). Replaced with one grouped query.

#### Contract
- No breaking mismatches.
- The live-replays blocked-viewer response omits `hasMore`. Harmless.

#### Suspected — not changed
- Count-then-insert soft caps: hashtag follows, scheduled lives, co-hosts. Manufacturer rating recompute can lose a concurrent review.
- The hashtag cursor is truncated to milliseconds.
- manufacturer-public `/:id/reviews` doesn't require a verified manufacturer and has no limit.
- live comments and codes don't check blocks with the host.
- The lifestyle and logo `userHits` maps are never pruned.

#### Judgment calls — not changed
- A suspended seller's live stream is still served by id.
- Guests get subscriber tokens on `/join`.
- live-analytics revenue includes shipping and tax (matches analytics.ts).
- Reinstating a listing leaves the IP case `actioned`.
- GET `/api/inventory` is unpaginated (the app expects a bare array).
- The IP notice form needs 20 chars while the server accepts 10.


---
### Slice s07 log
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/routes/manufacturers.ts | 2023 | 2023 | 4 | 4 |
| src/routes/me-settings.ts | 51 | 51 | 0 | 0 |
| src/routes/meta-ads.ts | 1056 | 1056 | 2 | 2 |
| src/routes/meta-capi-public.ts | 30 | 30 | 0 | 0 |
| src/routes/mockup.ts | 126 | 126 | 1 | 1 |
| src/routes/moderation.ts | 351 | 351 | 0 | 0 |
| src/routes/moderationHeld.ts | 242 | 242 | 1 | 1 |
| src/routes/mystery-boxes.ts | 244 | 244 | 0 | 0 |
| src/routes/notification-events.ts | 74 | 74 | 1 | 1 |
| src/routes/notification-prefs-sms.ts | 141 | 141 | 1 | 1 |
| src/routes/notification-prefs.ts | 332 | 332 | 1 | 1 |
| src/routes/notifications-feed.ts | 672 | 672 | 2 | 2 |
| src/routes/order-add-on.ts | 339 | 339 | 0 | 0 |
| src/routes/order-problems.ts | 195 | 195 | 0 | 0 |

#### Fixes
- `manufacturers.ts` PATCH `/me/products/:id` — `replaceProductTiers` ran outside the product transaction. A failed tier insert left the product with **no price tiers** (old tiers deleted and committed). It now runs on `tx`. Test: `wave1-s07-manufacturers.test.ts`.
- `manufacturers.ts` — tier quantities and prices above int4 returned 500; they now return 400. A non-uuid product/thread/order id returned 500; it now returns 404.
- `manufacturers.ts` `/me/dashboard` — **money**. "Completed value" counted cancelled orders, which were never paid (only `pending_payment` can be cancelled), and the active count included terminal statuses. It now uses the shared `isTerminalStatus` and excludes cancelled and refunded from revenue.
- `meta-ads.ts` — a non-uuid campaign id returned 500; it now returns 404. Draft PATCH accepted unvalidated `budgetCents` (negative, zero, or a string, which 500'd), `budgetType` and `mediaKind`. It now uses the same rules as POST. Test: `wave1-s07-meta-ads.test.ts`.
- `mockup.ts` — the rate-limit key read `req.auth?.userId`, but in @clerk/express 2.x `req.auth` is a function, so **every user shared one global "anon" bucket** of 5/min. It now uses `req.clerkUserId`. Test: `wave1-s07-mockup.test.ts`.
- `moderationHeld.ts` — the keyset cursor compared microsecond `created_at` against a millisecond cursor, so each page repeated the last item of the previous one. The filter now truncates to milliseconds. Test: `wave1-s07-moderation-held.test.ts`.
- `notification-events.ts` — push-only notification ids (e.g. `new-login/<session>`) aren't uuids and 500'd, so **open/tap events for those pushes were never recorded**. The feed is now queried only for uuid ids. Test: `wave1-s07-notifications.test.ts`.
- `notifications-feed.ts` — a non-uuid id on read/unread/delete/actors returned 500; it now returns 404/400. The header comment advertised a nonexistent internal route; corrected.
- `notification-prefs-sms.ts` `/verify` — **brute-force race**. Attempts were read, then compared, then incremented, so parallel guesses all passed the 5-attempt check. Each attempt is now claimed atomically (`UPDATE … WHERE attempts < 5 RETURNING`), and only one confirmation SMS is sent. Test: 20 parallel guesses give exactly 5×400 and 15×410.
- `notification-prefs.ts` — a misplaced comment (it described the order sound but sat on login_alerts) was moved.

#### Cross-slice (proposed)
- `lifestyle.ts:71`, `photography.ts:383` have the same `req.auth?.userId` bug, so all users share one global rate-limit bucket.

#### Contract
- Mobile `metaAds.get` types `insights` at the top level; the server nests it in `campaign`. The caller only reads `campaign`.
- The mobile `updateCampaign` comment says rejected campaigns are editable; the server returns 409.
- `metaAds.disconnect` expects `{ok}`; the server sends 204.

#### Suspected — not changed
- manufacturers: quote-request PATCH 500s on non-string or missing body fields. `/me/payment` is delete-then-insert outside a transaction. Several lists are unbounded, and messages make 1–2 queries each.
- meta-ads GET `/campaigns` runs one insights query per campaign (max 50).
- `publishNotification` computes the unread count twice.
- notification-prefs PUT is a JSON read-modify-write, so concurrent toggles can lose an update.
- order-problems: the evidence prefix check is startsWith only, so `..` passes (GCS object names are literal). The order-id regex accepts all dashes.
- order-add-on calls `effectiveUnitPrice` per variant.
- moderation: re-resolving a resolved report re-applies the action.

#### Judgment calls — not changed
- Manufacturer dashboard "completed value" is gross `priceCents`, not net.
- The mockup temp reference file is always written as `.png`.
- Unauthenticated invite-token resolve returns contactEmail. It is gated by a 48-hex secret token.

#### Tests note
- 7 failures in manufacturer-trust.integration also fail on HEAD manufacturers.ts. They were suspected to come from concurrent middleware edits; re-run.


---
### Slice s08 log
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/routes/orders.ts | 1253 | 1253 | 5 | 5 |
| src/routes/package-presets.ts | 108 | 108 | 3 | 3 |
| src/routes/photography.ts | 573 | 573 | 0 (s07 flagged a rate-limit key; it is an unused variable, no bucket exists) | 0 |
| src/routes/places.ts | 244 | 244 | 1 | 1 |
| src/routes/post-captions.ts | 203 | 203 | 0 | 0 |
| src/routes/post-carousel.ts | 202 | 202 | 1 | 1 |
| src/routes/post-comments.ts | 834 | 834 | 2 | 2 |
| src/routes/post-mentions-labels.ts | 136 | 136 | 0 | 0 |
| src/routes/post-pins.ts | 103 | 103 | 0 | 0 |
| src/routes/post-polls.ts | 176 | 176 | 0 | 0 |
| src/routes/post-slide.ts | 379 | 379 | 1 | 1 |
| src/routes/post-upload.ts | 202 | 202 | 0 | 0 |
| src/routes/post-video.ts | 853 | 853 | 2 | 2 |

#### Fixes
- `orders.ts` — **buyers stopped getting "shipped" notifications**. Merge `e09b6c5a` undid commit `b09eb1cd`. `notifyBuyerOrderShipped` was still imported but never called, so PATCH /status → shipped sent the buyer nothing. The tracking and /ship path sent old copy with no `pushCategory` and the seller's `targetType:"order"`. The seller-cancel notice regressed to the seller target too. A `publishBuyerShipped()` helper restores it on both ship paths: `orderShippedCopy`, `pushCategory:"order"`, `targetType:"buyer_order"`, the thumbnail, and `notifyCustomer:false` still respected. The existing `order-events.integration` "ships the order…" test was failing on HEAD and now passes. Test: `wave1-s08-orders.test.ts`.
- `orders.ts` — a non-uuid `:id` on every order route returned 500; it now returns 404. Six routes had no params validation, and the `orderTrackingBody` schema was defined but never used, so tracking numbers had no length cap. Both are now applied.
- `orders.ts` POST / (manual order) — a non-uuid customer/drop/variant id returned 500; now 404. A line total sum over int4 returned 500; now 400.
- `package-presets.ts` — numeric(6,2) dimensions above 9999.99 returned 500, and dimensions rounding to 0 were stored. Both now 400. A positive weight under 0.5 oz rounded to 0; it is now stored as at least 1. A non-uuid id gets 404. Test: `wave1-s08-package-presets.test.ts`.
- `post-comments.ts` — **each replies page repeated the previous page's last reply**. The cursor is in milliseconds, but created_at has microseconds; fixed with date_trunc. The inline `repliesNextCursor` was null when the trailing replies were block-filtered, even though `hasMoreReplies` was true, so the app never showed "more". The cursor now comes from the pre-filter page. Test: `wave1-s08-comment-replies-cursor.test.ts`.
- `places.ts` — a tampered "recent" cursor id returned 500; it is now ignored.
- `post-carousel.ts`, `post-slide.ts`, `post-video.ts` — a missing source upload returned 500; it now returns 404 `UPLOAD_NOT_FOUND`. Test: `wave1-s08-compose-missing-upload.test.ts`.
- Test-only: `order-tracking-notifications.integration` raced the post-response publish; it now uses `vi.waitFor`.

#### Contract
- `api.photography.generate` sends `mode`, which the server ignores. 'mockup_to_model' would silently run as a photoshoot.

#### Cross-slice / stale tests
- `post-video-contract.test.ts` (fails on HEAD) expects a crop filter, but `lib/mediaQuality.ts composeClipChain` deliberately letterboxes. **Dev needs to pick crop vs letterbox.**
- `post-carousel.integration` (fails on HEAD): its fs mock lacks `existsSync`, and PRIVATE_OBJECT_DIR is unset.

#### Suspected — not changed
- orders tracking: `trackingStatus:"in_transit"` with no tracking number marks guaranteed or held-preorder orders shipped, bypassing the TRACKING_REQUIRED rule that PATCH /status enforces.
- orders tracking: status claims also write on cancelled and refund_pending orders, and can alert the buyer about a cancelled order. The auto-refund guard is check-then-act.
- Cancelling a manual order restocks but doesn't reverse the customer and drop totals.
- post-polls: editing a poll checks the vote count with no lock.
- post-video GET /media `.limit(1)` has no order (a deleted and a live post can share media).
- Millisecond `lt` cursors can skip same-ms rows.
- Replies to held or hidden parent comments are allowed.

#### Judgment calls — not changed
- The staff role can cancel a paid order (full refund) via PATCH /status, while a partial refund needs manager.
- The seller sees the buyer's email.
- The 2000-row default cap on GET /orders.


---
### Slice s09 log
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/routes/posts.ts | 2431 | 2431 | 3 | 3 |
| src/routes/preorder-terms.ts | 92 | 92 | 0 | 0 |
| src/routes/product-bulk.ts | 598 | 598 | 1 | 1 |
| src/routes/product-drafts.ts | 153 | 153 | 0 | 0 |
| src/routes/product-draws.ts | 239 | 239 | 0 | 0 |
| src/routes/product-feed.ts | 107 | 107 | 0 | 0 |
| src/routes/product-import.ts | 488 | 488 | 0 | 0 |
| src/routes/product-launches.ts | 192 | 192 | 0 | 0 |
| src/routes/product-page-details.ts | 105 | 105 | 0 | 0 |
| src/routes/product-pairings.ts | 233 | 233 | 0 | 0 |
| src/routes/product-qa.ts | 239 | 239 | 0 | 0 |
| src/routes/product-seo.ts | 250 | 250 | 0 | 0 |
| src/routes/product-variants.ts | 339 | 339 | 0 | 0 |
| src/routes/product-videos.ts | 282 | 282 | 0 | 0 |

#### Fixes
- `posts.ts` GET /api/posts/feed — `?limit=-5` produced a negative `.limit()` that Drizzle drops, so the feed ran with no LIMIT. Clamped to 1..50. Test: `wave1-s09-posts.test.ts`.
- `posts.ts` PATCH /api/posts/:id — the owner lookup didn't exclude `postStatus='deleted'`, so a soft-deleted post (Mux asset already queued for removal) could be edited or republished. Now 404s. Test: `wave1-s09-posts.test.ts`.
- `posts.ts` PATCH /api/posts/:id — publishing a draft via PATCH skipped `publishingRestriction`, so suspended/deleted accounts could put drafts live (POST /, /schedule and /publish-now all block this). The check now runs on non-live → published/scheduled transitions only. Test: `wave1-s09-posts.test.ts`.
- `product-bulk.ts` POST /duplicate — duplicating a moderation-locked listing created an unlocked draft copy that could be published, bypassing the lock. Now 409 `PRODUCT_MODERATION_LOCKED` (same as /status). Test: `product-bulk.integration.test.ts`.

#### Suspected — not changed
- product-import.ts:461 Etsy OAuth callback reads then deletes the state row, so two concurrent callbacks can both consume it. Proposed fix: `db.delete(...).returning()`.
- product-qa.ts:186 POST /questions/:id/answer has no requireRole, so any team member (viewer/packer) can answer publicly as the store.
- product-variants `ownedProduct` doesn't exclude soft-deleted products. Harmless.
- product-drafts 200-draft cap is count-then-insert, so concurrent creates can go slightly over.
- product-feed.ts:4 comment says the router is "behind teamContext". That's only true via the `tc` mount in index.ts.
- posts.ts DELETE on an @brandthread post by an admin: the media-privatize ownership check fails and the error is swallowed. No leak.
- posts.ts PATCH: sellers can set any `mediaType` string.

#### Judgment calls — not changed
- PATCH draft→published doesn't bump `createdAt` or send @mention notifications (/publish-now and POST / do). This affects feed ordering, so it's a product call.
- product-bulk /duplicate copies pre-order fields but not drop membership or SEO handles. Documented intent.
- product-qa public GET serves Q&A for archived or deleted products.
- Suspended accounts can still edit captions of already-published posts.

#### Contract
No mismatches found.

#### Tests note
3 failures in posts-management.integration.test.ts (video compose/publish) also fail on HEAD posts.ts. Possibly caused by concurrent post-video.ts edits; needs a re-run.


---
### Slice s10 log
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/routes/products.ts | 916 | 916 | 5 (+1 merge-lost feature) | 4 |
| src/routes/profile-cover.ts | 584 | 584 | 1 | 1 |
| src/routes/profile-media.ts | 409 | 409 | 0 | 0 |
| src/routes/profile-music.ts | 63 | 63 | 1 | 1 |
| src/routes/profileLanding.ts | 126 | 126 | 0 | 0 |
| src/routes/promotions.ts | 70 | 70 | 0 | 0 |
| src/routes/public-media.ts | 53 | 53 | 0 | 0 |
| src/routes/public.ts | 2531 | 2531 | 6 | 6 |
| src/routes/push.ts | 135 | 135 | 1 | 1 |
| src/routes/recently-viewed.ts | 102 | 102 | 2 | 2 |
| src/routes/referrals.ts | 256 | 256 | 0 | 0 |
| src/routes/release-test-control.ts | 158 | 158 | 0 | 0 |
| src/routes/remix.ts | 111 | 111 | 0 | 0 |
| src/routes/reports.ts | 237 | 237 | 1 | 1 |
| src/routes/return-labels.ts | 86 | 86 | 0 | 0 |

#### Fixes
- `products.ts` — a non-uuid `:id`/`:variantId` returned 500 on every route; it now returns 404. PATCH variant: the comment says compare-at "must exceed the price", but only `> 0` was checked, so a strike-through "was" price could be at or below the selling price. It is now checked against the effective price. `/import`: a huge price overflowed int and **failed the whole import with a 500**; now only that row fails ("invalid price", $1M bound). The upload error text said 8 MB, but the limit is 20 MB. Test: `wave1-s10-products.test.ts`.
- `public.ts` — `/products/:id/related` and `/high-demand` returned raw variant rows, which include `sku` and `lowStockThreshold`, contradicting the public variant policy in lib/publicProfile.ts. Both now map through `toPublicVariant`. Test: `wave1-s10-public.test.ts`.
- `public.ts` — **hot-path unbounded queries**. `/high-demand` loaded every active product plus variants and order lines on each request; it now filters `demandCount > 0` in SQL (identical results). `/related` loaded the whole active catalogue for every product page; candidates are now ordered and capped at 500 before ranking (identical for catalogues under 500).
- `public.ts` — a non-uuid product id returned 500 on `/:id`, `/related`, `/price-history` and `/videos`. A repeated query key on `/username-check` and `/email-check` also returned 500. All fixed.
- `recently-viewed.ts` — GET showed **soft-deleted listings** (delete keeps `status='active'`); they are now filtered. A non-uuid id returned 500; now 404. Test: `wave1-s10-misc.test.ts`.
- `push.ts`, `reports.ts`, `profile-music.ts` — a non-string token, a non-uuid id or a missing body now gets 400/404 instead of 500.
- `profile-cover.ts` — `void import(...).then(recordRejectedUpload)` had no `.catch`, so a failure became an **unhandled promise rejection** (no handler is registered). Test: `wave1-s10-cover-rejection.test.ts`.

#### Contract — needs Dev's decision
- **`GET /api/products/payout-gate` has no server route**, but `mobile/hooks/useSellerPayoutGate.ts` calls it. The seller payout gate was added in `9b4a8041`. Merge `9419cd86` (pr-1089) then silently dropped it, together with the publish checks on POST/PUT `/api/products` and `/api/product-bulk/status`. It still exists in shopify.ts and in the app. `payout-gate.integration.test.ts` fails 7 of 17. Restoring it would block sellers without Stripe from publishing and break 13 later tests, so it was **not restored**. Patch if wanted: `git show 9b4a8041 -- artifacts/api-server/src/routes/products.ts artifacts/api-server/src/routes/product-bulk.ts`.
- `api.products.import` mobile type drift: the server returns `results[]`, never `errors`.

#### Suspected — not changed
- public `/products*` spread raw product rows (`removalKind`, `planHiddenAt`, `recoverableUntil`, `demandCount`).
- `/sellers/:id` and `/profiles/:username` don't check suspension.
- POST `/search/log` is unauthenticated with no router rate limit, so trending can be inflated.
- public-media redirects to any stored https image URL (open redirect).
- profile-cover `/cover-media/*` runs a leading-wildcard LIKE on users.
- return-labels `refundAmountCents` can still be changed after a label exists.
- reports: the "one open report" check-then-insert can create duplicates.
- products PATCH variant: raising the price leaves a stale compare-at.
- products `status` accepts any string.

#### Judgment calls — not changed
- Search displays whole-dollar prices.
- Push token device handoff takes over the token's other rows (intended).
- release-test-control can overwrite any `buyerId` behind its token.

#### Tests note
- These also fail on HEAD: push-rich-badge timezone (contradicts push-register-timezone), saved-product-alerts (2), posts-management (3), price-history (1), payout-gate (7).


---
### Slice s11 log
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/routes/returns.ts | 667 | 667 | 5 | 5 |
| src/routes/reviews.ts | 465 | 465 | 1 | 1 |
| src/routes/safety.ts | 193 | 193 | 1 | 1 |
| src/routes/sales.ts | 220 | 220 | 1 | 1 |
| src/routes/sample-orders.ts | 1327 | 1327 | 3 | 3 |
| src/routes/saved.ts | 204 | 204 | 1 | 1 |
| src/routes/search-unified.ts | 363 | 363 | 0 | 0 |
| src/routes/seller-affiliate.ts | 277 | 277 | 2 | 2 |
| src/routes/seller-analytics.ts | 404 | 404 | 0 | 0 |
| src/routes/seller-brand-assets.ts | 154 | 154 | 0 | 0 |
| src/routes/seller-emails-public.ts | 44 | 44 | 0 | 0 |
| src/routes/seller-export.ts | 119 | 119 | 2 | 2 |
| src/routes/seller-hub.ts | 485 | 485 | 3 | 3 |
| src/routes/seller-launch-checklist.ts | 217 | 217 | 0 | 0 |
| src/routes/seller-live-map.ts | 290 | 290 | 0 | 0 |
| src/routes/seller-locations.ts | 165 | 165 | 4 | 4 |
| src/routes/seller-messaging-tools.ts | 133 | 133 | 0 | 0 |
| src/routes/seller-metafields.ts | 174 | 174 | 2 | 2 |
| src/routes/seller-milestones.ts | 161 | 161 | 0 | 0 |
| src/routes/seller-morning-brief.ts | 164 | 164 | 0 | 0 |
| src/routes/seller-payment-settings.ts | 64 | 64 | 0 | 0 |
| src/routes/seller-plan-config.ts | 18 | 18 | 0 | 0 |

#### Fixes
- `seller-locations.ts` DELETE of the primary location — `UPDATE … ORDER BY … LIMIT 1` is not valid PostgreSQL, so **deleting the primary location always 500'd**. It now uses a subquery, and promote+delete run in one transaction. POST count/unset-primary/insert now run in a transaction under a per-seller advisory lock, so two creates can't both become primary. Raw `e.message` 500s are gone, a malformed id gets 404, and `updated_at` is now set on PATCH. Test: `wave1-s11-seller-tools.test.ts`.
- `returns.ts` POST — the "one active return per order" check was racy. The check and insert now run in a transaction that locks the order row `FOR UPDATE`. *The test guards against regression; the race did not reproduce locally.*
- `returns.ts` — evidence paths containing `..` passed the prefix check; they are now rejected. The deny, already-refunded and refund-failed responses returned raw private `/objects/...` evidence paths; they now return signed URLs. A malformed orderId 500'd with the raw pg message; it now gets 404. The error text said 8 MB, but the limit is 20 MB; corrected. Test: `wave1-s11-returns.test.ts`.
- `sample-orders.ts` PATCH sample-detail — the comment promised to "retain legacy notes", but a seller decision overwrote free-text notes, losing them, and notes like "42" caused a TypeError. Such notes are now kept as `legacyNotes`. Tracking fields now must be text. A malformed id gets 404.
- `seller-affiliate.ts` — **approval bypass**. A pending application could go paused→active and skip `/approve` (no `approvedAt`). Status changes on pending creators are now refused with 409. A malformed creator id gets 404.
- `safety.ts` DELETE `/muted-words/:phrase` decoded the param twice, so "100%" 500'd and "a%20b" deleted "a b". The second decode is removed.
- `seller-hub.ts`, `seller-metafields.ts`, `seller-export.ts`, `saved.ts`, `reviews.ts`, `sales.ts` — a missing body, a non-string field or a malformed uuid now gets 400/404 instead of 500. seller-export now quotes values containing a bare `\r`. Tests: `wave1-s11-seller-tools`, `wave1-s11-buyer-inputs`, `wave1-s11-sales`.
- Test fixes: `seller-owner-scoping` mock gained `transaction`. `returns-request.integration` had a stale copy assertion that also failed on HEAD.

#### Contract
- Mobile `api.ts:2305` `sampleOrders.advance` sends `{}`, but the server requires carrier/tracking for packing→shipped, so that call fails from packing. It appears unused.
- Mobile `reviews.create` types `orderId` as optional, but the server requires it.

#### Suspected — not changed
- search-unified offset and price filters are unbounded.
- saved GET / and sample-orders GET / have no LIMIT.
- Muted-words and quick-replies caps are count-then-insert.
- seller-locations PATCH `isPrimary:false` can leave the seller with no primary.
- Cancelling an RFQ leaves its child quote requests open.
- sample-orders pay-from-wallet requires `charges_enabled`, while card checkout uses `connectReadiness`.
- seller-analytics `/payouts` sums only the last 100 payouts.
- Optional extra safeguard: a partial unique index for one active return per order.

#### Judgment calls — not changed
- search-unified shows whole-dollar prices ($19.99 displays as "$20").
- A manufacturer can advance a sample order to delivered.
- Team members' `/reviews/mine` acts as themselves.
- reviews.ts runs ALTER at import time.
- sample-orders GET /:id returns Stripe ids to both parties.

#### Tests note
- b2bMoney "refunds a wallet-paid bulk order" (also fails on HEAD), 2 assertions in saved-product-alerts, and the manufacturer-order-cards forged-paths test (likely concurrent edits). Re-run at the end.


---
### Slice s12 log
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/routes/seller-profile.ts | 704 | 704 | 1 | 1 |
| src/routes/seller-push-broadcasts.ts | 196 | 196 | 0 | 0 |
| src/routes/seller-referrals.ts | 56 | 56 | 0 | 0 |
| src/routes/seller-settings-route.ts | 160 | 160 | 0 | 0 |
| src/routes/seller-terminal.ts | 413 | 413 | 0 | 0 |
| src/routes/seller-verification.ts | 189 | 189 | 0 | 0 |
| src/routes/sellerAnalyticsBuilders.ts | 444 | 444 | 0 | 0 |
| src/routes/seo-public.ts | 352 | 352 | 0 | 0 |
| src/routes/share-preview.ts | 245 | 245 | 0 | 0 |
| src/routes/shipping-labels.ts | 552 | 552 | 1 | 1 |
| src/routes/shipping-rates.ts | 244 | 244 | 2 | 2 |
| src/routes/shipping-zones.ts | 354 | 354 | 1 | 1 |
| src/routes/shopify-import.ts | 297 | 297 | 2 | 2 |
| src/routes/shopify-oauth-callback.ts | 110 | 110 | 0 | 0 |
| src/routes/shopify.ts | 228 | 228 | 0 | 0 |
| src/routes/sitemap.ts | 86 | 86 | 1 | 1 |
| src/routes/size-chart-templates.ts | 196 | 196 | 0 | 0 |
| src/routes/social-contacts.ts | 132 | 132 | 0 | 0 |

#### Fixes
- `shipping-labels.ts` — order and label ids are now checked as uuids (via `router.param`), so a malformed id returns 404. Before, it hit Postgres and returned 500/502. Test: `wave1-s12-shipping.test.ts`.
- `shipping-rates.ts` PATCH `/:id` — `{}` built an empty SET and returned 500, and `{name:null}` broke the NOT NULL rule on `name` and returned 500. The update now always sets `updatedAt` (which also fixes `updatedAt` never being refreshed) and ignores a null `name`. Test: same file.
- `shipping-zones.ts` PUT `/:id/weight-tiers` — the delete and re-insert ran outside a transaction, so concurrent saves stacked their tiers and a failed insert left the zone with none. Both now run in one transaction with `SELECT … FOR UPDATE` on the zone row. Test: same file.
- `shopify-import.ts` — if the AI returned JSON that is not an object (e.g. `null`), the whole import crashed; it now falls back to the stock copy. A non-uuid `:id` returned 500; it now returns 404 `IMPORT_NOT_FOUND`. Test: `wave1-s12-shopify-import.test.ts`.
- `sitemap.ts` — the live sitemap listed `product_seo.no_index` products and scheduled products before launch. It now applies the same filters as seo-public. Test: `wave1-s12-sitemap-seller-profile.test.ts`.
- `seller-profile.ts` PUT `/profile/store-layout` — answered 200 with an empty body when the caller has no users row; now 404, like every other route in the file. Test: same file.

#### Suspected — not changed
- seller-terminal `/catalog` makes one effectiveUnitPrice query per variant (up to 500) while a sale is live. Proposed fix: call `applySalesToVariants` once.
- seo-public GET `/seo/products/:id` doesn't filter out unlaunched products. It may be meant as a teaser page.
- share-preview: the product card doesn't check launch time and shows the raw minimum price, not the sale price. The store and live cards don't check `deletionRequestedAt`, and the live card doesn't check `deletedAt`.
- social-contacts opt-in accepts any client-supplied `phoneHash`, so a user can register someone else's phone hash and be "found" by that person's contacts.
- seller-settings-route 500s return raw DB error text. Integration `:key` and `settings` have no whitelist or size limit (own rows only).
- shipping-rates `/calculate` picks an arbitrary active rate (`limit 1`, no ORDER BY).
- shipping-zones PATCH doesn't re-validate `zoneType` changes against the existing pricing and countries.
- seller-profile revenue `::int` sum overflows above about $21M. Brand-name uniqueness is only pre-checked, with no unique index.
- shopify-oauth-callback state is select-then-delete, not consumed atomically (Shopify codes are single-use).

#### Judgment calls — not changed
- Profit analytics: `netRevenueCents` doesn't subtract tax, but the daily `netCents` does. Shipping collected counts in gross and is never deducted. An existing test locks this in.
- Each Shopify import batch overwrites the whole storefront (theme, sections, seo, branding).
- POST `/onboarding/data` clears `seller_goals` and `buyer_style_interests` when those fields are left out.
- Contact matching returns only buyer accounts.
- POST `/profile/banner/upload` has no `acceptUploadSession` (legacy path).

#### Contract
No breaking mismatches. `api.seller.saveOnboardingData` is defined but never called.

#### Tests note
Failures in growth-previews, shipping-free-threshold, shipping-label-ship-from and shopify-import.integration also happen with every s12 change reverted (network access, plan limit, old response shape).


---
### Slice s13 log
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/routes/social.ts | 2241 | 2241 | 6 | 6 |
| src/routes/store-address.ts | 94 | 94 | 0 | 0 |
| src/routes/store-ai.ts | 334 | 334 | 2 | 2 |
| src/routes/store-trust.ts | 31 | 31 | 0 | 0 |
| src/routes/store.ts | 1551 | 1551 | 4 | 4 |
| src/routes/storeBlocks.ts | 298 | 298 | 0 | 0 |
| src/routes/storeSite.ts | 334 | 334 | 0 | 0 |
| src/routes/story-highlights.ts | 353 | 353 | 2 | 2 |
| src/routes/story-mentions.ts | 409 | 409 | 3 | 3 |
| src/routes/story-stickers.ts | 216 | 216 | 0 | 0 |
| src/routes/subscription-retention.ts | 107 | 107 | 0 | 0 |

Systemic note: drizzle silently **drops** a negative `.limit()`. `?limit=-5` doesn't 500; it removes the LIMIT and the query becomes unbounded.

#### Fixes (test: `wave1-s13-social-store.test.ts`, 16 cases, all fail on HEAD)
- `store.ts` — **stored XSS on the public store page**. `social_links` URLs went into `href` with attribute escaping only, so `javascript:` (and `java\tscript:`) links ran. Added `safeLinkHref`, which allows only http(s), mailto and scheme-less links.
- `store.ts` — a null or non-object entry in sections/faqs/reviews/socialLinks returned 500 on the public page. These lists are now filtered to plain objects.
- `store.ts` — **tracking opt-out ignored**. `/by-username` and `/host-site` ignored Sec-GPC/DNT and still injected the Meta/TikTok pixels. They now pass `optOutTracking` and send `Vary`, matching `/site/:slug`.
- `store.ts` — removed a dead, unreachable second `GET /public/:slug`. It returned the raw storefront row, including `storePasswordHash` and `sharePreviewTokenHash`, under a comment saying "no auth".
- `store-ai.ts` — vision routes returned `String(err)` to the client, leaking provider and DB error text. They now return a generic `ai_failed`. A non-string base64 input returned 500; it now gets 400.
- `story-highlights.ts` — **private account content leak**. Highlights of private accounts were served to non-followers. Added the `viewerCanSeeContent` gate. A negative limit made the query unbounded; it is now clamped.
- `story-mentions.ts` — **media-screening bypass**. Stories held by screening were exposed via `/stories/:id`, `/mention-reply` and `/reply`. They are now visible to the author only.
- `story-mentions.ts` POST `/stories/:id/reply` — the stored `friends` reply permission and the account default were never enforced, and non-members could reply to Close Friends stories. It now runs `storyReplyDenial`, `storyHiddenFrom` and `viewerMayOpenAudience`, like the other routes. mention-search had the negative-limit and array-`q` bugs; both fixed.
- `social.ts` — a non-uuid post or story id returned 500; it now returns 404. `/search` and `/suggested` had the negative-limit and array-`q` bugs; fixed. `/suggested` mutual candidates included suspended and deleted accounts; they are now filtered. POST `/stories` stored any `replyPermission` value; it is now limited to everyone/friends/off.

#### Contract
- No mismatches. PATCH and PUT `/api/store/slug` both exist and both are used (duplication, not a bug).

#### Suspected — not changed
- storeBlocks: a concurrent add returns 500 on the unique index (should be 409).
- The highlights cap is count-then-insert.
- subscription-retention `/resume` always clears vacationMode, even if the seller turned it on separately.
- store-ai `/generate` doesn't type-check the AI JSON before writing it.
- A tagged user can open a friends-only story (the comment says this is intended).
- social follower remove/dismiss don't resolve the users.id alias.

#### Judgment calls — not changed
- `/preview/:token` can create a storefront row for the token's owner.
- `/friends/activity` loads every mutual id with no cap.
- An empty mention-search lists arbitrary users.
- Store `sections` stay free-form.

#### Tests note
- These also fail on HEAD: social-follow-e2e alias test, store-share-preview (SESSION_SECRET unset), social-messaging-e2e realtime. social-follower-management times out at 5s under load.


---
### Slice s14 log
| file | lines (wc) | lines read | defects found | defects fixed |
|---|---|---|---|---|
| src/routes/subscription.ts | 713 | 713 | 0 | 0 |
| src/routes/support-chat.ts | 366 | 366 | 3 | 3 |
| src/routes/support.ts | 215 | 215 | 0 | 0 |
| src/routes/taste-quiz.ts | 147 | 147 | 0 | 0 |
| src/routes/taxes.ts | 343 | 343 | 2 | 2 |
| src/routes/team.ts | 893 | 893 | 1 | 1 |
| src/routes/techpack.ts | 358 | 358 | 0 | 0 |
| src/routes/thread-cash-weekly-quests.ts | 54 | 54 | 0 | 0 |
| src/routes/thread-cash.ts | 739 | 739 | 0 | 0 |
| src/routes/translate.ts | 38 | 38 | 0 | 0 |
| src/routes/upload-sessions.ts | 12 | 12 | 0 | 0 |
| src/routes/user-settings.ts | 91 | 91 | 0 | 0 |
| src/routes/vacation.ts | 82 | 82 | 1 | 1 |
| src/routes/waitlist.ts | 188 | 188 | 3 | 3 |
| src/routes/walletPasses.ts | 95 | 95 | 0 | 0 |
| src/routes/web-annual-plans.ts | 22 | 22 | 0 | 0 |
| src/routes/webhooks-mux.ts | 58 | 58 | 0 | 0 |
| src/routes/webhooks-shippo.ts | 232 | 232 | 0 | 0 |
| src/routes/webhooks-shopify.ts | 199 | 199 | 1 | 1 |
| src/routes/webhooks-twilio.ts | 63 | 63 | 0 | 0 |
| src/routes/webhooks.ts | 2795 | 2795 | 2 | 2 |
| src/routes/wellKnown.ts | 118 | 118 | 0 | 0 |
| src/routes/widgetSummary.ts | 96 | 96 | 0 | 0 |
| src/routes/wrapped.ts | 26 | 26 | 0 | 0 |

Webhook signatures were verified on every provider:
- Stripe: `constructEvent` over the raw body, with a Connect-secret fallback and a livemode check.
- RevenueCat: constant-time header compare, fails closed.
- Shopify, Mux, Twilio: HMAC compared in constant time; Mux also checks a timestamp tolerance.
- Shippo: shared secret, constant-time, fails closed.

Duplicate deliveries are handled with a claim/lease ledger for Stripe and dedupe tables for RevenueCat, Shopify and Shippo. No signature defects were found.

#### Fixes
- `webhooks.ts` handleSubscriptionUpdated — **a dead plan was re-granted**. A late or out-of-order `customer.subscription.created/updated` for a subscription already stored as canceled re-granted it. A terminal event for a replaced subscription also pointed `users.subscription_id` back at the dead one. Both cases are now ignored. Test: `wave1-s14-subscription-webhooks.test.ts`.
- `webhooks.ts` handleSubscriptionDeleted — **deleting any subscription on the customer** (including a replaced or duplicate one) dropped the seller to canceled/starter while their current subscription was live. Now only the stored current subscription can end the plan, the same rule `handleInvoicePaymentFailed` already uses.
- `webhooks-shopify.ts` — a Shopify fulfillment set `shipped` and asked for a held-funds release on cancelled, refund_pending and delivered orders. Updates are now limited to the same states `PATCH /orders/:id/tracking` allows. Test: `wave1-s14-shopify-fulfillment.test.ts`.
- `support-chat.ts` — the query selected the nonexistent `products.priceCents`, so **every user's AI support context** fell back to "Could not load account data". The drop-wallet SQL used the nonexistent `dw.held_cents` and `d.title`, so every seller got "No drop wallets yet". The "available" figure was really the total collected. All now use real columns, and available is computed with the same formula as drop-wallet.ts. Test: `wave1-s14-support-chat-context.test.ts`.
- `taxes.ts` `/calculate` — **tax math inconsistency**. It read legacy switches that default to false, so sellers who never opened the tax screen got $0 tax, while `/status` and checkout treat tax as on. It now uses `effectiveTaxSwitches`. A first-visit config race could 500; fixed with onConflictDoNothing plus a re-read. Test: `wave1-s14-input-validation.test.ts`.
- `waitlist.ts` — three defects:
  - a non-uuid id returned 500;
  - a variant from another product was accepted, so the buyer landed on the wrong waitlist;
  - **product-level joins created duplicate rows**, because NULL variants are distinct in the unique key. The route now checks for an existing row first.
- `vacation.ts` — an invalid `vacationUntil` returned 500; now 400. `team.ts` `/activity` — a fractional or huge limit/offset returned 500; now truncated and capped.

#### Contract
- **Mobile `billing.tsx:212` handles only `NATIVE_SUBSCRIPTION`, but `subscription.ts:583` sends `MANAGE_IN_STORE`.** App Store and Play sellers see a generic error on cancel/resume. Existing tests disagree with each other (subscription-cancel expects NATIVE_SUBSCRIPTION, seller-trial-lifecycle expects MANAGE_IN_STORE). Dev needs to pick one code.
- The `syncNative` response type in api.ts is wrong. The caller ignores the result.

#### Cross-slice (proposed)
- Make the `waitlist_entries` unique index `NULLS NOT DISTINCT`. That closes the race the route-level check leaves open.

#### Suspected — not changed
- webhooks.ts oversold path: a failed automatic refund is swallowed and acked, so it is never retried and the order stays in refund_pending.
- webhooks.ts: `handleDisputeCreated`, `handleDisputeUpdated` and `handleDisputeClosed` are dead code.
- subscription `/checkout` and ensureCustomer have no lock, so a double first checkout can create two customers or two subscriptions. `/status` returns 500 permanently if the stored subscription was deleted in Stripe (the code checks `status`, but Stripe errors carry `statusCode`).
- webhooks-shopify: lookups don't check that the order link belongs to the shop-domain header, and that header isn't covered by the HMAC.
- thread-cash accepts `1e300` as an integer amount.
- `taxCalculationMode` accepts any value.

#### Judgment calls — not changed
- Team invites can be accepted by anyone holding the link. `/members` shows member emails to every team role.
- `/taxes/1099` is readable by any team member.
- The Shippo and Shopify webhooks claim the dedupe row before processing and ack 200 on failure. The comments say this is deliberate, with the hourly poll/sweep as backstop.

#### Tests note
- subscription-cancel ("App Store plans", the code mismatch above) and seller-trial-lifecycle (2 cases: `metadata` is now also sent in the update params) also fail on HEAD.
