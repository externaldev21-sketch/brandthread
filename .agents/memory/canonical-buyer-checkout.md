---
name: Canonical buyer checkout
description: Product rule for routing all buyer purchases through one consistent checkout and post-purchase journey.
---

Every buyer purchase—whether started from a Thread video, Discover, a seller profile or storefront, a product page, a drop or bundle, or the cart—must use the same canonical Brandthread checkout and post-purchase sequence.

**Why:** The user explicitly chose the supplied Depop purchase journey as the interaction model that checkout should always follow. Separate source-specific checkout UIs would drift in behavior and presentation.

**How to apply:** Preserve source attribution and buy-now/cart session differences, but route them into the canonical checkout screen and shared state contract. The confirmed sequence is options → add confirmation → updated cart badge/View cart → seller-grouped cart → address → item/shipping/total review → Stripe → confirmation with Message seller, View purchase, delivery estimate, and recommendations. Keep the sequence consistent across purchase sources and style it with Brandthread’s design system.

The first successful purchase must collect first name, last name, email, phone, and a complete shipping address. Use provider-backed address suggestions to fill structured address fields, while preserving manual correction. After payment succeeds, save the buyer's contact/address details for reuse. Reuse cards only through the buyer's persistent Stripe Customer and Stripe-hosted payment methods; Brandthread must never store raw card data.

**Why:** The user explicitly requires a complete first-purchase identity and a faster repeat checkout without sacrificing payment-data security.

Thread commerce actions stay distinct: Add to cart mutates the cart and updates its badge; Buy now must not touch the cart and instead creates a direct-purchase session before opening the full canonical checkout. Product descriptions appear before variant and quantity choices.