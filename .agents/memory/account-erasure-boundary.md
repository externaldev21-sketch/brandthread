---
name: Account erasure boundary
description: Durable rules for permanent self-service Brandthread account deletion.
---

Permanent deletion must erase private, device, profile, and social data while anonymizing commerce records that must remain for payment, tax, dispute, or order-history integrity. Keep a non-personal deleted-account tombstone keyed to the original auth subject so delayed sync requests cannot recreate the profile.

**Why:** Removing only the auth account can orphan personal data, while deleting all financial rows can corrupt legally required records. A tombstone also prevents old authenticated clients from silently reprovisioning an erased account.

**How to apply:** Commit database cleanup first, then delete the Clerk user. Make retries idempotent, require an exact destructive confirmation, and expose the same working in-app flow to buyer and seller accounts.