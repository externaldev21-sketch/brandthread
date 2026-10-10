---
name: Native release fixtures
description: Security and lifecycle boundaries for native release-runner test accounts and injected API failures.
---

Native release checks should keep setup, failure arming, and cleanup in repository-owned utilities shared by every platform. Runner configuration supplies only credentials, service origins, and control tokens.

**Why:** Platform-specific shell commands drift and can leave test identities, sessions, or seeded data behind. Test failure injection also needs to be narrow enough that it cannot affect unrelated buyers.

**How to apply:** Create or reset an isolated identity, seed deterministic data, and store one-shot failure claims durably so autoscaled replicas consume them atomically. Run cleanup in a finally path that removes data and revokes sessions. Keep control endpoints unavailable without a server-side token.