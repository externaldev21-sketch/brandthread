---
name: Order-funded shipping-label boundary
description: Durable rules for spending pending order funds on carrier labels without double-spending or racing cancellation.
---

Carrier rates must be persisted as short-lived, order-and-owner-bound quotes. A client-provided provider rate token or price is never sufficient authority to spend order funds.

Label purchase is a durable operation state, not a single provider call. While it is pending, the order cannot be cancelled or fulfilled, and payout creation must share the same seller-scoped spending lock. Retries reconcile by the persisted operation identity before creating another provider transaction.

Void/refund uses one locked claimant and releases the order/preorder reservation only after the provider confirms the refund.

**Why:** Carrier calls and database commits can fail independently. Without a durable claim and shared locks, one timeout can create duplicate labels or let cancellation, fulfillment, and payouts spend the same order funds.

**How to apply:** Any new payout, automatic release, cancellation, fulfillment, label retry, or provider webhook path must participate in these states and locks rather than updating balances or order status independently.