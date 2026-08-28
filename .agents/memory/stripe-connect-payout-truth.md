---
name: Stripe Connect payout truth
description: Rules for deciding whether a seller is connected, pending, or verified for payouts.
---

Seller payout readiness and bank display must be derived from a live Stripe Connect account retrieval. No connected account means not connected; payout verification means Stripe currently reports payouts enabled. Commerce status is stricter: active requires both charges and payouts enabled, while a submitted account missing either capability is restricted. Only the external bank account's last four digits may be returned to the client.

**Why:** Finance balances, payout destinations, and cached database status can be absent or stale and previously made incomplete accounts look verified. Full external-account details are sensitive and unnecessary.

**How to apply:** Expose payout and charge capabilities separately. Never promote the cached checkout gate to active unless both are true. Keep balances and payout history separate, refresh after hosted onboarding returns or app resume, and never persist or log hosted URLs or bank details beyond the allowed last four.