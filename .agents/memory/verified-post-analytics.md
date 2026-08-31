---
name: Verified post analytics
description: Truth and availability rules for seller-facing per-post performance metrics.
---

Optional per-post metrics must expose whether they are tracked and use null for unavailable values. Never substitute demo values or infer views from feed delivery, retention from media type, or a conversion rate without a measured click denominator.

**Why:** Sellers use post analytics to make business decisions. A plausible zero or derived estimate is materially different from a verified metric and can hide missing instrumentation.

**How to apply:** Count only durable, owner-scoped records. Keep always-countable engagement separate from event-derived metrics, label unavailable values clearly in the client, and add new instrumentation before changing a metric from untracked to tracked.