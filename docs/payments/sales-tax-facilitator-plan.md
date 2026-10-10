# Sales tax: marketplace facilitator plan

Status: **plan only. No code path was added** (audit item BT-067). Section 6
explains why a feature-flagged `TAX_FACILITATOR_MODE=platform` was not built in
this change: excluding tax from seller payouts touches the order ledger,
refunds, disputes and destination charges at once, and a half-built version
(platform computes tax but the seller still receives it) would be worse than
today. This needs a CPA opinion first anyway.

Related: [merchant-of-record.md](./merchant-of-record.md) (BT-061),
[money-flow.md](./money-flow.md) §8 item 5.

---

## 1. The problem

Today tax is calculated **on the seller's connected account**:

| Checkout | Code | How tax is calculated |
|---|---|---|
| Hosted (in-stock and pre-order) | `routes/buyer.ts` `automatic_tax: { enabled: true, liability: { type: "account", account: seller.stripeAccountId } }` | Stripe Tax with the **seller's** registrations |
| Guest hosted checkout | `routes/guest-checkout.ts` (same liability) | Same |
| One-page cart | `lib/money/cartCheckout.ts` `calculateGroupTax()` → `stripe.tax.calculations.create(..., { stripeAccount: seller })`; recorded by `routes/webhooks.ts` `recordCartTaxTransaction()` on the seller's account | Same |
| Seller "enable tax" | `routes/taxes.ts` `POST /taxes/enable` only sets `defaults.tax_behavior = exclusive` on the seller's account | No registrations are added |

An Express seller who never adds state registrations in Stripe Tax collects
**$0** tax. And whatever tax is collected is passed to the seller inside their
transfer (`seller_held` includes it; `lib/money/escrow.ts` `recordOrderPaid`).

Brandthread is the party that charges the buyer (hold/transfer model) and runs
the marketplace. Under US **marketplace facilitator** laws (every state with a
sales tax has one), once Brandthread crosses a state's economic-nexus threshold
(typically $100,000 of sales into the state, some states also 200 transactions;
a few use $250k/$500k), **Brandthread** must collect and remit tax on all
third-party sales into that state, not the sellers. Uncollected tax becomes
Brandthread's liability plus penalties and interest; tax already handed to
sellers may still be owed by Brandthread.

## 2. Target design

1. **Calculate on the platform account** with Brandthread's own Stripe Tax
   registrations (Stripe Tax → Registrations on the platform Dashboard).
   - Hosted checkout: `automatic_tax.liability = { type: "self" }` (platform).
   - One-page cart: `stripe.tax.calculations.create(...)` without `stripeAccount`;
     the tax transaction is recorded on the platform (`createFromCalculation`
     without `stripeAccount`).
2. **Keep tax out of seller payouts.** At `recordOrderPaid` the order's tax
   goes to a new ledger account `sales_tax_payable` (platform liability) instead
   of `seller_held`. Transfers (`cartTransfers.ts`, `escrow.ts` releases) then
   naturally exclude it, since they transfer `orderHeldCents()`.
   - Destination charges (`PAYOUT_MODE=immediate`): the application fee is fixed
     before Stripe knows the tax, so either move tax-facilitator states to the
     transfer model, or use `transfer_data.amount` computed after tax is known
     (Payment Element flow). Hosted Checkout can't do this; see §6.
3. **Refunds**: the tax portion of a refund comes back out of
   `sales_tax_payable` (and a Stripe Tax reversal transaction,
   `tax.transactions.createReversal`), not from the seller's share
   (`lib/money/refunds.ts`).
4. **Disputes**: a lost dispute's tax portion is a platform loss, unless the
   state allows a bad-debt deduction (CPA question).
5. **Remit centrally.** Stripe Tax reports by jurisdiction; file through Stripe
   Tax filing partners (or a provider such as TaxJar/Avalara) from the
   platform. Sellers no longer file marketplace sales in facilitator states.
