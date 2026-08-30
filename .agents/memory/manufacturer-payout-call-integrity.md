---
name: Manufacturer payout and call integrity
description: Durable correctness boundaries for manufacturer Stripe payments and private production calls.
---

Manufacturer payout readiness requires Stripe charges, payouts, and submitted details to all be enabled. Card destination charges and wallet-funded transfers use different reversal accounting, but both must move an affected order into payment review and keep manufacturer history net of reversals.

**Why:** Provider webhooks can arrive before the initiating request finishes, and refunds, disputes, partial transfer reversals, or replayed events can otherwise produce false success, duplicate notifications, or incorrect wallet balances.

**How to apply:** Make request and webhook paths converge on one provider-derived idempotency identity. Treat a matching webhook-first final state as success. Adjust wallet accounting only for wallet transfers, not destination-card reversals. Validate Stripe return destinations as exact scheme/origin, host, path, and query shapes rather than trusting a scheme or origin alone.

Production calls are capabilities of an existing seller/manufacturer thread, not public rooms. Credentials stay short-lived and lifecycle events must carry stable client event identities.

**Why:** Authorization at UI entry points is insufficient, and retries or repeated SDK callbacks can duplicate audits and notifications.

**How to apply:** Authorize every token and event request against both stored participants, scope deterministic channels to the thread, expose configuration/device failures explicitly, and gate notifications on newly inserted lifecycle events.