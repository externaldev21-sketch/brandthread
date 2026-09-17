---
name: Canonical buyer checkout
description: Product rule for routing all buyer purchases through one consistent checkout and post-purchase journey.
---

Every buyer purchase—whether started from a Thread video, Discover, a seller profile or storefront, a product page, a drop or bundle, or the cart—must use the same canonical Brandthread checkout and post-purchase sequence.

**Why:** The user explicitly chose the supplied Depop purchase journey as the interaction model that checkout should always follow. Separate source-specific checkout UIs would drift in behavior and presentation.

**How to apply:** Preserve source attribution and buy-now/cart session differences, but route them into the canonical checkout screen and shared state contract. Address entry, summary, payment, confirmation, purchase detail, and delivered-order rating remain one consistent journey styled with Brandthread’s design system.