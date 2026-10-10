# Merchant of record: decision document

Status: **recommendation, not switched on.** Production behaviour is unchanged
(`PAYOUT_MODE=hold`, no `on_behalf_of`). This document is the decision Dev
needs to make before launch, the trade-offs, and the step-by-step migration
if the answer is yes. Audit item BT-061.

Related: [money-flow.md](./money-flow.md) §8 (open Stripe confirmations),
[delivery-guarantee.md](./delivery-guarantee.md) (the delivery hold),
[sales-tax-facilitator-plan.md](./sales-tax-facilitator-plan.md) (tax, BT-067).

---

## 1. Where we are today

| Checkout | Code path | Charge type | Who is the settlement merchant |
|---|---|---|---|
| Hosted checkout, in-stock, `PAYOUT_MODE=hold` (**default**) | `routes/buyer.ts` → `lib/money/checkoutPlan.ts` `paymentIntentMoney()` returns `chargeModel: "transfer"` | Separate charge on the platform, transfer after delivery + buffer (`lib/money/cartTransfers.ts`) | **Brandthread** |
| One-page cart checkout (always) | `routes/checkout-intent.ts` (one cart-wide PaymentIntent, `transfer_group: cart_<id>`) | Separate charge on the platform, one transfer per seller order | **Brandthread** |
| Pre-order drop | `checkoutPlan.ts` `resolveChargePlan()` → `chargeModel: "held"` | Separate charge on the platform, per-order release (`lib/money/escrow.ts`) | **Brandthread** |
| Hosted checkout, in-stock, `PAYOUT_MODE=immediate` | `paymentIntentMoney()` → `transfer_data.destination` + `application_fee_amount` | Destination charge | **Brandthread** (no `on_behalf_of`) |

`PAYOUT_MODE` is read in `lib/delivery/policy.ts` (`payoutMode()`, values
`hold` | `immediate`).

What that means in practice:

- **Brandthread's** statement descriptor is on every buyer's card statement.
- Every refund and every dispute is debited from **Brandthread's** balance first;
  we claw back from the seller afterwards (transfer reversals, seller recovery).
