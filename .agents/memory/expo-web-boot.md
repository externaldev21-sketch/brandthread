---
name: Expo web boot & root route
description: Why the mobile app white-screened on web and the invariants that keep boot rendering correctly
---

## The rule
The app must render something visible at every moment of boot, and every AuthGate branch must account for the bare `/` route (empty `segments`).
Keep test and spec modules outside Expo Router's `app/` directory.

**Why:** The web preview showed a stark white screen for signed-in users. Three stacked causes: (1) no `app/index.tsx`, so `/` matched nothing; (2) the entire tree was gated behind `<ClerkLoaded>` with a `null`/blank fallback while clerk-js hotloads from CDN (~1-2s on web); (3) the AuthGate's completed-onboarding redirect only fired from auth screens, so signed-in users at `/` were never redirected — stuck blank forever. Signed-out users redirected fine, which made the bug look intermittent.

**How to apply:**
- `app/index.tsx` renders `components/BootScreen.tsx` (branded dark view); AuthGate redirects away using the `atRoot` check (`!segments[0]`). Any new AuthGate branch must consider `atRoot` — at `/`, `segments[0]` is `undefined`, so all `inXGroup` booleans are false.
- Font gate and `<ClerkLoading>` both render `BootScreen`, never `null`.
- Web body background is painted dark at module scope in `_layout.tsx` (guarded for SSR).
- Put route regression tests in a top-level test directory, never beside route files under `app/`. Expo Router can evaluate those files while building the route graph; a Vitest import outside its runner makes static rendering return HTTP 500.

## Dev preview bypass
Development web previews default to the seller role, seed local onboarding/role state at module scope, and skip the Clerk gate + auth redirects. `?bt_preview=buyer` explicitly switches design review to the buyer role. Group segments are stripped from web URLs (`/(buyer)/discover` → `/discover`); bare `/` redirects to the effective preview role's home.
**Why:** the screenshot browser and canvas iframes are stateless — no Clerk session, no localStorage — so without this, no auth-gated screen can ever be shown or captured outside a tester run.
**How to apply:** use the bare preview URL for seller review and add `?bt_preview=buyer` for buyer review. Screens tied to the Clerk user render fallbacks. The bypass is web + development only and never changes production or native end-user onboarding.

## Debugging gotcha
The Screenshot tool captures web pages before async boot completes (sub-second), so it shows the loading state even when the app works — it cannot observe anything time-based. Use the Playwright testing subagent to watch a page over tens of seconds (console timeline, network failures, final render). Verifying signed-in flows: Clerk programmatic login + seeding localStorage (`onboarding_complete`, `user_role`, `splash_seen`) reproduces any auth/role state.
