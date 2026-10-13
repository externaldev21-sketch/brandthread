---
name: Native UI test harness
description: Distinguishing incomplete UI mocks from real loading and native-component failures after merges.
---

Keep mocked cache clients stable and implement the methods exercised by the current screen. Keep native animation mocks aligned with the shared components the screen actually renders. Audit all directly mocked dependencies before repeatedly running a newly merged screen test; the first missing export can hide many later setup failures.

**Why:** An incomplete client mock caused a caught product-load failure that first appeared as a missing size control. Incomplete animation mocks then produced false native-component errors as the same test began rendering the shared sheets. Later merged-screen tests exposed cascading cache, media and lifecycle mock omissions before any behavioral assertion ran.

**How to apply:** When a renderer test unexpectedly loses controls after a merge, inspect the caught load path and mock contracts before changing product behavior. Preserve behavioral assertions and use the canonical shared component rather than restoring an obsolete inline layout to satisfy a test.
