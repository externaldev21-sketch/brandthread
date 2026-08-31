---
name: Expo platform modules in Vitest
description: How to keep Expo platform-specific modules importable in Vitest renderer tests.
---

Vitest does not apply Metro's `.native` and `.web` suffix resolution when a screen imports a suffix-only module through its neutral path. Keep a neutral fallback module for those imports when renderer tests load the screen directly.

**Why:** Declaring the unresolved path as a virtual Vitest mock did not prevent Vite from resolving the screen import first, so the suite failed before mocks ran.

Expo Router can also try to bundle test files placed under `app/`, which imports Vitest into the running application. Metro's block list must exclude `*.test.ts(x)` files while Vitest remains configured to discover them.

**How to apply:** When adding renderer coverage for a screen that imports a suffix-only Expo module, preserve the native and web implementations and add a neutral tooling fallback rather than changing runtime imports to one platform. Keep test files blocked from Metro even if existing tests live under the route tree.