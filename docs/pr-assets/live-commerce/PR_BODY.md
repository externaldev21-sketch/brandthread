# Live 1/2: flash-deal timers, real "just bought" ticker, 7-day shoppable replays, co-host bag, gift platform cut

## Summary

F6 items 91, 92, 95, 96, 97, 98 (93 was already built and is untouched). Everything extends what exists — the live pager (`app/live.tsx`), the Agora viewer (`app/buyer-live.tsx`), the host screen (`app/seller-live.tsx`), live codes, scheduled lives, replays, co-hosts and Thread Cash live gifts were already there. Nothing was rebuilt.

| # | Item | What already existed | What this PR adds |
|---|------|----------------------|-------------------|
| 91 | Scheduled lives + Remind me | Scheduled lives + remind/unremind API, `LiveEmptyState` with "Remind me", wired in `live.tsx` | `live-feed.tsx` (the Threads-header LIVE viewer) passed `upcoming={[]}` and a no-op `onRemind`; it now loads the real upcoming list through the same live provider and toggles reminders (optimistic, reverts on failure). |
| 92 | Live-only flash deals | Live-only codes (`discount_codes.live_stream_id`, `expires_at`), host `LiveCodesHostSheet`, bag-sheet codes, `liveCode` socket event, validation already rejecting after `expires_at` | Host picks a **Timer** (No timer / 5 / 10 / 15 min). The server sets `expires_at` from `durationMinutes` (never the client clock; other values → 400; only for live codes). Buyers see a red `m:ss` countdown on the code in the bag sheet, ticking; expired deals drop out of the list. The host's code list shows the countdown / "Ended". |
| 95 | Shoppable replays for 7 days | Replay list/player, owner hide/delete, `lib/liveReplayAccess.ts` | Replays expire 7 days after the live ended: enforced server-side in `canViewReplay` and in the by-seller SQL. Owners still see their own, marked **Expired** (grid + player). The replay API returns the live's products (host tags + co-host products, current name/price/image, active only), empty once expired. The player shows **Shop the replay**; tapping a piece opens the app's existing Shop sheet → cart → checkout. |
| 96 | "X just bought" ticker | `ChatRow` already rendered `kind: 'purchase'`, but only preview data produced it | A paid order that came from a live is announced to the live: `live_stream_orders` links the checkout to the live when checkout is created (only if the group's seller is the host or an on-stage co-host), and the order-paid webhook stamps it once and broadcasts `purchase` `{name, text}` (first name or @handle + product title only). `buyer-live.tsx` / `seller-live.tsx` render it from the socket; `live.tsx` (polls) reads `GET /api/live/:id/activity`. |
| 97 | Co-host bag | Co-host invites/stage | An on-stage co-host adds their own products (`PUT /api/live/:id/cohost/products`, a **Products** button on the co-host stage). `GET /api/live/:id/bag` merges host tags + co-host products, each with its seller; the bag sheet shows the co-host's name under their pieces. Orders are attributed per product's seller (as checkout already does); a host live code is not carried to a co-host's store. Co-host products drop out when the co-host leaves the stage. |
| 98 | Thread Cash live gifts with a Brandthread cut | `POST /api/thread-cash/live-gift` → `sendLiveGift` (seller credited 100%), `live_tips` flag, host tips total, gift button in `live.tsx` | `LIVE_GIFT_PLATFORM_FEE_BPS` (default 3000 = 30%, clamped 0..9000). The seller is credited gift − fee; the fee is recorded per gift in `live_gift_platform_fees` (Thread Cash is not part of the double-entry money ledger — see `lib/money/ledger.ts` `thread_cash_*` notes — so there is no house account to post to). The receive cap counts the gross gift. The host tips total is now the seller's net. A gift button in `buyer-live.tsx` opens the existing `LiveThreadCashSheet` (only when `live_tips` is on), and a `gift` socket event shows "<name> sent $5 Thread Cash" in host and viewer chat (and in `live.tsx` via the activity poll). |

## Reference

**Whatnot** (iOS) for the whole live-shopping flow.

| Flow | Mobbin | Reference | Ours |
|------|--------|-----------|------|
| Flash-deal timer (red countdown next to the price) | https://mobbin.com/screens/ea0f904a-ea06-400e-b28b-a540354d0de7 | ![](reference/whatnot-auction-card.jpg) | ![](ours/02-live-bag-flash-deal-cohost.png) |
| Purchase announced in the live | https://mobbin.com/flows/65231f5b-7ce4-4fbf-855b-4108d502815d | ![](reference/whatnot-first-purchase.jpg) | ![](ours/01-live-chat-gift-and-just-bought.png) |
| Tip shown in chat | https://mobbin.com/flows/83fc938c-f3cb-4372-973c-cfdeeb8e867c | ![](reference/whatnot-tipped-in-chat.jpg) | ![](ours/01-live-chat-gift-and-just-bought.png) |
| Replay + shop | (Whatnot replays aren't on Mobbin; the product row reuses the bag-sheet row pattern above) | — | ![](ours/05-replay-shop-the-replay.png) |
| Owner replays, expired | — | — | ![](ours/06-owner-replays-expired.png) |

Whatnot's chat rows are reskinned to the existing `ChatRow` pill (black/white; Whatnot's yellow/green dropped). Whatnot's "the host will receive 100% of this tip" copy is not used (we keep a cut, per item 98).

## What's new

### Server
- `lib/db/src/schema/liveShopping.ts` + `lib/db/migrations/300_f6_live-commerce.sql`: `live_stream_orders`, `live_cohost_products`, `live_gift_platform_fees`.
- `lib/liveShopping.ts` (pure, unit-tested): flash-deal durations/expiry, gift fee bps + split, public buyer name, ticker text.
- `lib/liveBag.ts`: live bag (host tags + on-stage co-host products), product cards, "is this seller selling in this live".
- `lib/livePurchases.ts`: link checkout → live, announce once on paid, activity list for polling clients.
- `routes/live-shopping.ts` (mounted at `/api/live` next to live-commerce): `GET /:id/bag`, `PUT /:id/cohost/products`, `GET /:id/activity?since=`.
- `routes/discount-codes.ts`: `durationMinutes` for live codes.
- `routes/checkout-intent.ts`, `routes/buyer.ts`: record the live link after the checkout rows are created (best effort; additive).
- `routes/webhooks.ts`: after a paid order is created, `announceLivePurchase` (never throws).
- `lib/threadCash/wallet.ts` `sendLiveGift`: fee split + fee row, returns gross/fee/net, receive cap on gross. `routes/thread-cash.ts`: `gift` broadcast, notification amount = net.
- `lib/liveReplayAccess.ts` + `routes/live-replays.ts`: 7-day window, `expired`/`expiresAt`, `products`.

### Mobile
- `services/liveShoppingService.ts` (bag, co-host products, activity).
- `lib/live/flashDeal.ts` (pure, tested) + `lib/live/useNowTick.ts`.
- `components/live/ReplayProductsRow.tsx`, `components/live/CohostProductsSheet.tsx`.
- `lib/live/apiLiveProvider.ts`: polls activity alongside chat → purchase/gift chat rows.
- `lib/live/useLiveSocket.ts`: `purchase`, `gift`, `bag` event types.
- `lib/checkoutPayment.ts`: the live stream id now rides along for a matching live even without a code (so the paid order can be attributed). No checkout UI change.
- Demo preview only (`&demo=1`): a running flash deal, a co-host piece in the bag and a scripted gift line.

## Touches existing UI

| File | Change |
|------|--------|
| `app/live-feed.tsx` | `LiveEmptyState` now gets the real upcoming list + reminder toggle (was `[]` / no-op). |
| `components/live/LiveCodesHostSheet.tsx` | New "Timer" chip row under "Limit"; countdown / "Ended" on timed codes in the list. |
| `components/live/LiveProductsSheet.tsx` | Red clock + `m:ss` on timed codes; expired codes hidden; co-host name line under a co-host's product. |
| `components/live/LiveOverlays.tsx` | `ChatRow` renders `kind: 'gift'` with the existing purchase pill. |
| `app/live.tsx` | Bag sheet uses the merged bag; gift no longer double-posts a chat line on real lives (server announces it); co-host product checkout context uses that product's seller. |
| `app/buyer-live.tsx` | Gift icon in the top-right row (only with `live_tips` on) opening `LiveThreadCashSheet`; purchase/gift rows in chat (small bag/gift icon before the name); co-host products appended to the product strip; `liveStreamId` passed to the in-stream checkout. |
| `app/seller-live.tsx` | Purchase/gift rows appended to the host chat (5 lines in the socket handler). |
| `components/live/CohostStage.tsx` | "Products" button next to "Leave". |
| `app/live-replay.tsx` | "Shop the replay" row under the title; "Expired" in the meta line for owners. |
| `app/live-replays.tsx` | "Expired" label on an owner's expired tile. |

## Feature flags / env keys

- `LIVE_GIFT_PLATFORM_FEE_BPS` (api-server env, optional): Brandthread's cut of live gifts in basis points. Default `3000` (30%), clamped to `0..9000`. No sign-up needed.
- Gifts stay behind the existing `live_tips` flag (seeded OFF); nothing new is turned on.

## Tests

API (`cd artifacts/api-server && TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/bt_test_live_commerce pnpm exec vitest run …`):

- `src/lib/__tests__/liveShopping.test.ts` — flash-deal durations/expiry, gift fee bps parsing + clamp, fee split (fee + net = gift, rounding), first-name/handle privacy, ticker text. **pass**
- `src/lib/__tests__/liveReplayAccess.test.ts` — existing rules (clock pinned so they don't depend on today's date) + 7-day expiry, owner-only expired view. **pass**
- `src/routes/__tests__/live-shopping.integration.test.ts` (10) — flash deal: server-set `expires_at`, `liveCode` broadcast carries it, validation passes before / rejects `EXPIRED` after, bad durations 400; co-host bag: only an on-stage co-host, only own active products, merge order + seller per product, products drop when the co-host leaves; ticker: checkout linked only when the seller is in the live, announced once with first name only (no surname in the payload), activity endpoint returns purchase + gift rows; replays: products returned within 7 days, 404 + hidden from list for buyers after, owner sees `expired: true` and no products. **10/10 pass**
- `src/routes/__tests__/thread-cash-live-gift.integration.test.ts` (12) — existing cases updated for the 30% default cut, plus: seller credited net + fee row recorded (999¢ → 299¢ fee / 700¢ net), 0 bps credits in full, receive cap counts gross gifts. Two existing cases were already failing on `dev` and are fixed here: the debit lookup now filters by source (it picked up the grant row), and the receive-cap case reaches the cap from several buyers (the per-buyer send cap, 2000¢, is lower than the receive cap, 5000¢). **12/12 pass**
- Neighbours re-run (checkout/money/gift cards/thread cash/live block checks/team permission): 188 pass, 6 fail — all 6 fail identically without this PR's code paths involved (order status `processing` vs `pending` expectations, `moneyFlows` 500s, `cashOut` cleanup deleting immutable ledger rows).
- `pnpm exec tsc -p tsconfig.json --noEmit` (after `pnpm exec tsc --build` for libs): **0 errors**.

Mobile (`cd artifacts/mobile`):

- `pnpm exec vitest run tests/live-flash-deal.test.ts tests/live-commerce.test.ts tests/live-pager-logic.test.ts tests/live-provider.test.ts tests/live-tips-flag.test.ts tests/live-moderation-cohost.test.ts tests/live-row-enter.test.tsx` — **all pass** (`live-commerce.test.ts` updated: the stream id now rides along without a code).
- `tests/live-feed-wiring.structure.test.ts` — 2 failures that pre-exist on `dev` (stale `<LiveViewerStack` / Messages `LiveHostRing` string assertions).
- Full suite diffed against `origin/dev` (per coordinator): `origin/dev` 88 failed / 4811 passed; this branch 87 failed / 4817 passed; **no new FAIL entries** (`comm -13` of the sorted FAIL lists is empty).
- `pnpm exec tsc -p tsconfig.json --noEmit`: **0 errors**.

Screenshots: `node scripts/f6-live-commerce-screenshots.mjs [--skip-build]` → `docs/pr-assets/live-commerce/ours/` (390×844).

## Suggestions for Dev

- **Upcoming lives row on the seller profile** — the endpoint already supports `?sellerId=`; the profile screens are owned by another session, so not touched here.
- The replay's linked **video post** (created by `lib/liveReplay.ts`) stays in the profile video grid after the 7-day window; only the replay player/list expire. Decide whether the post should also be archived at day 7.
- `buyer-live.tsx` and `seller-live.tsx` are native-only on web, so the host Timer chips, the buyer-live gift button and socket rows are not in the screenshots; they were checked by type-check and code review only.
- The live checkout context still holds one seller at a time (`lib/live/liveCheckoutContext.ts`); a cart mixing host and co-host items attributes only the last one tapped to the live.
- Gift receive cap now counts gross gifts; the existing "cash out" path pays out the net credit only (unchanged code).
- Pre-existing failing tests seen while running neighbours (unrelated to this PR): `loyalty-awards`, `stock-reservation-concurrency` (expect order status `pending`, get `processing`), `moneyFlows` (2 × 500s), `cashOut` (ledger delete forbidden in cleanup), mobile `live-feed-wiring.structure` (2 stale string assertions).
