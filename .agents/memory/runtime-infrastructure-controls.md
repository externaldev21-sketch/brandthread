---
name: Runtime infrastructure controls
description: Durable compatibility, feature-flag, offline-cache, and application-rate-limit boundaries.
---

Current mobile clients use the versioned API contract. The unversioned API remains a compatibility alias for installed older builds until its announced sunset; never make a breaking change to that alias in place.

**Why:** App-store adoption is gradual, so backend deployments must not force every installed client to update at once.

**How to apply:** Put breaking contracts in a new API version. Keep the prior version stable through its published support window.

Remote feature flags default to their last cached value, then to the shipped safe default when no cache exists. Flag-service failure must not blank or deadlock app startup.

**Why:** Runtime controls are an operational safety mechanism, not a new availability dependency.

**How to apply:** Gate complete features at navigation or capability boundaries and keep defaults explicit in the shipped client.

Persistent API response caches must be partitioned by Clerk user and active store context. Never serve one account's cached private response to another active session, and never use cached data to mask authorization failures.

**Why:** Clerk can switch active sessions without remounting the app, while offline content must still remain useful and private.

**How to apply:** Fall back only for transport failures and server unavailability; invalidate the active scope after mutations and clear the prior scope during account switches.

Application rate limits are identity-aware defense in depth. Authenticated traffic is keyed by user, anonymous traffic by trusted-proxy IP, expensive generation routes are stricter, and webhooks/health checks are exempt.

**Why:** Generic per-IP limits punish shared networks and do not protect costly endpoints proportionally; network-level DDoS protection remains a separate edge-service responsibility.

**How to apply:** Add route-specific limits only when they are stricter than the shared baseline, return Retry-After, and preserve the common API error envelope.