6. **Threshold monitoring.** Until registered everywhere, track sales and
   transaction counts per destination state (`seller_tax_ledger` already
   records every paid physical order, `lib/sellerTaxLedger.ts`; group by the
   order's `shipping_address.state`). Stripe Tax's "threshold monitoring"
   page does the same for platform-calculated tax. Register in a state before
   the threshold is crossed (most states give 30–90 days after crossing).
7. **Seller UI**: the seller tax screen (`taxes-duties`) should say Brandthread
   collects and remits sales tax for marketplace orders; sellers keep
   responsibility for off-platform sales.

## 3. Phased rollout

| Phase | What | Exit criterion |
|---|---|---|
| 0. Opinion | CPA confirms facilitator status, states with nexus today, treatment of pre-orders (tax at payment vs shipment), shipping taxability, Thread Cash / loyalty / gift cards as discounts vs tender | Written memo |
| 1. Register | Brandthread registers in states over threshold (and home state); enable Stripe Tax on the platform; threshold monitoring on | Registrations visible in Stripe Tax |
| 2. Shadow | Calculate tax on the platform **in parallel** (log only) and compare with today's seller-account tax per order | Two weeks of shadow data, differences explained |
| 3. Switch (flag) | `TAX_FACILITATOR_MODE=platform`: platform calculation, `sales_tax_payable` ledger account, transfers exclude tax, refunds reverse tax centrally. Default off. Hold-mode/transfer orders only | Integration tests for paid → transfer → refund → dispute with tax |
| 4. Remit | Monthly/quarterly filing from the platform through Stripe Tax filing | First filing accepted |
| 5. Sellers | Update seller tax screen copy; remove the per-seller "enable tax" requirement for marketplace orders | — |

## 4. CPA sign-off items

1. Is Brandthread a marketplace facilitator in each state where buyers are,
   given that it controls checkout and charges the buyer (hold model)? Does
   that change if sellers become merchant of record (`on_behalf_of`,
   merchant-of-record.md)? (Facilitator laws generally apply either way.)
2. Which states are over threshold today, and is there back-tax exposure for
   sales already made? Voluntary disclosure?
3. Pre-orders: is tax due at payment or at shipment? (Held up to 180 days.)
4. Shipping and handling taxability per state (Stripe Tax handles this when
   shipping is passed as `shipping_cost`).
5. Discounts: platform-funded Thread Cash and loyalty points (BT-066) — are
   they a discount (reduces taxable amount) or a payment method (doesn't)?
   Today they are a Stripe coupon, so they reduce the taxable amount.
6. Gift cards: tax at redemption, not purchase (current design).
7. International manufacturers / sellers shipping into the US: any import or
   use-tax obligations for Brandthread.
8. Record keeping: retention of `seller_tax_ledger` and Stripe Tax transactions.
9. 1099-K reporting stays with Stripe Connect (`routes/taxes.ts` `/1099`) — confirm.

## 5. Stripe items

- Stripe Tax on the platform: pricing per transaction and filing add-on.
- Confirm `automatic_tax.liability = self` with separate charges and transfers,
  and with `on_behalf_of` if BT-061 is adopted.
- Tax reversals for partial refunds of one order inside a multi-seller cart
  PaymentIntent.

## 6. Why the flag was not built in this change

A contained `TAX_FACILITATOR_MODE=platform` would need, at minimum:

- the platform liability in hosted checkout (`buyer.ts`, `guest-checkout.ts`)
  and the cart (`cartCheckout.ts`, `webhooks.ts` tax transaction);
- a `sales_tax_payable` posting in `escrow.recordOrderPaid` (the transfer and
  held branches), which is also being changed by the open finance and refunds
  PRs (#724, #791);
- refund math that separates the tax share (`refunds.ts`) and Stripe Tax
  reversals;
- a decision for destination charges, where the application fee is fixed
  before tax is known.

Doing only the first bullet would make Brandthread the liable party while
still paying the tax to sellers, so it is deliberately left as a plan. Phase 3
above is the implementation ticket once the CPA memo (phase 0) is in.

Sources:
[Stripe Tax for marketplaces](https://docs.stripe.com/tax/tax-for-marketplaces) ·
[Checkout automatic tax liability](https://docs.stripe.com/tax/checkout#liability) ·
[Tax calculations API](https://docs.stripe.com/tax/custom) ·
[Threshold monitoring](https://docs.stripe.com/tax/monitoring) ·
[Streamlined Sales Tax: remote seller and marketplace facilitator thresholds](https://www.streamlinedsalestax.org/)
