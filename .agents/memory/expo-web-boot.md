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
The bare development web preview opens a synthetic Demo Seller session with populated seller dashboard data. `?bt_preview=buyer` switches to Demo Buyer, and the dev-only account switcher exposes both identities. Onboarding remains intact but is not the default preview entry.
**Why:** the owner wants Replit’s phone-frame preview optimized for reviewing populated seller screens without repeating authentication or onboarding.
**How to apply:** use the bare preview URL for seller review and `?bt_preview=buyer` for buyer review. Keep the bypass, synthetic identities, and demo financial values limited to development web; native/device and production users must retain real auth and onboarding.

The dev-web account switcher's selected demo side must survive Expo Router removing query parameters and browser reloads, scoped to the current browser tab. This is preview navigation, not a Clerk account switch.
**Why:** clicking Demo Buyer opened the buyer home, but the root redirect dropped the query; reloading silently returned to Demo Seller.
**How to apply:** explicit preview URLs override the tab's selection, and seller/buyer preview detection, root redirects, and displayed account state must all resolve the same selected role.

Opening the demo account chooser from the buyer profile should use a full preview-only navigation rather than a client-side push; keep real accounts on normal in-app navigation.
**Why:** early preview navigation can be reset to buyer home while Clerk finishes loading, hiding the chooser before Demo Seller can be tapped. Direct chooser loads remain stable during that startup window.
**How to apply:** preserve the buyer preview URL when entering the chooser, then let the selected demo row navigate to its chosen side; do not treat demo rows as real Clerk sessions.

Authenticated seller tools cannot treat this navigation bypass as a real Clerk session. In dev web seller preview, mount the actual seller screens, using their own zero/default states and skipping protected API calls. Do not replace routes with generic sign-in or “nothing here yet” screens; keep uploads, writes, checkout, and activation behind real authentication.

**Why:** paid promotion screens entered generic error states because the preview bypass opened them without a token, so every protected request returned 401. Async-only fallbacks also flashed or remained on loading states during direct web captures. The owner explicitly rejected route-wide preview placeholders because they blocked navigation despite removing sign-in prompts.

**How to apply:** derive preview role from route parameters so SSR and the first client frame agree. Use clearly labeled, non-financial preview fixtures only for reviewing UI; never fake successful writes, payments, entitlement, delivery, or activation.

## Debugging gotcha
The Screenshot tool captures web pages before async boot completes (sub-second), so it shows the loading state even when the app works — it cannot observe anything time-based. Use the Playwright testing subagent to watch a page over tens of seconds (console timeline, network failures, final render). Verifying signed-in flows: Clerk programmatic login + seeding localStorage (`onboarding_complete`, `user_role`, `splash_seen`) reproduces any auth/role state.
