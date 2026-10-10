# Creator payouts: how to switch them on (BT-322)

Creators earn commission on sales through their `?aff=CODE` links. Commissions accrue as **owed** today; nothing is paid out until Dev switches payouts on.

## Before switching on
1. **Merge the seller-funding change first** — PR "Revenue P0 3/4: flat 5% on item + shipping, seller-funded gift cards and affiliate commissions" (externaldev21-sketch/brandthread#779). Without it, payouts come out of Brandthread's Stripe balance instead of the seller's (BT-310).
2. Stripe Connect must be live on the platform account (it already is for seller payouts).
3. Creators onboard to Stripe from **Creator program → Payouts → Set up payouts**. After Stripe, they now come back to Creator program (`/api/affiliate/connect/return`); the old return URL (`/api-server/seller/connect/...`) returned a 404 (BT-323).

## Switch on
| Env var (API deployment) | Value |
|---|---|
| `AFFILIATE_PAYOUTS_ENABLED` | `true` |
| `STRIPE_SECRET_KEY` | already set (live key) |

Replit → the deployment → **Secrets** → add `AFFILIATE_PAYOUTS_ENABLED=true` → redeploy. The job `jobs/affiliatePayouts.ts` runs every 15 minutes: it reverses commissions on refunded orders, moves commissions past the return window to payable, and sends a Stripe transfer to each creator with a ready Connect account (idempotency key `affiliate-payout/<id>/<attempt>`).

## Check it works
- Creator program shows payouts as available (the "Payouts are not switched on yet." note disappears).
- `SELECT status, count(*) FROM affiliate_payouts GROUP BY 1;` shows `paid` rows after the first run with payable commissions.

## Switch off
Remove the variable (or set it to anything but `true`) and redeploy. Commissions keep accruing as owed; nothing is lost.
