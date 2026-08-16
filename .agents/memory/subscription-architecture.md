---
name: Seller Subscription Architecture
description: Seller platform billing (monthly recurring fee) — completely separate from Stripe Connect.
---

## Rule
The seller subscription (Growth $29/mo, Pro $79/mo) charges the seller's own payment method via a standard Stripe Subscription. It is entirely separate from Stripe Connect, which only handles buyer→seller payment-splitting.

## Key columns added to `users` (migration 004)
- `stripe_customer_id` — Stripe Customer for billing (not the same as `stripe_account_id` / Connect)
- `subscription_id` — Stripe Subscription ID
- `subscription_status` — active | trialing | past_due | canceled | none
- `subscription_period_end` — TIMESTAMP of current period end
- `subscription_plan_id` — starter | growth | pro

## Server routes (`/api/seller/subscription/*`, auth required)
- `GET /status` — fetches live from Stripe (expand: default_payment_method), returns plan/status/renewsOn/amountCents/paymentMethodLabel
- `POST /checkout` — body `{ planId: 'growth'|'pro' }` → creates Stripe Checkout Session in subscription mode → returns `{ url }`
- `POST /portal` — creates Stripe Customer Portal session → returns `{ url }`
- `GET /return` and `GET /portal/return` — plain HTML landing pages after Stripe redirects (no auth)

## Stripe Price lookup
Uses `lookup_key` (brandthread_growth_monthly, brandthread_pro_monthly) so the same Price is reused across deployments. `ensurePrice()` finds-or-creates via `stripe.prices.list({ lookup_keys })`.

## Webhook events handled (in webhooks.ts)
- `customer.subscription.created/updated` → `handleSubscriptionUpdated()` — updates status, planId, periodEnd; looks up seller by `stripeCustomerId`
- `customer.subscription.deleted` → `handleSubscriptionDeleted()` — sets status='canceled', planId='starter'

## Why
Cast `stripe.subscriptions.retrieve()` result to `any` — the SDK's `Response<Subscription>` generic doesn't expose `current_period_end` or expanded fields at the TypeScript level.

## Mobile (`subscription.tsx`)
- Loads `api.seller.subscription.status()` on mount; shows `ActivityIndicator` in gradient card while loading
- `handleChangePlan('starter')` → Alert → opens portal; any other plan → Stripe Checkout via `Linking.openURL(url)`
- `handleOpenPortal()` → portal session → `Linking.openURL(url)`
- Dev banner removed; status pill color/label derived from live status field
- `api.seller.subscription` methods live in `artifacts/mobile/lib/api.ts` under `seller.subscription`
