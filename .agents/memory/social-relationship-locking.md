---
name: Social relationship locking
description: Concurrency rule for mutations that change follow and block state between two users.
---

Any social mutation that can create, remove, or invalidate a relationship between two users must serialize on the same canonical, unordered pair key. Block eligibility checks must run after acquiring that lock and inside the mutation transaction; a block in either direction prevents a follow.

**Why:** Directional lock keys and pre-lock block checks allow concurrent requests to restore a follow after a block removes both directional relationships.

**How to apply:** When adding pairwise follow, block, or related invalidation mutations, derive the lock from the sorted user IDs and keep the eligibility check plus writes in one transaction.