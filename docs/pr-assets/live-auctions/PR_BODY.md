# Live 2/2: auctions for 1-of-1s (Whatnot-style), behind live_auctions flag

## Summary

F6 item 94. The host starts a short auction on a 1-of-1 piece in their live; viewers bid from a bottom card ("Bid: $X" on a fixed ladder, or **Custom**); a bid in the last 10 s puts the clock back to 10 s (unless the host chose **Sudden death**); at zero the leader wins and gets **Pay**, which opens the existing in-stream checkout at the winning price. Everything is behind the new `live_auctions` flag, **OFF** by default (client `DEFAULT_FLAGS` and seeded OFF in the migration); with it off no auction UI renders and every auction route answers `403 LIVE_AUCTIONS_DISABLED`.

Built fresh from `origin/dev`, independent of "Live 1/2". It reuses what exists: the live socket room (`ws/liveHub.ts`), live block/ban checks, the live pager and Agora viewer, the hosted in-stream checkout in `buyer-live.tsx`, the one-page checkout pricing (`priceCartGroup`) and the order-paid webhook.

## Reference

**Whatnot** (iOS), copied 1:1 and reskinned black/white (Whatnot's yellow → white; the countdown keeps LIVE red).

| Step | Mobbin | Reference | Ours |
|------|--------|-----------|------|
| Auction card: "<name> is winning!", piece + price, red 00:06 clock, **Custom** + **Bid: $X »** | https://mobbin.com/screens/ea0f904a-ea06-400e-b28b-a540354d0de7 (flow https://mobbin.com/flows/2b73e172-d918-48ac-9952-d95537a0bde8) | ![](reference/whatnot-auction-card.jpg) | ![](ours/01-auction-card-someone-winning.png) |
| Custom bid sheet: piece + price, red clock, − $N +, submit | https://mobbin.com/flows/42ef8d35-9caa-42e5-b1b1-f2bfb134ba18 | ![](reference/whatnot-custom-bid.jpg) | ![](ours/02-custom-bid-sheet.png) |
| "You're winning!" | https://mobbin.com/screens/d60e99ed-cf3e-468e-bab5-5f1da92e3450 | ![](reference/whatnot-you-are-winning.jpg) | ![](ours/03-you-are-winning-anti-snipe.png) |
| "<name> won!" + Sold | https://mobbin.com/flows/65231f5b-7ce4-4fbf-855b-4108d502815d | ![](reference/whatnot-auction-won.jpg) | ![](ours/04-you-won-pay.png) |

Deliberate differences: Whatnot's auto "Max bid" toggle in the custom sheet is not built (see Suggestions); Whatnot charges the card on file at the end, we show **Pay** because Brandthread has no stored-card auto-charge for live orders.

## What's new

### Server
- `lib/db/src/schema/liveAuctions.ts` + `lib/db/migrations/300_f6_live-auctions.sql`: `live_auctions` (one open auction per live via a partial unique index), `live_auction_bids`, `live_auction_checkouts` (checkout ↔ auction link), and the `live_auctions` flag seeded OFF.
- `lib/liveAuctionRules.ts` (pure, unit-tested): durations 10/15/30/60 s, increment ladder ($1 under $20, $2 under $100, $5 under $500, $10 under $1,000, then $25), bid validation (closed / self-bid / already leading / too low / invalid), anti-snipe (10 s), sudden death, 1-of-1 check (exactly one unit across all variants), settle outcome, 24 h pay window, display name (@handle or first name).
- `lib/liveAuctions.ts`: start (host's own active 1-of-1, live stream, not already auctioned), bid (block either way + live ban checked first, then `SELECT … FOR UPDATE` on the auction row, rules re-checked under the lock, anti-snipe, bid row), cancel (before the first bid), settle (row-locked; job + settle-on-read on every GET/bid), `activeAuctionFor` (open → just ended (20 s) → your unpaid win), socket events `auction_started` / `auction_bid` / `auction_ended`.
- Checkout: `resolveAuctionLinePrice()` is the only source of an auction price — a line with `auctionId` is charged the winning price only for the winner, that product/variant, quantity 1, unpaid, inside the pay window; any other purchase of a piece that's in an open auction or held for its winner is refused (`AUCTION_HOLD`). Hooked into `routes/buyer.ts` (hosted in-stream session + cart validate) and `lib/money/cartCheckout.ts` `priceCartGroup` (one-page checkout; `auctionId` added to its item schema). The checkout is linked in `live_auction_checkouts`; the order-paid webhook stamps `winner_order_id`.
- `routes/live-auctions.ts` mounted at `/api/live` (next to the co-host router): `POST /:id/auctions`, `GET /:id/auctions/active`, `POST /:id/auctions/:auctionId/bid`, `POST /:id/auctions/:auctionId/cancel`.
- `jobs/liveAuctionSettle.ts` (1 s), started in `index.ts`.

### Mobile
- `services/liveAuctionsService.ts`, `lib/live/liveAuction.ts` (pure, tested: ladder, server-clock countdown, status line, viewer state, stale-snapshot guard), `lib/live/useLiveAuction.ts` (socket events + polling; `&demo=1` preview auction), `lib/live/useAuctionClock.ts`.
- `components/live/LiveAuctionCard.tsx`, `LiveAuctionBidSheet.tsx` (Custom), `LiveAuctionHostSheet.tsx` (Start an auction: piece, starting bid stepper, 10/15/30/60 s chips, Sudden death switch).
- `contexts/FeatureFlagContext.tsx`: `live_auctions` key, default `false`.

## Touches existing UI

All of it renders only when `live_auctions` is ON.

| File | Change |
|------|--------|
| `app/seller-live.tsx` | One more right-rail button ("Start an auction", clock icon) after Co-host; the host's auction card above the product strip (with "Cancel auction" before the first bid); the start sheet. Socket handler forwards auction events (1 line). |
| `app/buyer-live.tsx` | Auction card under the composer (Whatnot places it at the bottom); Custom bid sheet; **Pay** opens the existing in-stream purchase panel with the winning price and sends `auctionId` with the line; `payAuction` route param. Socket handler forwards auction events (1 line). |
| `app/live.tsx` | On the active page, the auction card takes the pinned-product card's place (right rail moves up to clear it); Custom bid sheet; **Pay** hands off to `/buyer-live?…&payAuction=` (where checkout lives). |
| `lib/live/useLiveSocket.ts` | Event types only. |

## Feature flags / env keys

- `live_auctions` (feature_flags table) — default **OFF**, seeded OFF by `300_f6_live-auctions.sql` (`ON CONFLICT DO NOTHING`, never flips an operator's choice). Turn on with the existing feature-flag admin endpoint. No env keys, no third-party sign-up.

## Tests

API (`cd artifacts/api-server && TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/bt_test_live_auctions pnpm exec vitest run …`):

- `src/lib/__tests__/liveAuctionRules.test.ts` — increment ladder, min next bid, every bid rejection (self-bid, too low, already leading, closed, invalid), anti-snipe vs sudden death, 1-of-1 detection, start-input validation, settle outcome + 24 h pay window, display name. **pass**
- `src/routes/__tests__/live-auctions.integration.test.ts` (real routers + test DB; auth and the socket hub stubbed):
  - flag OFF → start 403, GET `{ enabled: false }`;
  - 1-of-1 enforcement (2 in stock, or 1+1 across sizes → `NOT_ONE_OF_ONE`); start broadcasts `auction_started`; one open auction per live; bad durations / starting bid → 400;
  - bid ordering on the ladder ($5 → $6 floor → $20 → $22 floor), `ALREADY_LEADING`, bids recorded, `auction_bid` broadcast per bid;
  - host self-bid rejected, blocked viewer 404, banned viewer `REMOVED`;
  - **concurrency**: 8 simultaneous $5 bids → exactly one accepted, `bid_count` 1; 8 simultaneous escalating bids → no lost update, final price = highest accepted bid, accepted bids strictly increasing in time order;
  - anti-snipe (bid with 3 s left → ends 10 s from now) and sudden death (no change);
  - settle on read → sold to the leader, late bid `AUCTION_CLOSED`, winner sees `youWon` + `payable`, `auction_ended` broadcast; checkout price: winner gets exactly the winning price, others `AUCTION_NOT_WON`, qty 2 refused, piece held from other buyers (`AUCTION_HOLD`), paid → `AUCTION_PAID` and the hold lifts; unsold with no bids; cancel only before the first bid; pay window expiry.
  **25/25 pass** (rules + integration).
- Neighbours re-run (`onePageCheckout`, `threadCashCheckoutRoutes`, `live-block-checks`, `stock-reservation-concurrency`, `loyalty-awards`): all pass except `stock-reservation-concurrency` and `loyalty-awards`, which fail the same way without this branch's code paths (order status `processing` vs expected `pending`).
- `pnpm exec tsc -p tsconfig.json --noEmit` (after `pnpm exec tsc --build`): **0 errors**.

Mobile (`cd artifacts/mobile`):

- `pnpm exec vitest run tests/live-auction.test.ts` — ladder + custom-bid stepper, server-clock countdown, `00:06` clock / `$44` formatting, winning/won/host derivation, status lines, stale-snapshot guard. **7/7 pass**.
- Full suite diffed against `origin/dev` (per coordinator): `origin/dev` 88 failed / 4811 passed; this branch 87 failed / 4819 passed; **no new FAIL entries** (`comm -13` of the sorted FAIL lists is empty).
- `pnpm exec tsc -p tsconfig.json --noEmit`: **0 errors**.

Screenshots: `node scripts/f6-live-auctions-screenshots.mjs [--skip-build]` → `docs/pr-assets/live-auctions/ours/` (390×844, LIVE pager, `&demo=1`, `live_auctions` forced ON by a route stub).

## Suggestions for Dev

- **Max bid / auto-bid** (Whatnot's toggle in the Custom sheet) — needs a proxy-bid table and bidding on the user's behalf inside the same row lock.
- **Payment on file / auto-charge** at the end of an auction (Whatnot charges immediately); today the winner taps **Pay** and has 24 h. Nothing re-lists an unpaid piece automatically after the window — it just becomes buyable again.
- Notify the winner (push) and the host ("Sold to …") — the existing notification pipeline wasn't touched.
- `seller-live.tsx` and `buyer-live.tsx` are native-only on web, so the host sheet and the buyer-live card are verified by type-check, unit and integration tests only; the screenshots show the same card in the LIVE pager.
- Pre-existing failures seen while running neighbours (unrelated): `stock-reservation-concurrency` (expects `pending`, gets `processing`); the mobile suite's existing failures on `origin/dev` (diffed: this branch adds none).
