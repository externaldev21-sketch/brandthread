---
name: Expo Router test placement
description: Why mobile Vitest files must live outside the Expo Router app directory.
---

Keep Vitest files outside the Expo Router `app/` route tree, even when the test targets one screen.

**Why:** Expo Router's generated context can import files matching test suffixes as routes during web bundling. Vitest mocks then execute without a Vitest runtime and the preview fails before the app renders.

**How to apply:** Put screen regression tests in a non-route directory such as `lib/` and import the screen from there. Treat any existing tests under `app/` as a preview reliability issue rather than a pattern to copy.