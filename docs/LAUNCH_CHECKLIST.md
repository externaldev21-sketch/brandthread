# Launch checklist: App Store review

The goal is that the app passes App Review and Dev only has to connect payments and paste keys.

**Status:** as of 2026-10-17, branch `claude/launch-appstore` (based on `dev`).

**Legend:**

- ✅ Done: verified in code, or fixed on this branch.
- 🟡 Pending in another open PR.
- 🔑 Dev only: needs an account, a key or a decision that a coding session cannot supply.

Deeper references that this file builds on, without repeating them:

- [`docs/launch/app-store-readiness.md`](launch/app-store-readiness.md): the guideline-by-guideline audit.
- [`docs/launch/dev-only-tasks.md`](launch/dev-only-tasks.md): the full list of account tasks.
- [`docs/app-store/release-flow.md`](app-store/release-flow.md): build, submit and environment variables.
- [`docs/app-store/privacy-labels.md`](app-store/privacy-labels.md): the App Privacy answers.
- [`docs/launch/app-store-metadata.md`](launch/app-store-metadata.md): listing copy and reviewer notes.

---

## 1. What Dev must do (in this order)

1. 🔑 **Apple Developer Program.** Enrol (US$99 a year) and accept the agreements. In App Store Connect, complete **Agreements, Tax and Banking**; paid plans and promotions cannot go live until it is done.
2. 🔑 **Create the app** in App Store Connect with bundle ID `com.brandthread.mobile`.
3. 🔑 **Link the EAS project.** In `artifacts/mobile`, run `eas init`. It writes `expo.extra.eas.projectId` into `app.json`. Commit that line. Push tokens and OTA updates both need it (see §5).
4. 🔑 **Fill in `eas.json` → `submit.production.ios`:**
   - `appleId`: your Apple ID email.
   - `ascAppId`: App Store Connect → App Information → Apple ID.
   - `appleTeamId`: developer.apple.com → Membership.

   Then check with `pnpm --filter @workspace/mobile run verify:submit-config`. Today it reports exactly these three placeholders.
5. 🔑 **Paste the production keys.** Nothing secret is in the repo; every key below is read from the environment. Mobile keys go in the expo.dev → Project → Environment variables → `production` environment. Server keys go in the API's production secrets.

   | Where | Variable | What |
   | --- | --- | --- |
   | Mobile (expo.dev, production) | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk production `pk_live_…` |
   | Mobile | `EXPO_PUBLIC_CLERK_PROXY_URL` | Only if the Clerk production instance uses a proxy |
   | Mobile | `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe live publishable key `pk_live_…` |
   | Mobile | `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` / `_ANDROID_API_KEY` | RevenueCat public SDK keys |
   | Mobile | `EXPO_PUBLIC_API_BASE_URL` | Production API origin |
   | Mobile | `EXPO_PUBLIC_SENTRY_DSN` | Turns crash reporting on (§6) |
   | Mobile, visibility **secret** | `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Source-map upload for readable crash stacks |
   | API server | `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` | Clerk production keys |
   | API server | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe live keys and webhook signing secret |
   | API server | `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` | LIVE video and calls |
   | API server | `AGORA_CUSTOMER_ID`, `AGORA_CUSTOMER_SECRET`, `AGORA_RECORDING_*` | LIVE replays (cloud recording) |
   | API server | `REVENUECAT_PROJECT_ID`, `REVENUECAT_WEBHOOK_AUTHORIZATION` | Subscription and promotion webhooks |
   | API server | `APPLE_TEAM_ID` | Needed for universal links (§4) |

   Leave these **unset** in production:
   - `EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST`
   - `EXPO_PUBLIC_ENABLE_TEST_SUBSCRIPTION_BYPASS`
   - `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY`
   - `EXPO_PUBLIC_BT_GROWTH_BYPASS`
   - `EXPO_PUBLIC_DEV_BYPASS_ROLE`
   - `EXPO_PUBLIC_DEV_PREVIEW`
6. 🔑 **Boost and Create-ad purchases (Guideline 3.1.1). This blocks submission.**
   - Paying to promote a post inside the app must go through Apple in-app purchase.
   - The native in-app-purchase path is already built (`lib/iapPromotions.ts`), but it is off until the store products exist.
   - Create the consumables `brandthread_boost_{5,10,25,50,100,250,500}` and `brandthread_ad_{5,10,25,50,100,250,500}` in App Store Connect and RevenueCat.
   - Then set `EXPO_PUBLIC_IAP_PROMOTIONS=1` in the production environment.
   - Without the flag, native Boost and Create-ad still open Stripe Checkout, which App Review rejects.
