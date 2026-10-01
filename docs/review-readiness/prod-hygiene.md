# Production hygiene and dead-UI audit

Scope: `artifacts/mobile`. Goal: dev/test affordances are compiled out of
production native builds and stay available in dev and the web preview; no
placeholder copy, dead buttons or broken links ship.

## Policy (one helper)

`artifacts/mobile/lib/buildFlags.ts` is the single source of truth.

| Flag | Definition | Production native | Dev / web preview |
|---|---|---|---|
| `IS_PROD_NATIVE` | `!__DEV__ && EXPO_OS is ios/android` | true | false |
| `NAVIGATION_ISOLATION_TEST` | `!IS_PROD_NATIVE && env EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST==='1'` | false (even if env leaked) | per env (web export used by screenshot/e2e harness) |
| `ALLOW_DEV_TOOLS` | `__DEV__ \|\| NAVIGATION_ISOLATION_TEST` | false | true |
| `ENABLE_TEST_SUBSCRIPTION_BYPASS` | `__DEV__ && env ...=== 'true'` | false | dev only |
| `REVENUECAT_TEST_API_KEY` | `__DEV__ ? env : undefined` | undefined | dev only |
| `GROWTH_UI_BYPASS` | `__DEV__ \|\| (!IS_PROD_NATIVE && env EXPO_PUBLIC_BT_GROWTH_BYPASS==='1')` | false | dev / opt-in |

`process.env.EXPO_OS` and `__DEV__` are inlined per platform by the Expo babel
preset, so these fold to literals and Metro's minifier drops the guarded
branches. The web preview remains refused on the real production hosts by
`isProductionPreviewHost()` (`lib/devPreview.ts`, unchanged).

`babel.config.js` adds `babel-plugin-transform-remove-console` (keeps `warn`
and `error`) only when the Metro caller is a non-web, non-dev bundle. Verified
with the real plugin config: ios/android release strip `console.log`; ios dev,
web (dev or export) keep it; warn/error always kept. New devDependency:
`babel-plugin-transform-remove-console` (lockfile updated).

## CI guards

- `tests/prod-gate-guard.test.ts` (vitest): fails if any of the gated
  `EXPO_PUBLIC_*` vars is referenced outside `lib/buildFlags.ts` (the one
  exception, `lib/devBypass.ts`, must stay `__DEV__ &&`), and if a
  `bt_preview` / `demo` / `bt_theme` / `bt_capture` / `bt_call` query param is
  read by a file that has no dev gate.
- `scripts/audit-dead-ui.mjs` (`pnpm --filter mobile run audit:dead-ui`):
  static crawler. Verifies every `router.push/replace/navigate/dismissTo`,
  `href`, `pathname` target resolves to a file under `app/` (expo-router
  groups and dynamic segments handled), flags no-op `onPress`, TODO/lorem/
  "coming soon"/placeholder copy, malformed `mailto:`/`tel:`, and lists all
  hard-coded external URLs (HEAD checks are not possible offline). Intentional
  cases live in `scripts/audit-dead-ui.allowlist.json` with a reason each.
  Complements the runtime Playwright `scripts/audit/half-done-audit.mjs`
  (reused, not duplicated).
- `scripts/text-fit-check.mjs` (`pnpm --filter mobile run check:text-fit`):
  reusable Playwright check at 393x852 on the existing demo web harness.
  Flags truncated text, text overflowing its parent, text off the viewport,
  tight button/chip padding, and unequal sibling buttons.

Verification status (what was and was not run):
- Ran: vitest guard + suites for touched code, `tsc --noEmit`, dead-UI crawler
  `--ci` (exit 0), babel console-strip matrix.
- Ran: `expo export --platform web` of this branch finished; `text-fit-check.mjs`
  ran at 393x852 on `/inbox` (buyer, demo data) and `/help`, `/general-settings`,
  `/manufacturer-messages` (seller, demo data). Screenshots are in
  `docs/pr-assets/claude-review-ready-prod-hygiene/`.
- Not possible: a screenshot of the manufacturer chat header with call buttons.
  The demo data has no seeded manufacturer thread, so the screen renders its
  "Conversation unavailable" state. The call-button change is therefore verified
  by typecheck/tests only.
- Full vitest on clean origin/dev: 32 failing files. On this branch: see PR body
  for the final comparison.

