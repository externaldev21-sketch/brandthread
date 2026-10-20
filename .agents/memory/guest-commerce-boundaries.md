---
name: Guest commerce boundaries
description: Security and identity rules for Brandthread guest checkout and saved buyer addresses.
---

Public browsing must remain separate from authenticated buyer APIs. The owner now requires sign-in at add-to-bag/buy/checkout actions, while feeds, search, public profiles, catalog and comment reading stay public. Public profile metadata is not permission to expose private social content or account routes. Preserve the legacy guest-order recovery contract: an existing guest order is authorized after redirect by an opaque checkout capability whose hash is stored server-side, never by email.

**Why:** Email is not proof of identity, and widening existing buyer routes would weaken their Clerk ownership guarantees. Idempotent checkout retries must return the same capability so a lost or repeated response does not strand a paid guest order.

**How to apply:** Gate new app purchase actions with the shared sign-in prompt without breaking recovery of existing paid guest orders. Any compatibility guest Stripe sessions remain customer-less, skip loyalty and saved payment methods, retain guest email only for receipt/order updates, and keep shipping session-only. Buyer address records always derive ownership from Clerk and serialize default changes per buyer.