7. 🔑 **Subscription products.** Create the seller plans in App Store Connect → Subscriptions, matching the RevenueCat product IDs.
8. 🔑 **Build and upload:**
   - `eas build --profile production --platform ios`
   - `eas submit --profile production --platform ios`
   - Or use `pnpm --filter @workspace/mobile run build:testflight`.
9. 🔑 **App Store Connect listing:**
   - **Copy:** paste from `docs/launch/app-store-metadata.md` (name, subtitle, description, keywords, reviewer notes).
   - **App Privacy:** copy `docs/app-store/privacy-labels.md` row by row. There is no API for this.
   - **Age rating:** answer the questionnaire with user-generated content, messaging and live video set to Yes, then 17+.
   - **Privacy Policy URL:** `https://brandthread.app/privacy`.
   - **Support URL:** `https://brandthread.app/help`. Open both in a browser first.
   - **Screenshots:** upload `artifacts/mobile/store-screenshots/framed/iphone-6.7in/*` to the 6.7"/6.9" slot and `framed/iphone-6.1in/*` to the 6.1" slot. Because the app supports iPad, also upload `store-screenshots/ipad-13in/*`.
   - **Demo accounts:** create one buyer and one seller demo account against production and enter them under App Review Information. Steps are in `app-store-metadata.md`.
10. 🔑 **iPad.** `ios.supportsTablet` is `true`. Run `docs/app-store/ipad-release-checklist.md` on a real iPad or simulator before build 1. If there is no time, set it to `false` for 1.0; it cannot be removed after shipping.
11. 🔑 **TestFlight smoke test** on a real iPhone before submitting:
    - sign up with Apple
    - post
    - report a post
    - block a user
    - delete a test account
    - open a `https://brandthread.app/...` link from Notes
    - receive a push notification
12. 🔑 **Submit for review** and stay reachable for Apple's questions.

---

## 2. App Review guideline checklist

