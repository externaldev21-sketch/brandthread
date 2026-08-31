---
name: Expo React types under pnpm
description: Why mobile TypeScript must explicitly resolve React declarations in this pnpm workspace.
---

The mobile TypeScript config must expose the mobile package's installed React declarations through `typeRoots`; never map the runtime module name `react` to `@types/react` in `compilerOptions.paths`.

**Why:** With pnpm's isolated dependency layout, TypeScript may otherwise report false JSX component errors. But Expo Metro also consumes TypeScript aliases: mapping `react` to declarations makes Metro try to execute `@types/react/index`, causing a web bundle failure even while `tsc` passes.

**How to apply:** Keep `typeRoots` pointed at the mobile package's `node_modules/@types` and reserve `paths` for real runtime modules. After dependency relinks, verify both `tsc` and an Expo web bundle before editing screens or suppressing type checks.