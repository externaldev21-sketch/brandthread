---
name: Seller trial reminder delivery
description: Timing, copy, retry, preference, and deduplication rules for seller trial reminders
---

**Rule:** Create the reminder only on day four of an exact five-day server-authoritative trial. Use exact end-date and truthful feature-loss copy; never infer usage. Respect trial-reminder preferences and digest mode.

**Why:** Worker crashes, partial multi-device push failures, and late-day retries can otherwise lose reminders or send duplicates. Generic urgency claims also damage trust when their timing is inaccurate.

**How to apply:** Separate eligibility-based event creation from delivery draining. Lease claims, retry bounded failures beyond day four while the trial remains valid, preserve successful per-token deliveries, and keep banner dismissal server-scoped to that trial.