---
name: Guest commerce boundaries
description: Security and identity rules for Brandthread guest checkout and saved buyer addresses.
---

Guest shopping must remain separate from authenticated buyer APIs. Only catalog, cart, product detail, and checkout routes may be public; social and account routes stay protected. A guest order is authorized after redirect by an opaque checkout capability whose hash is stored server-side, never by email.

**Why:** Email is not proof of identity, and widening existing buyer routes would weaken their Clerk ownership guarantees. Idempotent checkout retries must return the same capability so a lost or repeated response does not strand a paid guest order.

**How to apply:** Keep guest Stripe sessions customer-less, skip loyalty earn/redemption and saved payment methods, retain guest email only for receipt/order updates, and keep shipping session-only. Buyer address records always derive ownership from Clerk and serialize default changes per buyer.