---
name: Seller billing provider boundary
description: Durable rules for seller subscription providers, entitlement authority, and migration compatibility.
---

Native iOS and Android seller subscriptions use RevenueCat, while browser seller subscriptions stay on Stripe. Physical-product checkout and Stripe Connect payouts always remain Stripe. Existing Stripe subscribers continue to count toward effective access during migration.

**Why:** App-store policy requires native digital subscriptions to use StoreKit or Google Play Billing, but moving unrelated commerce off Stripe would create unnecessary risk. Client purchase state and webhook payload claims are not sufficient authorization.

**How to apply:** Render native prices and trials from RevenueCat offerings, identify customers with the authenticated Clerk user ID, and reconcile access server-side from live RevenueCat state. Compute the strongest valid entitlement across RevenueCat and legacy Stripe. Keep webhook processing authenticated, idempotent, and serialized per user, and isolate account switches so old customer data cannot leak into a new session.

The commercial ladder is Starter → Growth → Scale; onboarding may call Scale “Pro” for seller-friendly guidance, but must retain the `scale` product/entitlement identifier. Growth is the creation-and-sourcing tier; Scale/Pro is the team, live-selling, promotion, and advanced-customer-analytics tier.

**Why:** Recommendation and comparison copy must describe benefits that are actually enforced, while existing RevenueCat/Stripe product identifiers and legacy `pro` compatibility must not be renamed.

**How to apply:** Keep one shared plan catalogue for onboarding and subscription screens. Any advertised paid-tier distinction must have a matching server authorization boundary; recommendations remain advisory and never grant entitlement.