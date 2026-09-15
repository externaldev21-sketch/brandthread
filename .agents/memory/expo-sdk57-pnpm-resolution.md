---
name: Expo SDK 57 pnpm resolution
description: React declaration resolution constraints for TypeScript 6 in the Expo SDK 57 pnpm workspace
---

With Expo SDK 57 and TypeScript 6 in a pnpm workspace, expose the React and React DOM declaration packages through pnpm public hoisting when TypeScript reports widespread false JSX/type failures from virtual-store package contexts. Do not redirect the runtime `react` package to `@types/react`.

**Why:** TypeScript 6 can fail to discover React declarations consistently across pnpm's isolated virtual-store contexts even when the correct React 19 declarations are installed. Runtime aliasing appears to fix types but breaks Metro because Metro follows runtime package resolution.

**How to apply:** Keep React runtime versions aligned through Expo, public-hoist only the declaration packages, and verify both the mobile TypeScript check and native Metro export after changing pnpm resolution.