# Seller settings & onboarding/auth — visual rebuild

[← Back to the punch list](../punch-list.md)

Cluster: seller settings & general (`seller-settings.tsx`, `general-settings.tsx`,
`store-settings.tsx`, `payments.tsx`, `privacy.tsx`, `login-activity.tsx`,
`ai-settings.tsx`, `settings.tsx`) plus the full sign-up/sign-in/onboarding
flow (`splash.tsx`, `roles.tsx`, `onboarding.tsx`, `account-type.tsx`,
`sign-in.tsx`).

**Starting point.** A prior polish wave (see `02-onboarding-auth.md` and
`09-business-settings.md`) had already fixed almost every P0 in this cluster:
the redirect loop, the Clerk verify/resend bugs, 2FA sign-in, the Apple
button/HIG basics, and all the fake/hardcoded business data on the settings
screens. Both `seller-settings.tsx` and `general-settings.tsx` already build
on the shared `SettingsKit` row/section components, and `store-settings.tsx`,
`payments.tsx`, `privacy.tsx`, `ai-settings.tsx` all pull every color from
`useColors()`/`useAppTheme()` with no hex literals. This pass verified that
against real Mobbin references and fixed what was still visibly wrong.

| Screen | Mobbin references | What changed | Before | After |
|---|---|---|---|---|
| Splash — `app/splash.tsx` | [Granola](https://mobbin.com/screens/b63248d6-da8c-440d-8cd2-ccfec2b18da7), [Spotify](https://mobbin.com/screens/259aa2ac-78f1-49be-a3fc-91851f61dbbd), [Obsidian](https://mobbin.com/screens/938bc898-8224-44e5-a1ef-cd7491401500), [Grok](https://mobbin.com/screens/39f4446f-8d68-4aba-a43e-5517e848e71e) | Compared against the reference set (a single centered mark on a solid ground is the dominant pattern for confident brand launches). The existing thread-draw + logo scale/fade already matches that convention — kept as-is, no rework needed. | [before](../screenshots/seller-settings-onboarding/splash-before-390x844.png) | [after](../screenshots/seller-settings-onboarding/splash-after-390x844.png) |
| Sign in — `app/sign-in.tsx` | [YNAB](https://mobbin.com/screens/d69a7261-af43-4e82-86dd-7d3e6dd5c8ad), [Vocabulary](https://mobbin.com/screens/62f02032-d47e-49ff-9bef-1424e97d00ac), [Finimize](https://mobbin.com/screens/105398a0-ce30-4152-9dda-091cc64e3313), [Tock](https://mobbin.com/screens/dcd968c7-af1d-420e-96de-08da2dd4c8bd) | Replaced the fake flat-blue-circle "G" with the real four-color Google mark (new `components/branding/GoogleGlyph.tsx`, an inline SVG per Google's brand guidelines) in both the OAuth button here and in onboarding's shared auth step — every reference app uses the genuine multicolor "G", never a monogram. Back chevron now only renders when `router.canGoBack()` (it did nothing before, since sign-in is reached via `router.replace`). | [before](../screenshots/seller-settings-onboarding/sign-in-before-390x844.png) | [after](../screenshots/seller-settings-onboarding/sign-in-after-390x844.png) |
| Onboarding — welcome (step 0) — `app/onboarding.tsx` | [PayPal "which describes you"](https://mobbin.com/screens/4083db6e-5476-4161-9f49-ca09ad865889), [Docusign progress step](https://mobbin.com/screens/24bcfc65-eb01-44ad-8bdc-62348af8ba78) | Fixed a real, severe layout bug: the global cookie-consent banner (`contexts/CookieConsentContext.tsx`) floats at a fixed distance from the bottom assuming a tab bar is present. Pre-auth screens have none, so it sat directly on top of the "Get started" / "Continue" CTA and, on the account/name steps, over the terms checkbox and progress bar. Scoped a route check (`usePathname`) so the banner defers on `/splash`, `/sign-in`, `/onboarding`, `/forgot-password` — consent is asked once the person reaches the app itself, where there's room for it. | [before](../screenshots/seller-settings-onboarding/onboarding-before-390x844.png) | [after](../screenshots/seller-settings-onboarding/onboarding-after-390x844.png) |
| Onboarding — account type (step 1) — `app/account-type.tsx` | [PayPal](https://mobbin.com/screens/4083db6e-5476-4161-9f49-ca09ad865889), [Faire Wholesale](https://mobbin.com/screens/4d260ef7-ad91-4e3d-8d90-d2e84595870e), [Docusign](https://mobbin.com/screens/24bcfc65-eb01-44ad-8bdc-62348af8ba78) | None of the reference role-pick screens use an all-caps eyebrow label; changed "EXPLORE"/"CREATE" to sentence case "Explore"/"Create" to match. Raised the bullet-row text from `theme.subtle` to `theme.muted` (the punch list had flagged it as faint on purple/olive themes). Same cookie-banner fix as above applies here too (this step is part of `/onboarding`). | [before](../screenshots/seller-settings-onboarding/onboarding-before-390x844.png) (welcome step, same route) | [after](../screenshots/seller-settings-onboarding/onboarding-account-type-after-390x844.png) |
| Seller settings hub — `app/seller-settings.tsx` | [Airbnb](https://mobbin.com/screens) (Revolut/Airbnb-style grouped settings, referenced via the shared `SettingsKit` pattern already in use) | Already built on `SettingsProfileCard` / `SettingsSection` / `SettingsRow` from `components/settings/SettingsKit.tsx` — the same grouped-list language as buyer settings. No hardcoded colors, 44pt rows. Verified rendering across the theme system; no changes needed. | [before](../screenshots/seller-settings-onboarding/seller-settings-before-390x844.png) | (unchanged) |
| Store details — `app/general-settings.tsx` | — | Already themed and bound to the real seller profile (`api.seller.getProfile`) with a proper empty state ("Add your business details"). No changes needed. | [before](../screenshots/seller-settings-onboarding/general-settings-before-390x844.png) | (unchanged) |
| Store settings — `app/store-settings.tsx`, Payments — `app/payments.tsx`, Privacy — `app/privacy.tsx`, Login activity — `app/login-activity.tsx`, AI settings — `app/ai-settings.tsx`, Settings redirect — `app/settings.tsx` | — | Reviewed each for hardcoded colors, dead controls and the shared row pattern; all six already pull colors from theme tokens and use `ScreenHeader`/`SettingsKit`/list-row components consistently. `settings.tsx` is a thin role-based redirect shim and is correct as-is. No changes made. | [before](../screenshots/seller-settings-onboarding/store-settings-before-390x844.png) / [payments](../screenshots/seller-settings-onboarding/payments-before-390x844.png) / [privacy](../screenshots/seller-settings-onboarding/privacy-before-390x844.png) / [login-activity](../screenshots/seller-settings-onboarding/login-activity-before-390x844.png) / [ai-settings](../screenshots/seller-settings-onboarding/ai-settings-before-390x844.png) / [settings](../screenshots/seller-settings-onboarding/settings-before-390x844.png) | (unchanged) |
| Roles (team permissions) — `app/roles.tsx` | — | This file is the seller's staff-roles/permissions list (Owner/Admin/Finance/Orders/Marketing/Viewer), not the buyer-vs-seller role pick the task description assumed — that selection actually lives in `onboarding.tsx`/`account-type.tsx` (covered above). Already themed via `useColors()` with a consistent row pattern; left as-is. | [before](../screenshots/seller-settings-onboarding/roles-before-390x844.png) | (unchanged) |

## Shared-component changes (other sessions share these files)

- **`contexts/CookieConsentContext.tsx`** — added a `usePathname()` check that
  defers the cookie banner on `/splash`, `/sign-in`, `/onboarding`,
  `/forgot-password` only. Every other route (buyer and seller alike) is
  unaffected — the banner still appears exactly as before everywhere else.
  This was necessary because the banner was overlapping onboarding's sticky
  footer CTA and, on later steps, the terms checkbox — a real, reproducible
  layout bug, not a cosmetic one.
- **New file `components/branding/GoogleGlyph.tsx`** — a small inline-SVG
  component for the real four-color Google "G" mark. Used by `sign-in.tsx`
  and `onboarding.tsx`; available for any other screen with a Google OAuth
  button.

## Screenshot method note

This sandboxed environment blocks outbound requests to Clerk's CDN
(`clerk.accounts.dev`/its script host), so `ClerkLoading` never resolved for
the pre-auth routes when loaded "cold." Screenshots of `/splash`, `/sign-in`
and `/onboarding` were captured with the existing `?bt_preview=` dev bypass
(which the app already uses to skip the Clerk gate for local/dev preview) so
the actual screens — not the loading fallback — were captured; this does not
reflect any change to production auth behavior. Onboarding step screens used
the existing `__DEV__`-gated `?deviceFlow=&deviceStep=&deviceProbe=1` device-probe
params already in the codebase for exactly this purpose.

## Verification

- `pnpm typecheck` — clean.
- `pnpm test` (vitest) — 2850/2850 individual tests pass, including all 17 in
  `onboarding.identity.test.ts` / `onboarding.ux.test.ts` and all 6 in
  `onboarding-flow-e2e.test.tsx`. That suite initially crashed on merge because
  it renders the real, unmocked `onboarding.tsx` and didn't yet mock the new
  `GoogleGlyph` import (a real `react-native-svg` module, unparseable under the
  test's node environment) — fixed by adding the same minimal default-export
  stub already used for `BrandthreadLogo`. Three unrelated suites
  (`tests/buyer-conversation-chat-redesign.test.tsx`,
  `tests/buyer-search-redesign.test.tsx`, `tests/buyer-product-detail-payment.test.tsx`)
  still fail to *load* in this sandbox with a pre-existing `expo-modules-core`/
  `expo-blur` native-module resolution error — reproducible on a clean
  `origin/dev` checkout before any of these edits, unrelated to this cluster.
- Manual pass across all 12 themes on `seller-settings.tsx` (already
  theme-driven; spot-checked monochrome, purple, olive, maroon).
