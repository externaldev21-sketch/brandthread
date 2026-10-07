---
name: Expo platform modules in Vitest
description: How to keep Expo platform-specific modules importable in Vitest renderer tests.
---

Vitest does not apply Metro's `.native` and `.web` suffix resolution when a screen imports a suffix-only module through its neutral path. Keep a neutral fallback module for those imports when renderer tests load the screen directly.

**Why:** Declaring the unresolved path as a virtual Vitest mock did not prevent Vite from resolving the screen import first, so the suite failed before mocks ran.

Expo Router can also try to bundle test files placed under `app/`, which imports Vitest into the running application. Metro's block list must exclude `*.test.ts(x)` files while Vitest remains configured to discover them.

**How to apply:** When adding renderer coverage for a screen that imports a suffix-only Expo module, preserve the native and web implementations and add a neutral tooling fallback rather than changing runtime imports to one platform. Keep test files blocked from Metro even if existing tests live under the route tree.

Externalized native SDK packages may load React Native through Node's own resolver, bypassing a Vite alias for `react-native`. Renderer tests should isolate the SDK/OS boundary as well as the host primitives, and retain new exports when partially mocking shared UI modules.

**Why:** A root React Native alias alone still allowed Expo native globals and Flow syntax to prevent suite collection; sparse mocks also hid newly shared components.

**How to apply:** Use test-only boundary implementations or explicit provider mocks. Keep production Metro resolution untouched and continue testing real screen logic.

Distinct SDK namespaces need distinct resolved module identities in Vitest, even when their test boundaries share implementation.

**Why:** Aliasing gradient, blur, and video packages to one file made a mock for blur overwrite gradient exports. Vitest then reported a missing gradient export on the blur module, obscuring the actual cause.

**How to apply:** Share implementation through re-exports from separate boundary modules. When an error names an unrelated package, check alias target collisions before adding exports or changing app imports.

Order subpath aliases before a package's bare-name alias.

**Why:** Vite's first matching prefix can redirect a navigation subpath to a nonexistent path inside the bare-package shim, turning previously working renderer tests into collection errors.

**How to apply:** Keep specific subpaths ahead of broader aliases; isolate native router/browser boundaries without changing Metro's production resolution.