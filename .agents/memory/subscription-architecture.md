---
name: Seller Subscription Architecture
description: Seller platform billing (monthly recurring fee) — completely separate from Stripe Connect.
---

## Rule
The seller subscription charges the seller's own payment method via a standard Stripe Subscription. It is entirely separate from Stripe Connect, which only handles buyer→seller payment-splitting. Buyers never see this.

## Three-tier catalogue (as of migration 028)
- `starter`  $29/mo  — lookup_key: brandthread_starter_monthly
- `growth`   $79/mo  — lookup_key: brandthread_growth_monthly
- `scale`   $199/mo  — lookup_key: brandthread_scale_monthly
All plans carry a 5% platform commission on sales.

Old lookup keys: `brandthread_pro_monthly` is remapped to `growth` in webhooks for backwards compat.

## Key columns in `users` (migration 004)
- `stripe_customer_id` — Stripe Customer for billing (not the same as `stripe_account_id` / Connect)
- `subscription_id` — Stripe Subscription ID
- `subscription_status` — active | trialing | past_due | canceled | none
- `subscription_period_end` — TIMESTAMP of current period end
- `subscription_plan_id` — starter | growth | scale

## Five-day free trial
`POST /checkout` creates Stripe Checkout Session with `trial_period_days: 5` and `payment_method_collection: 'always'`.
Card is collected upfront; trial auto-converts to paid on day 6 with no seller action required.

## Server routes (`/api/seller/subscription/*`, auth required)
- `GET /status` — fetches live from Stripe (expand: default_payment_method), returns plan/status/renewsOn/**trialEnd**/amountCents/paymentMethodLabel
- `POST /checkout` — body `{ planId: 'starter'|'growth'|'scale' }` → Stripe Checkout with trial → returns `{ url }`
- `POST /portal` — creates Stripe Customer Portal session → returns `{ url }`
- `GET /return` and `GET /portal/return` — plain HTML landing pages after Stripe redirects (no auth)

## Stripe Price lookup
`ensurePrice()` finds-or-creates via `stripe.prices.list({ lookup_keys })` so the same Price is reused across calls/deployments.

## Webhook plan ID mapping (webhooks.ts)
brandthread_scale_monthly → 'scale', brandthread_growth_monthly → 'growth', brandthread_starter_monthly → 'starter', brandthread_pro_monthly → 'growth' (legacy).

## Why
Cast `stripe.subscriptions.retrieve()` result to `any` — the SDK's `Response<Subscription>` generic doesn't expose `current_period_end`, `trial_end`, or expanded fields at the TypeScript level.

## Mobile screens
- `plans.tsx` — onboarding + upgrade UI; reads `onboarding_brand_stage` from AsyncStorage for tier recommendation; AppState polling on return from Stripe Checkout; awaiting-return full-screen overlay
- `subscription.tsx` — plan/usage/billing tabs; shows trial end date separately from renewal date; updated for 3-tier catalogue
- `finance.tsx` — shows a subscription card (plan, status, trial end) that links to subscription.tsx
- `api.seller.subscription` methods in `artifacts/mobile/lib/api.ts`

## Onboarding integration
`onboarding.tsx` saves `onboarding_brand_stage` to AsyncStorage in `finishSeller` so plans.tsx can read it for the tier recommendation banner.
