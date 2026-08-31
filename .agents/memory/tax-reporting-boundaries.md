---
name: Tax reporting boundaries
description: Durable rules for Stripe Tax persistence and annual gross-payment reporting.
---

Attribute annual gross-payment records to the UTC year of the provider's successful-payment event, not checkout creation or fulfillment time. Preserve Stripe's tax, shipping, gross charged amount, and final Checkout destination as separate authoritative facts. Refunded payments remain in gross-payment history.

**Why:** Checkout can cross a year boundary, tax can otherwise be mistaken for shipping, buyers can edit their destination in Stripe Checkout, and 1099-K preparation reports gross payments rather than net proceeds.

**How to apply:** Any paid physical-goods path must write one immutable seller ledger row using a hard order-level uniqueness boundary. Historical timestamp fallbacks must carry explicit provenance. Tax UI must never imply that calculation proves nexus, registration, or filing compliance.