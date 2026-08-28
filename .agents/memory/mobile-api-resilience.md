---
name: Mobile API resilience
description: Rules for global API failure notices and safe retry behavior in the Brandthread mobile app.
---

Classify network failures plus HTTP 5xx, 408, and 429 centrally and surface them in the shared app shell. Keep authentication, authorization, validation, and expected business-rule failures out of the global notice.

**Why:** A single consistent notice makes connectivity failures understandable across buyer and seller routes, but blindly retrying writes can duplicate orders, posts, payments, and other side effects.

**How to apply:** Attach automatic global retry callbacks only to idempotent reads. Mutations must keep their retry action in the owning screen, where the UI can preserve context, roll back optimistic state, and require a deliberate user action.