- Radar, the dispute rate and the refund rate are all measured on **one account**
  (Dev's). Card networks start monitoring programs around a 0.75% dispute ratio
  (Visa VDMP ~0.9%, Mastercard ECM ~1.5%). One bad seller raises everyone's risk.
- Stripe can put a **reserve** on the platform account because it carries
  delayed-fulfilment risk: up to 18 days for regular orders (15-day delivery
  window + 3-day buffer) and 60+ days for pre-orders. A 10% rolling reserve on
  $1M GMV ties up ~$100k.
- Held money sits on the platform balance, so the platform account **must** be
  on manual payouts (BT-062, see §6).

## 2. Recommendation

**Move in-stock orders to destination charges with `on_behalf_of` = the
seller's connected account**, keeping Brandthread's commission as
`application_fee_amount`. Keep pre-orders on the current held model until
Stripe signs off on the alternatives in §4.

With `on_behalf_of`:

- the **seller is the settlement merchant**: their country/currency settles the
  charge, and **their** statement descriptor (with an optional Brandthread
  prefix) is shown to the buyer;
- disputes and refunds are **debited from the connected account**; Brandthread
  refunds its application fee proportionally (already implemented in
  `lib/money/refunds.ts`);
- the seller's own dispute ratio is what card networks and Radar look at, so
  one seller's problems don't freeze the whole marketplace;
- Brandthread still keeps 5% + the processing estimate as `application_fee_amount`
  (`lib/money/fees.ts` `destinationApplicationFeeCents()`), unchanged.

## 3. Trade-offs

| Topic | Today (platform is merchant) | Destination + `on_behalf_of` |
|---|---|---|
| Statement descriptor | Brandthread | Seller (prefix configurable) |
| Dispute / refund debit | Platform first, then claw back | Seller's connected account; platform only if the seller's balance can't cover it (Express: platform is still liable for negative balances) |
| Network dispute ratio | One shared account | Per seller |
| **Delivery hold** (15 days + 3-day buffer, `payoutGate.ts`) | Natural: money is on our balance until delivery | **Lost as a platform hold.** The money is in the seller's Stripe balance right away. Options: (a) put each seller's Express account on a delayed payout schedule (`settings.payouts.schedule.delay_days`, max varies by country), or (b) accept the risk and rely on seller recovery (`sellerRecovery.ts`, PRs #724/#791) for auto-refunds. Auto-refunds (`lib/delivery/autoRefund.ts`) still work: `reverse_transfer` pulls the money back while it's still in the seller's balance. |
| **Pre-order holds** (up to 180 days) | Held on platform, released per order on tracking | Not compatible: a destination charge pays the seller immediately. Pre-orders stay `held` (separate charges) — see §4. |
| Express vs Custom | Express today (`routes/connect.ts` `type: "express"`) | Works with Express. `on_behalf_of` needs the connected account to have the `card_payments` capability (Express accounts created by `routes/connect.ts` request it; confirm for existing accounts). Custom would give full control of payout timing and the negative-balance rules but makes Brandthread responsible for KYC UI and support: not recommended now. |
| Stripe Tax | `automatic_tax.liability` = seller, but the charge is on the platform (inconsistent, money-flow.md §8 item 5) | Consistent for seller-liable tax. Note that marketplace-facilitator law usually makes **Brandthread** liable regardless (BT-067), which pushes the other way. |
| Reserve risk | Reserve lands on Dev's account and locks all GMV | Stripe can reserve individual sellers; the platform account carries much less delayed-fulfilment exposure |
| Processing fees | Paid by the platform out of the charge | Paid out of the application fee as today (destination model already estimates them) |
| Cross-border sellers | Transfers limited to same region | `on_behalf_of` requires the seller's account to be able to settle the charge; non-US sellers may need cross-border settings or stay on transfers |
| Thread Cash / loyalty top-ups | Separate platform transfers (no source_transaction) | Unchanged (`lib/threadCash/checkoutTopup.ts`, `lib/money/loyaltyTopup.ts`) |
| One-page multi-seller cart | One PaymentIntent, many sellers | **Not possible** with `on_behalf_of` (one settlement merchant per charge). Either one PaymentIntent per seller (several card authorisations, worse Apple Pay UX) or keep the cart on separate charges. |

## 4. What Stripe must sign off (written, before launch)

Ask the Stripe account manager / support in writing:

1. **Separate charges and transfers with an 18–60 day hold** on the platform
   balance (current default) — acceptable for this account? Reserve terms?
   (This is money-flow.md §8 item 1, still open.)
2. **Pre-orders up to 180 days** on the platform balance; whether `source_transaction`
   transfers have a maximum age (money-flow.md §8 item 3).
3. **Destination charges with `on_behalf_of`** for Express sellers: confirm the
   `card_payments` capability is in place for all sellers, the statement
   descriptor setup, and who is liable for negative balances on Express.
4. **Per-seller delayed payouts** (`delay_days`) on Express accounts as the
   replacement for the delivery hold — allowed maximum per country.
5. **Funds segregation** for held pre-order money (money-flow.md §8 item 2).
6. Whether the one-page cart (multi-seller, one PaymentIntent) can stay on
   separate charges while single-seller checkouts use `on_behalf_of`.
7. Platform account **payout schedule = manual** confirmed (BT-062).

## 5. Migration plan (when Dev says yes)

Nothing below is switched on by this change except the flag in step 2, which
defaults to off.

1. **Sign-off.** Get §4 items 1, 3, 4 in writing. Confirm every seller account
   has `card_payments` active (`routes/connect.ts` status endpoint already
   reads capabilities).
2. **Flag (built).** `STRIPE_ON_BEHALF_OF=1` adds `on_behalf_of: <seller account>`
   to destination charges in `lib/money/checkoutPlan.ts` `paymentIntentMoney()`
   (`onBehalfOfEnabled()`), which both `routes/buyer.ts` and `routes/guest-checkout.ts`
   use. It only applies when `PAYOUT_MODE=immediate`; hold-mode (`transfer`) and
   pre-order (`held`) charges are never changed. Tests:
   `lib/money/__tests__/checkoutPlanOnBehalfOf.test.ts`.
3. **Replace the delivery hold.** Before setting `PAYOUT_MODE=immediate` in
   production, decide between per-seller `delay_days` (set on Connect onboarding
   in `routes/connect.ts`) or relying on seller recovery for auto-refunds.
   `lib/delivery/payoutGate.ts` already treats `immediate` as "no platform hold".
4. **Staging run.** In Stripe test mode set `PAYOUT_MODE=immediate` and
   `STRIPE_ON_BEHALF_OF=1`; buy an in-stock item with the hosted checkout; check
   in the Dashboard that the charge shows the seller as settlement merchant, the
   application fee, and the seller's descriptor; refund it and open a test dispute
   (`4000000000000259`) and confirm both debit the connected account.
5. **One-page cart.** Keep `routes/checkout-intent.ts` on separate charges, or
   split it into one PaymentIntent per seller (separate project; affects
   `lib/money/cartCheckout.ts` and `cartTransfers.ts`).
6. **Roll out.** Turn both env vars on in production for new orders only (the
   charge model is stored per order, so existing orders keep settling the old
   way). Watch disputes and refunds for two weeks.
7. **Pre-orders.** Stay on `held` until Stripe answers §4 items 2 and 5.

### How to switch (operator steps)

```
PAYOUT_MODE=immediate      # in-stock orders become destination charges
STRIPE_ON_BEHALF_OF=1      # ...settled on the seller's account
```

Roll back by removing both variables; new orders return to the hold model.
Orders already paid keep their stored `charge_model`.

## 6. Independent of this decision: platform payouts must be manual

While any money is held on the platform (hold mode, pre-orders, Thread Cash,
gift cards), the platform account must not auto-pay its balance to Dev's bank.
The server checks this at boot and hourly (`jobs/platformBalance.ts`,
`lib/money/platformBalance.ts`) and logs an error if the platform payout
schedule isn't `manual` in hold mode, or if available + pending balance falls
below total `seller_held`. Admins can see the latest check at
`GET /api/admin/platform-balance`. Launch checklist:
[dev-only-tasks.md](../launch/dev-only-tasks.md).

Sources:
[Destination charges](https://docs.stripe.com/connect/destination-charges) ·
[on_behalf_of / settlement merchant](https://docs.stripe.com/connect/destination-charges#settlement-merchant) ·
[Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers) ·
[Connect risk management](https://docs.stripe.com/connect/risk-management) ·
[Payout schedule](https://docs.stripe.com/payouts#payout-schedule) ·
[Reserves FAQ](https://support.stripe.com/questions/reserves-frequently-asked-questions)
