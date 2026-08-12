---
name: Expo web boot & root route
description: Why the mobile app white-screened on web and the invariants that keep boot rendering correctly
---

## The rule
The app must render something visible at every moment of boot, and every AuthGate branch must account for the bare `/` route (empty `segments`).

**Why:** The web preview showed a stark white screen for signed-in users. Three stacked causes: (1) no `app/index.tsx`, so `/` matched nothing; (2) the entire tree was gated behind `<ClerkLoaded>` with a `null`/blank fallback while clerk-js hotloads from CDN (~1-2s on web); (3) the AuthGate's completed-onboarding redirect only fired from auth screens, so signed-in users at `/` were never redirected — stuck blank forever. Signed-out users redirected fine, which made the bug look intermittent.

**How to apply:**
- `app/index.tsx` renders `components/BootScreen.tsx` (branded dark view); AuthGate redirects away using the `atRoot` check (`!segments[0]`). Any new AuthGate branch must consider `atRoot` — at `/`, `segments[0]` is `undefined`, so all `inXGroup` booleans are false.
- Font gate and `<ClerkLoading>` both render `BootScreen`, never `null`.
- Web body background is painted dark at module scope in `_layout.tsx` (guarded for SSR).

## Debugging gotcha
The Screenshot tool captures web pages before async boot completes (sub-second), so it shows the loading state even when the app works — it cannot observe anything time-based. Use the Playwright testing subagent to watch a page over tens of seconds (console timeline, network failures, final render). Verifying signed-in flows: Clerk programmatic login + seeding localStorage (`onboarding_complete`, `user_role`, `splash_seen`) reproduces any auth/role state.
