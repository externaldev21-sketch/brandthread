---
name: Seller vacation enforcement
description: Effective vacation status and the server boundaries that must reject buyer activity.
---

Seller vacation mode is an authorization-style server rule, not merely a storefront banner. While active, authenticated and guest checkout creation must reject purchases, and buyers must not create or send messages to the seller. Public seller and product responses expose the effective status and the seller's message so clients can explain the restriction before an attempted mutation.

**Why:** UI-only gating can be bypassed, and stale clients could otherwise create charges or messages during the seller's declared absence.

**How to apply:** Evaluate expiration at request time, treat expired periods as inactive consistently, return a machine-readable vacation error with the seller's message, and retain server checks even when every current client disables its controls.