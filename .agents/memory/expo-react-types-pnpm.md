---
name: Expo React types under pnpm
description: Why mobile TypeScript must explicitly resolve React declarations in this pnpm workspace.
---

The mobile TypeScript config must map the exact `react` module name to the mobile package's installed React type declarations. Keep the normal runtime import unchanged.

**Why:** With pnpm's isolated dependency layout, app source can find React types through the mobile package while declaration files inside Expo and React Native packages may resolve only React's JavaScript entry. TypeScript then reports hundreds of false JSX class-component errors such as missing `props`, even though the real screen-level types are valid.

**How to apply:** Preserve the exact `react` path mapping when changing mobile TypeScript or workspace dependency resolution. If widespread TS2607/TS2786 errors suddenly affect Expo components, verify dependency declarations resolve to the same React types before editing individual screens or suppressing checks.