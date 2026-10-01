# Payout policy: two open decisions

Everything lives in one file: `artifacts/api-server/src/lib/money/payoutPolicy.ts`.
Both decisions are a single constant there. Nothing else in the codebase defines them.
The platform fee stays only in `lib/money/fees.ts`.

## 1. Hold or reserve? (`PAYOUT_PROTECTION_MODE`, default `'hold'`)

| | `hold` | `reserve` |
|---|---|---|
| What is kept back | The whole net of each order | `RESERVE_BPS` (10%) of each order's net |
| Until | `holdReleaseDate()` | `holdReleaseDate()` |
| Domestic (US) | Stripe's standard 2-day delay (`DOMESTIC_PAYOUT_DELAY_DAYS`) | `RESERVE_ROLLING_DAYS` (30) |
| International | `INTERNATIONAL_HOLD_DAYS` | `INTERNATIONAL_HOLD_DAYS` |
| Seller experience | Money arrives later | Most money arrives on schedule, a slice arrives later |

Both are computed by `computeHeldFunds()`. `GET /api/finance/balance` returns the result in a new `held` field and a `nextPayoutEstimate` field.

`PAYOUT_POLICY_ENFORCED` is `false` until the decision is made. While it is false, the app does not show a held line, the next payout estimate ignores holds, and cash-outs are not capped by them. Enforcing a hold on cash-outs is a follow-up that belongs next to the delivery-guarantee work.

## 2. International hold length (`INTERNATIONAL_HOLD_DAYS`, default `15`)

15 or 30 days. Applies to any order whose shipping country is not `HOME_COUNTRY` (`US`). An order with no recorded country counts as domestic.

## Delivery guarantee hook

"Hold until delivered" is not on dev yet and is not built here. `holdReleaseDate()` accepts an optional `extraHoldUntil` callback. When that work lands it returns the date funds must stay held until, and the policy takes the later of the two dates. `deliveredAt`, when supplied, also becomes the clock start.

## Instant payouts

`INSTANT_PAYOUT_FEE_BPS` (100 = 1%) and `INSTANT_PAYOUT_MIN_FEE_CENTS` (50). These are Stripe's published US Instant Payout rates as of writing. Re-check them at stripe.com/pricing before launch.

In the app, "Instant" is Stripe's `manual` payout schedule plus on-demand instant payouts. It is only offered when Stripe reports `available_payout_methods` containing `instant` on the seller's external account, which in practice means a debit card. The fee is paid from the same balance, so "cash out everything" sends the largest amount where amount plus fee still fits (`maxInstantPayoutCents`).