Text-fit findings on existing screens (not touched, other areas): `/help` category
grid "Feature" text box extends past 393px; `/inbox` Notes bubble "Your thoughts go
here..." is truncated and overflows; `/inbox` empty-state "Send a message" button
has 0px text padding (a padding-only fix was tried and rejected: it dropped the
button's rounded corners); manufacturer-chat error-state "Try again" has 1px padding.

## Findings and dispositions

### Production gating

| Item | Status | Evidence |
|---|---|---|
| `bt_preview` / `&demo=1` / `bt_theme` web preview | PASS (already `__DEV__`/export-flag + production host gated; now routed through helper) | `lib/devPreview.ts`, `app/_layout.tsx`, `contexts/AppThemeContext.tsx` |
| `EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST` | FIXED: centralised, hard-false on production native even if leaked | `lib/buildFlags.ts` |
| `navigation-isolation-probe` route reachable by deep link in production | FIXED: redirects to `/` unless flag set | `app/navigation-isolation-probe.tsx` (was docs/polish P1) |
| `EXPO_PUBLIC_ENABLE_TEST_SUBSCRIPTION_BYPASS` | FIXED: moved into helper, `__DEV__ &&` | `hooks/useSubscriptionPlan.ts` |
| RevenueCat test key | FIXED: read only in helper under `__DEV__` | `lib/revenueCat.native.tsx` |
| `EXPO_PUBLIC_BT_GROWTH_BYPASS` | FIXED: can no longer take effect in a production native bundle (UI only; server is the gate) | `lib/growthTools.ts` |
| `EXPO_PUBLIC_DEV_BYPASS_ROLE` | PASS (`__DEV__ &&`), guarded by test | `lib/devBypass.ts` |
| Upload-pill / theme test bridges (`window.__bt*`) | FIXED: via `ALLOW_DEV_TOOLS` | `components/feed/UploadProgressPill.tsx`, `contexts/AppThemeContext.tsx` |
| Voice "View transcription" shows "placeholder text standing in for speech-to-text" | FIXED: action hidden unless `ALLOW_DEV_TOOLS` (no STT service exists) | `app/buyer-conversation.tsx`, `app/seller-conversation.tsx` |
| Mock/seed data (`lib/preview*.ts`) | PASS by design: only reachable through `isPreviewDemoMode()` / `isPreviewInboxEnabled()` which require the gates above; exercised by `socialService.noDemoData.test.ts` and the half-done audit fresh-vs-demo states | `lib/devPreview.ts` |
| Debug console logs | FIXED at build time: only one `console.log` in shipped source (`lib/perf.ts`), plus any dependency-free stripping by the babel plugin for production native | `babel.config.js` |

### Dead UI, placeholders, links

| Finding | Disposition |
|---|---|
| Buyer inbox filter pill shows "Message filters — coming soon" | FINDING, left as is: `tests/messages-action-sheet-web.test.ts` pins the snackbar, and Dev's additive-only rule applies. Allowlisted in the crawler. Dev decides what the filter should do |
| Manufacturer chat: call buttons opened a "calls are coming soon" dialog when calling is unavailable | FIXED: buttons render only when the server reports calling available; dialog removed (touches existing UI) |
| Settings > Favorites intro "coming soon" | FIXED: copy now "Follow sellers and brands to see more from them in Discover." |
| Store policy fallback "Content coming soon." | FIXED: "Please contact us for details." |
| Order detail pre-order manufacturer "TBD" | FIXED: "Not assigned yet" |
| General Settings "Change log" -> brandthread.app/changelog (no such page) | FINDING for Dev: row kept unchanged (nothing existing removed). Needs a real page or Dev's decision to drop the row |
| General Settings "Brandthread Help Center" -> web URL | FIXED: routes to `/help` |
| General Settings "Hire a Brandthread Partner" -> brandthread.app/partners (no page) | FIXED: routes to `/freelancer-jobs` (Hiring tab) |
| Help "Live Chat" -> brandthread.app/chat (no such page; no live chat exists) | FIXED target only: label kept, now scrolls to the existing support message form |
| Route targets (`router.*`, `href`) | PASS: all resolve to an existing file (2 template routes with a whole dynamic segment in `app/_layout.tsx` are unverifiable statically and are restricted to `/(buyer)/` and `/(tabs)/` prefixes) |
| `onPress={() => {}}` (8 hits) | PASS: event-swallowing sheet bodies, a disabled progress button, and disabled buyer-preview CTAs. Allowlisted with reasons |
| `mailto:`/`tel:` | PASS (`support@brandthread.app`; share sheet uses an intentionally empty recipient) |
| "Additional tools are coming soon." alert | OWNER-ACTION: `app/buyer-story-create.tsx` belongs to the create-flow session, not touched |
| "Sound library coming soon." | OWNER-ACTION: `app/create-post.tsx` belongs to the create-flow session, not touched |
| Locked drop label "COMING SOON" | PASS: real upcoming-drop state, not a placeholder |
| External URLs (31) | LISTED (run `node scripts/audit-dead-ui.mjs`). Live ones: `brandthread.app` (share links, `/help`), stripe.com/privacy, dashboard.stripe.com/tax, help.klaviyo.com article. Not HEAD-checked (offline). Others are input placeholders, preview fixtures or Google Fonts/CDN hosts. `brandthread.app/help` ("Full Docs" on the Help screen) needs Dev to confirm it loads on the deployed site |

## What Dev must do

- Confirm the production EAS environment leaves the four test env vars unset
  (`docs/app-store/release-flow.md`); the code now also ignores them on native
  release builds.
- HEAD-check the external URLs list from a networked machine, in particular
  `https://brandthread.app/help`.
- Decide the two create-flow "coming soon" strings with that session.
