# Thread Cash at checkout — what's needed before enabling `threadCashCheckoutDiscount`

Thread Cash is a **platform-funded** buyer reward credit: when a buyer spends
it, the seller must still be paid the full item price. This document is the
plan for wiring that into the existing Stripe/ledger money flow (see
`docs/payments/money-flow.md`) without changing seller payout math, as
required. It is deliberately **not implemented yet** — the checkout hook in
`routes/buyer.ts` (`POST /checkout/session`) currently rejects any
`threadCashToken` outright, and the feature flag `threadCashCheckoutDiscount`
defaults to `false` — so this PR ships the earning/wallet/streak system and
the redemption-token plumbing (`lib/threadCash/wallet.ts`) without touching
any live Stripe money path.

## Why the existing loyalty-discount pattern can't be reused as-is

`routes/buyer.ts` currently redeems loyalty points as a one-off Stripe
**Coupon** applied to the Checkout Session, and feeds the *already-discounted*
subtotal into `paymentIntentMoney({ merchandiseCents, preTaxTotalCents })`.
For a destination charge, Stripe's `transfer_data.destination` amount is
`charge_amount - application_fee_amount` — both of which shrink with the
discount. That means the discount is paid for by the **seller** (their
transfer shrinks by the full discount amount), not the platform. That is
correct for loyalty points (seller-funded rewards) but is exactly backwards
for Thread Cash.

## The plan

1. **Compute fee inputs on the pre-Thread-Cash amount.** When calling
   `paymentIntentMoney(...)` in `routes/buyer.ts`, keep `merchandiseCents` /
   `preTaxTotalCents` as if the buyer had paid full price (only loyalty's
   discount, if any, still reduces them — Thread Cash must not). This makes
   the platform fee and the seller's destination-transfer amount identical to
   an undiscounted order.
2. **Still discount the buyer's actual Stripe charge** via a one-off Coupon,
   exactly like loyalty, sized to the Thread Cash amount reserved
   (`reserveThreadCashRedemption` in `lib/threadCash/wallet.ts` already does
   the balance-safe reservation/consume/release dance — reuse it verbatim).
3. **Fund the resulting gap with a supplemental Stripe Transfer.** Because the
   buyer's charge is now smaller than what `transfer_data.destination` was
   computed against, the destination transfer alone cannot deliver the
   seller's full net. In the `checkout.session.completed` webhook handler
   (`routes/webhooks.ts`, same place `recordOrderPaid` runs), after the order
   is created:
   - If `chargeModel === 'destination'`: issue a `stripe.transfers.create`
     to the seller's connected account for exactly the Thread Cash amount
     applied, idempotency-keyed as `thread-cash-topup/<orderId>`.
   - If `chargeModel === 'held'`: no extra transfer is needed — the seller is
     paid later via `lib/money/escrow.ts` from the platform's own balance
     using the order's already-full `sellerNetCents`, so simply do not let
     Thread Cash reduce `sellerNetCents` when it's computed.
4. **Add ledger accounts** in `lib/money/ledger.ts` `LEDGER_ACCOUNTS`:
   - `thread_cash_liability` — debited when Thread Cash is redeemed/spent
     (mirrors how a gift-card liability is normally tracked).
   - `thread_cash_seller_topup` — the platform's cost of the supplemental
     transfer in step 3, credited to `seller_paid_out` for the same amount so
     the transaction still balances to zero.
   Post this in the same DB transaction as order creation, idempotency-keyed
   as `thread-cash-redeemed/<orderId>`.
5. **Track it on the order.** `orders.thread_cash_applied_cents` (added by
   migration 085) already exists for this — set it when the order is created
   so refunds can find it. `lib/money/refunds.ts` already returns it to the
   buyer's Thread Cash balance on a full refund/cancellation
   (`refundThreadCashSpend`, wired at the single `onSucceeded` call site used
   by every refund path) — that part needs no further change.
6. **Test with the existing fake-Stripe integration harness**
   (`lib/money/__tests__/fakeStripe.ts`), specifically: the supplemental
   transfer is idempotent under a replayed webhook, a partial refund does not
   over-credit Thread Cash, and `findUnbalancedTransactions()` stays empty
   after a redemption + refund cycle.

## Sign-off needed before flipping the flag

- Confirm the Stripe Connect account has payout capability for a
  platform-initiated `transfers.create` outside the original charge (this is
  routine but worth confirming per Connect account type).
- Confirm accounting is fine tracking `thread_cash_liability` as an actual
  balance-sheet liability (Thread Cash awarded but not yet spent) rather than
  an expense recognized at award time.
