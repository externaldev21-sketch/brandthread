# Launch checklist for the owner

This is the plain-English list of things only you (the account owner) can
do — accounts, payments and legal identity that no session in this
workspace is allowed to create on your behalf. Nothing here has been done
for you yet. Everything else (app config, build profiles, deep links,
share previews, tablet layout, accessibility, crash reporting hook, API
hardening) has already been wired up in code and just needs these
accounts plugged in.

Target: App Store + Play Store launch readiness for iPhone, Android,
iPad, Android tablets, and the web app at brandthread.app.

## 1. Apple Developer account

- [ ] Enroll at https://developer.apple.com/programs/ (individual or
      organization — organization requires a D-U-N-S number, so start that
      early if you don't already have one).
- [ ] Once approved, find your **Apple Team ID** at
      https://developer.apple.com/account under Membership.
- [ ] Create an App Store Connect app record for bundle ID
      `com.brandthread.mobile` at https://appstoreconnect.apple.com — note
      the **App Store Connect App ID** (a numeric id, e.g. `1234567890`).
- [ ] Give us (or set as env vars / EAS secrets, see §4 and §5) three
      values: your Apple ID email, the App Store Connect App ID, and the
      Apple Team ID. These go into `eas.json`'s `submit.production.ios`
      block (currently placeholders `REPLACE_WITH_APPLE_ID_EMAIL`,
      `REPLACE_WITH_APP_STORE_CONNECT_APP_ID`, `REPLACE_WITH_APPLE_TEAM_ID`)
      and into the `APPLE_TEAM_ID` env var the API server uses to generate
      `apple-app-site-association` (see §7).
- [ ] Enable "Sign in with Apple" capability for the app identifier
      `com.brandthread.mobile` in the Apple Developer portal (the app
      already requests this entitlement; it will fail App Review without
      it enabled on the identifier).

## 2. Google Play Developer account

- [ ] Enroll at https://play.google.com/console/signup (one-time $25 fee).
- [ ] Create the app in Play Console with package name
      `com.brandthread.mobile`.
- [ ] Set up an internal testing track (Play Console → Testing → Internal
      testing) — this is what lets you send test builds to friends.
- [ ] Once you've done your first upload (even a draft), get your app's
      signing certificate SHA-256 fingerprint from Play Console → Setup →
      App integrity. You'll need this for Android App Links (§7).

## 3. EAS (Expo Application Services) login

- [ ] Create an Expo account at https://expo.dev/signup if you don't have
      one, and make sure it's linked to this project.
- [ ] From `artifacts/mobile`, run `eas login` once on whatever machine
      does the actual builds/submits, then `eas init` if the project isn't
      already linked (this writes `extra.eas.projectId` into `app.json`,
      which is what OTA updates and build profiles key off of).
- [ ] EAS builds need your Apple/Google credentials at build+submit time.
      Either let `eas build`/`eas submit` prompt you interactively the
      first time (it stores credentials in EAS's secure credential store),
      or set them up via `eas credentials`.

## 4. Build profiles — what's already set up

`eas.json` has three profiles:

- **development** — internal distribution, includes the dev client.
- **preview** — internal distribution (APK for Android, ad-hoc/TestFlight
  build for iOS) so you can send test builds to friends without going
  through App Store/Play review. Run:
  ```sh
  eas build --profile preview --platform all
  ```
  For iOS, an internal build still needs to go through TestFlight
  internal testing (Apple doesn't support ad-hoc install links the way
  Android APKs work) — `eas submit --profile preview` after the build, or
  use `pnpm run build:testflight`.
- **production** — store distribution, auto-incrementing build
  number/version code, ready for `eas submit --profile production` once
  §1/§2 are filled in.

Nothing here creates a paid account or submits anything automatically —
every `eas build`/`eas submit` command above is something you run
yourself when ready.

## 5. OTA updates (expo-updates)

Runtime version policy is `fingerprint` (already configured), so an OTA
update only reaches builds whose native code (Expo SDK/config/plugins)
hasn't changed — no separate manual bump needed for JS-only changes.
Channels (`development`/`preview`/`production`) already match the build
profiles above. To publish an update once you're building for real:

```sh
pnpm run update:preview      # ships to the preview channel
pnpm run update:production   # ships to production
```

## 6. Error/crash reporting (Sentry) — optional but recommended

The app already has a crash-reporting hook wired in
(`lib/monitoring.ts`), Sentry SDK installed, and it does **nothing** until
you provide a DSN — so no account is required to ship, but you'll be
flying blind on crashes without one.

- [ ] Create a free account at https://sentry.io and a React Native
      project inside it.
- [ ] Set `EXPO_PUBLIC_SENTRY_DSN` (and optionally
      `EXPO_PUBLIC_SENTRY_ENVIRONMENT`,
      `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`) as EAS secrets/build env
      vars. Until this is set, `initMonitoring()` is a no-op and
      `reportError()`/`addMonitoringBreadcrumb()` calls throughout the app
      quietly do nothing.

## 7. Deep links / universal links — what you need to provide

`app.json` now declares `associatedDomains` (iOS) and an `intentFilters`
autoVerify block (Android) for `brandthread.app`. For the OS to actually
trust these, the API server serves the verification files at
`/.well-known/apple-app-site-association` and
`/.well-known/assetlinks.json` — but they're empty placeholders until you
set these env vars on the API server's deployment:

- `APPLE_TEAM_ID` — from §1.
- `IOS_BUNDLE_IDENTIFIER` — defaults to `com.brandthread.mobile`, only set
  this if you change the bundle id.
- `ANDROID_PACKAGE_NAME` — defaults to `com.brandthread.mobile`.
- `ANDROID_SHA256_CERT_FINGERPRINTS` — comma-separated SHA-256
  fingerprint(s) from Play Console (§2) for production, plus your local
  debug keystore's fingerprint if you want App Links to work on
  development builds too (`eas credentials` can print both).

Once those are set, verify at
https://developer.apple.com/contact/request/asset-links (or just fetch
the two `/.well-known/...` URLs and confirm they're non-empty) before
relying on universal/app links in a store submission — Apple/Google
re-crawl these at install time and cache the result.

Known limitation: seller storefront subdomains (`{store}.brandthread.app`)
are not covered by universal links yet — only the apex domain and `www.`
are in `associatedDomains`/`intentFilters`. Those links open in-app via a
web view today; wiring up wildcard subdomain verification is a follow-up
if it's wanted later.

## 8. What's already done for you (no action needed)

- App icon set (12 themed variants), adaptive icons, splash screen, and
  iOS privacy manifest with every permission's usage string.
- `supportsTablet` + iPad landscape/portrait rotation (phones stay
  portrait-only; iPad allows all orientations).
- CORS on the API is locked to the app + brandthread.app; no `*` origins.
- Health/readiness endpoints, structured JSON logs, and graceful shutdown
  on the API server.
- Environment variable validation at boot — the API server now refuses to
  start with a clear error if a required var (database, auth, payments)
  is missing, instead of failing on the first request.
- Share links for products, profiles, collections and drops now render a
  real title/photo/price preview in iMessage/Instagram/Twitter instead of
  the generic homepage card.
