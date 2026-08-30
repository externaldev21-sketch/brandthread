---
name: Expo native prebuild guards
description: Where release-critical validation must run so direct Expo native prebuilds cannot bypass it.
---

Release-critical native configuration invariants must run from an Expo config plugin. Package scripts may provide convenient wrappers and EAS hooks may protect cloud builds, but neither replaces config-time validation.

**Why:** A package script named `prebuild` is a package-manager lifecycle hook; invoking `expo prebuild` directly does not execute it. Expo config plugins run while Expo resolves configuration for native generation, so they cover direct local prebuilds as well as managed build flows.

**How to apply:** Put checks that must block every native project generation in a local config plugin registered in the Expo config. Keep explicit package and EAS hooks only as earlier, clearer failure points.