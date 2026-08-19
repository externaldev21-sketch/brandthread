---
name: Expo root navigation readiness
description: Preventing the mobile web preview from crashing during its first redirect.
---

# Expo root redirects

Do not call `router.replace()` synchronously from the root layout or from its first child effect. For the web preview role, wait until `useRootNavigationState()` has a key and defer the redirect briefly so the root `Stack` registers first.

**Why:** a first-paint redirect can race Expo Router's own navigator mount and trip the “Attempted to navigate before mounting the Root Layout component” error, which is caught by the error boundary as a white screen.

**How to apply:** keep the root layout rendering its navigator unconditionally; put preview redirects in `app/index.tsx`, guard them with the root navigation key, and schedule the replacement after the initial mount.