---
name: Buyer cancellation boundary
description: Concurrency and inventory rules for the buyer grace-period cancellation flow.
---

Buyer cancellation is allowed through day 21 while an order remains in a pre-shipment status. Cancellation, label purchase, and seller fulfillment must serialize on the order, and cancellation is terminal.

**Why:** An unlocked eligibility check allows a seller to begin fulfillment while the buyer is being refunded, and a cancelled paid order otherwise leaves reserved variant stock unavailable.

**How to apply:** Lock before eligibility checks, use a stable refund idempotency key, restore each reserved variant quantity once, reverse rewards once, and prevent later seller status writes from replacing cancellation.