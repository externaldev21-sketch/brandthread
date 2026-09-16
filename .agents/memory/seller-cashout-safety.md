---
name: Seller cash-out safety
description: Durable rules for seller-initiated Stripe Connect bank payouts.
---

Seller cash-outs must bind the seller's exact confirmed integer-cent amount and currency to the connected account, eligible bank destination, and a durable server-generated attempt reference before contacting Stripe. Processing attempts reserve funds and share the same seller lock as shipping-label funding. Retry by provider reference and stable idempotency key; after the bounded provider retry window, require review rather than issuing another payout.

**Why:** A response can be lost after Stripe accepts a payout, Stripe idempotency retention is bounded, and a seller can reconnect a different account or bank before retrying. Recomputing “cash out all” or using current destination state can duplicate a payout or send it somewhere the seller did not confirm.

**How to apply:** Any manual payout surface must use a fresh balance, send the displayed amount/currency, revalidate exact equality under lock, persist account and bank bindings, reconcile provider metadata first, and keep unresolved attempts excluded from spendable funds.