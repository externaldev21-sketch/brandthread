---
name: Mobile API resilience
description: Rules for global API failure notices and safe retry behavior in the Brandthread mobile app.
---

Classify network failures plus HTTP 5xx and 408 centrally and surface them briefly in the shared app shell. Do not present HTTP 429 rate limiting as offline/server unavailability. Keep authentication, authorization, validation, and expected business-rule failures out of the global notice.

**Why:** A single consistent notice makes connectivity failures understandable across buyer and seller routes, but sticky last-failure state can falsely claim the app is offline after recovery, and blindly retrying writes can duplicate side effects.

**How to apply:** Expire transient global notices, clear them on confirmed wrapped-request success, and attach global retry callbacks only to idempotent reads. Mutations keep retry actions in the owning screen.