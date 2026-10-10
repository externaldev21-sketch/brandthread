---
name: Seller trial reminder delivery
description: Timing, copy, retry, preference, and deduplication rules for seller trial reminders
---

**Rule:** Trial copy and reminder timing must follow the server-authoritative plan configuration, not restore legacy five-day UI copy. Use exact end-date and truthful feature-loss copy; never infer usage. Respect trial-reminder preferences and digest mode.

**Why:** Approved catalogue changes can leave old client trial copy behind. Worker crashes, partial multi-device push failures, and late-day retries can also lose reminders or send duplicates. Generic urgency claims damage trust when their timing is inaccurate.

**How to apply:** Separate eligibility-based event creation from delivery draining. Lease claims, retry bounded failures while the trial remains valid, preserve successful per-token deliveries, and keep banner dismissal server-scoped to that trial.