| # | Item | Status | Where / what |
| --- | --- | --- | --- |
| 1 | App icon set | ✅ | `assets/images/app-icons/monochrome.png` is 1024×1024 RGB with no alpha, a black glossy B with a silver edge and safe margins. All 11 alternate icons are 1024×1024 with no alpha. |
| 2 | Splash | ✅ fixed | The native splash mark was a blotchy greyscale copy of the logo (black holes where the chrome reflections were). It is now the clean silver B (`brandthread-logo.png`, same art as the in-app mark) on black. See `docs/screenshots/claude-launch-appstore/06-splash.png`. |
| 3 | Android notification icon | ✅ fixed | It pointed at the full-colour `icon.png`, which shows as a solid white square in the Android status bar. Now `assets/images/notification-icon.png` (96×96, white B on transparent). |
| 4 | iOS permission strings | ✅ | All specific, set through plugin config in `app.json`: camera, photo library, save to Photos, microphone, contacts ("only when you choose Find friends … never uploaded"), Face ID. Location: not used, so no string. Notifications: iOS has no usage string; the prompt is contextual (`lib/contextualPushPermission.ts`). |
| 5 | Privacy manifest and required-reason APIs | ✅ | `app.json` → `ios.privacyManifests` declares file timestamp (C617.1), system boot time (35F9.1), disk space (E174.1) and user defaults (CA92.1), plus the collected-data list. `verify:privacy-manifest:config` passes. |
| 6 | App Tracking Transparency | ✅ not needed | `NSPrivacyTracking: false`. The Meta and TikTok pixels are web-only (`lib/marketingPixels.ts`), and there is no IDFA or ATT SDK in the native build. |
| 7 | In-app account deletion (5.1.1(v)) | ✅ | `app/delete-account.tsx`: deletion check, email code, type DELETE, then the server deletes the account. Reached from buyer settings, Account Center and seller settings. |
| 8 | UGC: report, block, filter (1.2) | ✅ fixed | <ul><li>Report and block already existed on posts, comments, DMs, stories, profiles, community chat, `buyer-live` and `live`.</li><li>**Fixed here:** the LIVE swipe feed (`app/live-feed.tsx`) "Report" only showed a toast and sent nothing. It now opens the shared report sheet against the real stream, and the ••• sheet gains **Block [host]**; "Not interested" now actually removes the room.</li><li>**Fixed here:** LIVE replays (`app/live-replay.tsx`) had no report or block at all. Viewers now get a ••• menu with Report replay and Block host.</li><li>Server text filter: `api-server/src/lib/contentModerator.ts`, used by posts, comments, captions, live chat, DMs, communities, reviews and stories. Image moderation: `lib/mediaModeration.ts`.</li></ul> |
| 9 | Terms acceptance at signup (EULA, zero tolerance) | ✅ | `components/legal/LegalConsent.tsx` blocks "Create account" until it is ticked. `LegalAcceptanceGate.tsx` covers Apple/Google sign-up and existing accounts. |
| 10 | Sign in with Apple wherever Google is offered (4.8) | ✅ | `sign-in.tsx`, `onboarding.tsx`, `login-methods.tsx`. `verify:apple-auth` passes. |
| 11 | No placeholder, lorem or demo data in production | ✅ fixed | <ul><li>No lorem anywhere. Sample data is gated by `isPreviewDemoMode()`, which is off in production builds and on production hosts.</li><li>**Fixed here:** `live-cohost.tsx` and `live-cohost-invite.tsx` showed sample co-hosts and invites to anyone opening a `?demo=1` link, including in production. Both now require `isPreviewDemoMode()`.</li></ul> |
| 12 | No dead buttons | ✅ fixed / 🟡 | <ul><li>**Fixed here:** Product launches → "Launched" rows were `onPress={() => {}}`. They now open the product, as Shopify does.</li><li>🟡 Open PRs cover the rest: [#1060](https://github.com/externaldev21-sketch/brandthread/pull/1060) (open-source licenses row, story "More tools") and the design-upload-sketch result buttons that only show an alert (rebuilt in [#1064](https://github.com/externaldev21-sketch/brandthread/pull/1064)).</li></ul> |
| 13 | Terms, Privacy, Community Guidelines | ✅ | `/terms`, `/privacy`, `/community-guidelines`, `/refund-policy`, `/seller-agreement`. Listed in the Legal section of both buyer and seller settings (`services/settingsCatalog.ts`), at signup, on the paywall, and from report screens. |
| 14 | Support and contact | ✅ | `app/help.tsx`: email `support@brandthread.app` and `https://brandthread.app/help`. Abuse contact `safety@brandthread.app` is in the Terms. Reached from both settings menus and the seller menu. |
| 15 | Deep links and universal links | ✅ / 🔑 | <ul><li>Scheme `brandthread://`.</li><li>`associatedDomains`: `applinks:brandthread.app` and `applinks:www.brandthread.app`, plus Android `autoVerify`.</li><li>The association file is served by `api-server/src/routes/wellKnown.ts`.</li><li>🔑 It only lists the app once `APPLE_TEAM_ID` is set on the server, and `brandthread.app/.well-known/apple-app-site-association` must reach that server.</li></ul> |
| 16 | Push registration and EAS projectId | 🟡 / 🔑 | <ul><li>On `dev`, `getExpoPushTokenAsync()` is called with no projectId, and `app.json` has none. Token creation fails on a real device.</li><li>[#1060](https://github.com/externaldev21-sketch/brandthread/pull/1060) reads it from `extra.eas.projectId`, EAS build metadata or `EXPO_PUBLIC_EAS_PROJECT_ID`, and surfaces failures in Settings. Not duplicated here, to avoid a conflict.</li><li>🔑 Dev runs `eas init` (§1.3) and uploads the APNs key when the first build asks.</li></ul> |
| 17 | EAS build profiles and versioning | ✅ | <ul><li>`eas.json` → `production` uses `distribution: store`, channel `production` and Xcode 26 image, with remote `appVersionSource` and `autoIncrement` on the iOS build number and Android version code.</li><li>`app.json` has `version: "1.0.0"` and `runtimeVersion: fingerprint`. The checks `verify:ios-build` and `verify:app-identity` pass.</li></ul> |
| 18 | Crash reporting | ✅ / 🔑 | <ul><li>`@sentry/react-native` starts from `index.ts` before any screen code (`lib/monitoring.ts`). It has no personal data, no screenshots, and query strings are stripped.</li><li>It is a no-op until `EXPO_PUBLIC_SENTRY_DSN` is set (§1.5).</li><li>With `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` above 0, Sentry also records native **App Start** (cold start) times.</li></ul> |
| 19 | Offline and error states | ✅ fixed | <ul><li>`OfflineBanner` and `NetworkNoticeBanner` are mounted app-wide. The network screens checked (drop detail, discounts, post analytics, admin reports, freelancer profile) already show an error state with Try again.</li><li>**Fixed here:** a replay that failed to load said "Couldn't load this replay" with no way out. It now has **Try again**.</li></ul> |
| 20 | Dynamic Type at the largest standard size | ✅ (touched screens) | Text in the screens changed here was scaled to 135% (iOS xxxLarge) and checked for clipping: replay, replay error, LIVE ••• sheet and report sheet. See `docs/screenshots/claude-launch-appstore/05-dynamic-type-xxxl.png`. The app caps text through `lib/dynamicType.ts` (1.3×, 1.6× or 2×) where `AppText` and `Button` are used. |
| 21 | VoiceOver labels on icon-only buttons | ✅ fixed | <ul><li>111 icon-only buttons across 46 files had no `accessibilityLabel`. All now have a specific label, for example "Previous month", "Add colorway" or "Remove photo".</li><li>The only ones left are the 4 fake buttons in `design-upload-sketch.tsx`, which open PR [#1064](https://github.com/externaldev21-sketch/brandthread/pull/1064) rebuilds.</li><li>The baseline `docs/audit/a11y-icon-only-baseline.json` went from 118 unlabeled controls in 50 files to 4 in 1 file, and `tests/a11y-icon-only-lint.test.ts`, red on `dev`, now passes.</li></ul> |
| 22 | Cold start | ✅ measured | <ul><li>Release-like web export, 390×844, buyer feed visible: **2.0 s** median unthrottled and **6.6 s** at 4× CPU throttle (5 runs each).</li><li>Native loads precompiled Hermes bytecode, so it skips JS parsing; measure it on a device in TestFlight with Sentry App Start.</li><li>Heavy SDKs are already lazy: Agora loads on demand (`lib/agoraAvailability.ts`), Skia is gated, and Stripe is not in the root layout.</li><li>Not changed here: Expo's default `inlineRequires: false`. Turning it on in `metro.config.js` is the next cold-start win, but it changes module side-effect order, so try it in a TestFlight build first.</li></ul> |
| 23 | Release-like JS bundle size | ✅ added check | <ul><li>`pnpm --filter @workspace/mobile run check:bundle-size` runs a production `expo export` for iOS and reports the biggest contributors.</li><li>Hermes bundle: **17.1 MB** (7.4 MB gzipped). The check fails above 19 MB.</li><li>Biggest parts: app routes 6.8 MB, components 2.6 MB, react-native 2.0 MB, expo-router 1.2 MB, Agora 1.1 MB.</li><li>`react-dom` (0.5 MB) and `@clerk/clerk-js` come in through Clerk's native SDK, and `css-tree` comes from `react-native-svg`. Neither can be trimmed from app code.</li></ul> |
| 24 | App Store screenshots at 6.7" and 6.1" | ✅ | Rendered from the real app (web build, demo account): `artifacts/mobile/store-screenshots/iphone-6.7in` (1290×2796) and `iphone-6.1in` (1179×2556). Marketing frames are in `store-screenshots/framed/` (feed, product, bag, checkout). Regenerate with `pnpm run screenshots -- --direct --devices iphone-6.7in,iphone-6.1in` then `pnpm run screenshots:frame`. |
| 25 | No secrets in code | ✅ | A grep for live and test Stripe keys, AWS keys, Google API keys and private keys finds none. The only matches are the guard in `api-server/src/lib/appEnv.ts` that refuses live keys on staging. |

---

## 3. Known risks to mention in the reviewer notes

- **Physical goods use Stripe.** That is allowed under 3.1.3(e), because they are goods consumed outside the app.
- **Digital promotions use in-app purchase**, once §1.6 is done.
- **Moderation:**
  - Reports reach a human queue (`admin-reports`) with an SLA (`lib/reportSla.ts`).
  - Text and images are filtered on the server before publishing.
  - Blocking hides both sides' content and stops DMs.
