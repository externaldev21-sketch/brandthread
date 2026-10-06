---
name: Shared performance boundaries
description: Non-obvious cache, animation and development-preview costs found while profiling app-wide lag.
---

App-wide responsiveness applies to both buyer and seller navigation, not just Store Builder. Measure shared-shell work and first visits separately from warm repeat navigation.

**Why:** The owner clarified that the lag affected “the whole entire app” and “Every screen”; a store-only pass did not address that scope.

Throttling a TanStack async-storage persister does not throttle the cache dehydration that occurs before its storage callback. Bulk per-detail cache writes can repeatedly traverse the whole cache.

**Why:** Warming hundreds of order-detail entries on every list visit caused a substantial synchronous navigation stall despite the storage throttle.

**How to apply:** Keep list snapshots account-owned; seed only selected detail records when possible. Preserve immediate detail rendering and reject snapshots from a previous identity.

Frozen retained screens do not reliably run React effect cleanup immediately on blur. Infinite loading animations must stop through an imperative navigation blur listener, and decorative loops must not hold interaction handles that delay virtualized-list work.

**Why:** React freezing prevents renders, not already-running animation work.

**How to apply:** Stop loops on blur, create a fresh loop on focus, and also clean up on unmount. Keep boot UI outside navigation supported.

Capture development console errors as well as page exceptions during performance tests. React invalid nested-button warnings can create an Expo error overlay that intercepts subsequent navigation taps even without a page exception. Repeated locale formatting in large list grouping can also dominate CPU and garbage collection; reuse formatters and format per bucket rather than per record.

**Why:** Browser profiling distinguished these preview-specific costs from network latency.
