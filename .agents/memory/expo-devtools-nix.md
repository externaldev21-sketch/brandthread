---
name: Expo DevTools on Nix
description: Distinguish an optional debugger launch failure from a broken Metro workflow.
---

Expo may log that installing React Native DevTools failed because the debugger-shell binary cannot load `libglib-2.0.so.0`, while Metro remains running and the app's web preview renders.

**Why:** This warning appeared during a managed Expo restart despite successful dependency validation, bundling, and an interactive buyer-feed preview without browser errors.

**How to apply:** Check the workflow state and load the actual preview before treating this DevTools message as an app startup failure. Do not change app dependencies solely because the optional debugger cannot start.