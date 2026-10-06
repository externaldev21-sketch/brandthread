---
name: Expo root navigation readiness
description: Preventing the mobile web preview from crashing during its first redirect.
---

# Expo root redirects

Root Stack screen names must be unique after a merge, including when an older report is preserved alongside its replacement.

**Why:** Typechecking can pass with duplicate registrations, but Expo Router then throws before any screen renders. The actual preview caught this when the combined reports registered the same name twice.

**How to apply:** Check registration uniqueness after navigation merges and verify a real first render, not only TypeScript. Give preserved capabilities their own route rather than duplicating the replacement route.

Do not call `router.replace()` synchronously from the root layout or from its first child effect. For the web preview role, wait until `useRootNavigationState()` has a key and defer the redirect briefly so the root `Stack` registers first.

**Why:** a first-paint redirect can race Expo Router's own navigator mount and trip the “Attempted to navigate before mounting the Root Layout component” error, which is caught by the error boundary as a white screen.

**How to apply:** keep the root layout rendering its navigator unconditionally; put preview redirects in `app/index.tsx`, guard them with the root navigation key, and schedule the replacement after the initial mount.

The delayed redirect is not proof that an index route is still active: during web tab transitions, the root path may briefly reappear and a preview redirect can send the user back Home. A browser pathname check before or inside the timer did not eliminate this race. Also, adding navigation-focus hooks directly to the root Index rendered through the custom scene wrapper caused a missing navigation-context error.

**Why:** buyer preview navigation from Profile to Messages reached Inbox, then returned Home despite URL guards; a focus-hook attempt instead rendered an error screen and was reverted.

**How to apply:** when changing preview redirects, use a route-state signal from a component known to have navigation context, or a root-owned transition guard. Verify by navigating between preview screens after startup, not only by loading routes directly.