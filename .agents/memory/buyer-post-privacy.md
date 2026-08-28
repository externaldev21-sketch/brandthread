---
name: Buyer post privacy
description: Authorization rule for buyer profile posts while post visibility is not represented in the database.
---

Buyer profile posts must be returned only to their author or a mutual follow (friend). Do not label or treat buyer posts as public without a stored, enforceable visibility value.

**Why:** The posts table does not currently preserve buyer profile visibility. Inferring public visibility would disclose future private buyer content to any authenticated user.

**How to apply:** Enforce self-or-mutual-follow authorization on buyer profile post reads. If public or friends-only choices are added, persist visibility and enforce it server-side before loosening this rule.