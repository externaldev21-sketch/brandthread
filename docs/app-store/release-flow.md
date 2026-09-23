# Release flow (Windows, no Mac needed)

Every step here runs on Windows. The iOS app is compiled on Expo's cloud Macs
(EAS Build), uploaded with EAS Submit, and tested on a real iPhone/iPad
through TestFlight. Run all commands from `artifacts/mobile` in PowerShell or
Windows Terminal.

```
 code on dev ──► eas build (cloud) ──► eas submit ──► TestFlight / Play internal testing ──► store review ──► live
                                                                                                          │
                          JavaScript-only fixes after launch:  pnpm run update:production ────────────────┘
```

**Everyday commands** (run in `artifacts\mobile`):

| I want to… | Command |
| --- | --- |
| Put a test build on testers' phones (no store review) | `pnpm run build:preview` |
| Build for iPhone/iPad and send it to TestFlight | `pnpm run build:testflight` |
| Ship a JavaScript fix to people who already have the app | `pnpm run update:production -- --message "Fix …"` |
| Undo a bad over-the-air update | `pnpm run update:rollback` |
| Regenerate App Store / Play screenshots | `pnpm run screenshots` |

---

## 1. One-time setup

### Accounts

| Account | Cost | Used for |
| --- | --- | --- |
| [Expo](https://expo.dev/signup) | Free tier is enough to start | Cloud builds and submissions |
| [Apple Developer Program](https://developer.apple.com/programs/enroll/) | US$99 / year | App Store, TestFlight, signing certificates |
| [Google Play Console](https://play.google.com/console/signup) | US$25 once | Play Store, internal testing |

> **Google Play, new personal accounts:** Google requires a **closed test with
> at least 12 testers for 14 days in a row** before you can apply for
> production access. Start that test as early as possible. Organisation
> accounts are exempt.

### Tools on Windows

```powershell
# Node.js 22 LTS from https://nodejs.org, then:
corepack enable            # provides pnpm
npm install -g eas-cli
eas login
cd <repo>\artifacts\mobile
pnpm install
```

### Link the project to EAS (once)

```powershell
eas init
```

This creates the **`brandthread`** project on expo.dev (the name comes from
`slug` in `app.json`). It then writes `extra.eas.projectId` and `owner` into
`app.json`. **Commit that change.** Push notifications need the project ID to
issue push tokens. If you previously made a project called `mobile` on
expo.dev, it is no longer used and can be deleted.

The over-the-air update address (`updates.url`) is worked out from that
project ID by `app.config.js`, so there is nothing else to configure. You do
**not** need to run `eas update:configure`.

### Production environment variables (once, then whenever a value changes)

These values are compiled into the app. Set them in **expo.dev → Project →
Environment variables → production**, or from the terminal:

```powershell
eas env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://<api-domain> --visibility plaintext
```

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | Production API URL, e.g. `https://brandthread.app` |
| `EXPO_PUBLIC_DOMAIN` | Production domain without `https://` |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk **production** key (`pk_live_…`) |
| `EXPO_PUBLIC_CLERK_PROXY_URL` | Only if the Clerk production instance uses a proxy |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | RevenueCat App Store public key |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` | RevenueCat Play Store public key |
| `EXPO_PUBLIC_SENTRY_DSN` | Optional. Sentry DSN for crash reports (same value as `SENTRY_DSN`, see [Crash reporting](#crash-and-error-reporting-sentry)) |
| `SENTRY_ORG`, `SENTRY_PROJECT` | Optional. Sentry organisation and project slugs, used to upload source maps |
| `SENTRY_AUTH_TOKEN` | Optional. Sentry auth token. Create it with visibility **secret** |

Set the same variables in the **preview** environment too, so test builds
behave like the real app. Leave `EXPO_PUBLIC_ENABLE_TEST_SUBSCRIPTION_BYPASS`, `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY`
and `EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST` **unset** for production. The
`production` build profile in `eas.json` reads the `production` environment
automatically.

### App Store Connect (once)

1. Create the app in [App Store Connect](https://appstoreconnect.apple.com) → My Apps → **+** → New App.
   Bundle ID: `com.brandthread.mobile`. If it's not in the list yet, run
   the first `eas build` (step 2), which registers it for you, then come back.
2. Fill in the three placeholders in `eas.json` → `submit.production.ios`:

   | Field | Where to find it |
   | --- | --- |
   | `appleId` | The email you use to sign in to App Store Connect |
   | `ascAppId` | App Store Connect → your app → **App Information** → *Apple ID* (digits only) |
   | `appleTeamId` | [developer.apple.com/account](https://developer.apple.com/account) → **Membership details** → *Team ID* (10 characters) |

3. Check them: `pnpm run verify:submit-config`. Until they're filled in,
   `eas submit` refuses to run, so a wrong ID can't be used by accident.

### Google Play Console (once)

1. Create the app with package name `com.brandthread.mobile`.
2. **Upload the very first `.aab` by hand** (Play Console → Testing →
   Internal testing → Create release). Google doesn't allow the first upload
   through its API.
3. Create a Google Cloud **service account** with Play Console access
   ([guide](https://expo.fyi/creating-google-service-account)). Upload its JSON
   key with `eas credentials -p android` → *Google Service Account*. The key
   stays on EAS, so **never commit it to the repo**.
4. `eas.json` sends Android builds to the **internal** track as a
   **draft**. After the app's first release is live on Play, change
   `releaseStatus` to `"completed"` so uploads roll out without a manual click.

---

## 2. Build (every release)

```powershell
cd artifacts\mobile
pnpm install --frozen-lockfile   # must succeed; EAS runs the same install
pnpm run typecheck
pnpm test
eas build --platform all --profile production
```

- The build runs on Expo's servers, taking about 15–30 minutes per platform,
  and you can close the terminal. Progress and logs are on expo.dev.
- The first iOS build asks you to sign in with your Apple ID and offers to
  create the certificate and provisioning profile. Answer **yes**, and EAS
  stores them.
- **Build numbers are automatic.** `appVersionSource: "remote"` together with
  `autoIncrement` makes EAS raise the iOS `buildNumber` and Android
  `versionCode` on every production build. Only change `version` in
  `app.json` (e.g. `1.0.0` → `1.0.1`) when you want a new version number to
  appear in the stores.
- Before installing dependencies, the build checks the bundle ID, Apple
  sign-in setup and the Xcode image, and prints whether Sentry source maps
  will be uploaded (`eas-build-pre-install` in `package.json`).
- Every production build is tied to the **`production` update channel**, so
  it can receive over-the-air fixes later ([details](#new-store-build-or-ota-update)).

### TestFlight in one command

Once the Apple Developer account exists and the three Apple values are
filled in (see [App Store Connect (once)](#app-store-connect-once)):

```powershell
pnpm run build:testflight
```

It checks `eas.json`, the bundle ID, Apple sign-in and the Xcode image
first, and stops with a plain explanation if anything is missing (for
example, the Apple placeholders). Then it builds the iOS app in the cloud
and submits it to App Store Connect. Apple emails you when it appears in
TestFlight.

### Preview builds for testers (no store review)

```powershell
pnpm run build:preview
```

This uses the `preview` profile: an **internal-distribution** build on the
`preview` update channel, reading the `preview` environment variables.
When it finishes, expo.dev shows a QR code and install link.

- **Android:** the link installs an `.apk` directly on any phone.
- **iPhone/iPad:** Apple only lets registered devices install internal
  builds. Register each tester's device once with `eas device:create` (it
  gives them a link to open on the device), then run the build. Anyone not
  registered should use TestFlight instead.
- Send JavaScript changes to preview testers without rebuilding:
  `pnpm run update:preview -- --message "Try new discover layout"`.

## 3. Submit

```powershell
eas submit --platform ios --profile production --latest
eas submit --platform android --profile production --latest
```

Or build and submit in one go: `eas build --platform all --profile production --auto-submit`.

## 4. Test before release

**iOS: TestFlight**

1. Apple processes the upload in about 5–30 minutes. You'll get an email when it's ready.
   Export compliance is already answered in `app.json`
   (`usesNonExemptEncryption: false`, since the app only uses standard HTTPS).
2. App Store Connect → TestFlight → **Internal testing**: add up to 100
   people from your team. They install the **TestFlight** app and get the
   build straight away, with no review.
3. External testers (up to 10,000) need a short Beta App Review first.
4. Test on iPhone **and on both iPad sizes**. Work through
   [ipad-release-checklist.md](ipad-release-checklist.md) and
   `artifacts/mobile/docs/apple-sign-in-readiness.md`.

**Android: Play internal testing**

1. Play Console → Testing → **Internal testing** → Testers: add an email list.
2. Testers open the opt-in link and install from the Play Store, usually within minutes.

## 5. Store review

**App Store** (App Store Connect → your app → the version):

- [ ] Screenshots: 6.9″ iPhone **and 13″ iPad** (both are required now that iPad is supported).
- [ ] App Privacy answers exactly as in [privacy-labels.md](privacy-labels.md).
- [ ] Privacy Policy URL `https://brandthread.app/privacy` and a Support URL.
- [ ] Age rating questionnaire (the app has user-generated content, messaging and live video).
- [ ] **Sign-in info for the reviewer**: a working demo buyer account and a demo seller account, plus notes explaining how to reach live video, the design studio and subscriptions.
- [ ] Review notes: subscriptions are in-app purchases (RevenueCat); physical goods are paid through Stripe; seller identity checks open Stripe in the browser; account deletion is in Settings → Delete account.
- [ ] Select the TestFlight build → **Add for Review** → **Submit**. Review usually takes 1–3 days.

**Google Play:**

- [ ] Store listing, content rating, Data safety form (use the same facts as [privacy-labels.md](privacy-labels.md)), target audience, and the photo/video permission declaration (the app reads photos and videos from the library).
- [ ] Promote the tested internal build to **Closed testing** (and, for a new personal account, keep it running for 12+ testers / 14 days) → **Production**.

---

## New store build or OTA update?

The app includes **EAS Update** (`expo-updates`). After a build is in the
store, JavaScript-only fixes can be sent straight to phones in minutes,
without store review.

**How it reaches people.** Each time the app starts it quietly checks for an
update in the background and downloads it. The app never waits for the
download and never reloads while someone is using it: the new version is
used **the next time the app is opened**. The app also checks again when it
comes back to the foreground after 30 minutes or more, because people rarely
fully close apps.

**Channels.** Store builds listen on the `production` channel, preview
builds on `preview`, development builds on `development`. An update sent to
`preview` never reaches store users.

**Only compatible phones get an update.** Every build is stamped with a
*runtime version*: a fingerprint of all native code and configuration
(`runtimeVersion.policy: "fingerprint"` in `app.json`). An update is only
delivered to builds with the same fingerprint, so an update that needs new
native code can never reach a phone that doesn't have it. Before publishing,
`pnpm run update:production` also checks that at least one finished build on
that channel has the matching fingerprint, and **refuses to publish if none
does**, telling you to make a store build instead.

### What can ship over the air

| Change | Store build | Over the air |
| --- | --- | --- |
| Screen code, styling, text, navigation, bug fixes in TypeScript/JavaScript | — | ✅ |
| Images, fonts and sounds imported by the JavaScript code | — | ✅ |
| `EXPO_PUBLIC_*` environment variable values | ✅ (baked in at build time) | ✅ (read from the EAS environment when you publish) |
| API / server / database changes | — (deploy the server) | — (deploy the server) |
| Anything in `app.json`: name, icon, splash, `userInterfaceStyle`, `supportsTablet`, permissions and their wording, privacy manifest, plugins, URL scheme | ✅ | ❌ |
| Adding, removing or upgrading a package with native code (`expo-*`, `react-native-*`, `@sentry/react-native`, `@shopify/flash-list`), or an Expo SDK upgrade | ✅ | ❌ |
| `eas.json` (any edit, including the submit values), signing credentials, Xcode image, files in `plugins/` | ✅ | ❌ |
| New in-app purchase products | ✅ if the app code changes; otherwise configure them in App Store Connect / Play and RevenueCat | — |
| Store listing, screenshots, privacy labels, pricing | Neither: edit in App Store Connect / Play Console | Neither |

Not sure? Just run the update command: if the change needs a store build,
the fingerprint check stops you before anything is published.

Apple's rule for OTA updates: they may fix bugs and improve existing
features, but must not change what the app is for or add major features that
bypass review. Anything big goes through a store build.

### Ship a fix over the air

```powershell
cd artifacts\mobile
pnpm run typecheck
pnpm test
pnpm run update:production -- --message "Fix checkout total rounding"
```

Options: `--platform ios` or `--platform android` to update one platform
only, and `--rollout 10` to send it to 10% of users first. Watch the crash
rate in Sentry, then raise it with `eas update:edit --rollout-percentage 100`
(or roll back).

Updates appear on expo.dev → Project → **Updates**, with how many phones
have downloaded each one.

### Roll back a bad update

```powershell
cd artifacts\mobile
pnpm run update:rollback
```

Pick the channel and the bad update from the list. EAS republishes the
update that was live before it; if there wasn't one, phones go back to the
JavaScript that shipped inside the store build. Phones switch on their next
launch, exactly like a normal update. Nothing needs a store build.

- **Fix forward instead:** if the fix is small, publishing a new update
  with `pnpm run update:production` also replaces the bad one.
- **Crashes on start-up:** if an update crashes before the app finishes
  starting, `expo-updates` detects it and automatically falls back to the
  previous working version on that phone. Roll back anyway so new
  downloads stop.
- **Partial rollout:** an update sent with `--rollout` can also be stopped
  by rolling back; users outside the rollout never received it.

---

## Crash and error reporting (Sentry)

Crash reporting is built in for iOS, Android, web and the API server, and
**stays switched off until you add the Sentry values**. Without them the app
and server run exactly as before and builds still succeed.

**One-time setup:**

1. Create a free account at [sentry.io](https://sentry.io) with two
   projects: a **React Native** project (app and website) and a **Node.js**
   project (API).
2. Copy each project's **DSN** (Project settings → Client Keys).
3. Create an **auth token** (Settings → Auth Tokens, scope
   `project:releases` + `org:read`) so builds can upload source maps, which
   turn minified stack traces back into real file names and line numbers.
4. Set the values:

| Where | Variable | Value |
| --- | --- | --- |
| expo.dev → Environment variables (production **and** preview) | `EXPO_PUBLIC_SENTRY_DSN` | React Native project DSN |
| expo.dev (production and preview) | `SENTRY_ORG`, `SENTRY_PROJECT` | Organisation slug and React Native project slug |
| expo.dev (production and preview), visibility **secret** | `SENTRY_AUTH_TOKEN` | The auth token |
| API server secrets (Replit → Secrets) | `SENTRY_DSN` | Node.js project DSN |
| Web deployment environment | `EXPO_PUBLIC_SENTRY_DSN` | React Native project DSN |
| Your PowerShell session, for `update:*` commands | `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Same as above (`$env:SENTRY_AUTH_TOKEN = "…"`), so OTA updates upload source maps too |

The app reads `EXPO_PUBLIC_SENTRY_DSN` because only `EXPO_PUBLIC_*`
variables are compiled into the app. A DSN is designed to be public; it only
allows sending reports. The auth token is secret: never put it in
`app.json` or commit it.

**What gets reported:** crashes and unhandled errors, errors caught by the
app's error screen, and on the server every 5xx error and failed background
job. Reports contain the error, stack trace, device/OS/app version and the
update that was running. They don't include names, emails, IP addresses,
request bodies or URL query strings. Errors from each OTA update are tagged
with its update ID, so a bad update is easy to spot. This is declared in the
privacy manifest and in [privacy-labels.md](privacy-labels.md) (Crash Data
and Performance Data, not linked to the user).

Optional: `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (default `0.1`) sets how
many app sessions send performance timings; `SENTRY_ENVIRONMENT` and
`SENTRY_RELEASE` label server events.

---

## Store screenshots

```powershell
cd artifacts\mobile
pnpm exec playwright install chromium   # once
pnpm run screenshots
```

This builds the web version of the app, fills it with polished demo data
(no real accounts or server needed) and saves App Store and Play Store
screenshots to `artifacts/mobile/store-screenshots/`, one folder per device
size. See `store-screenshots/README.md` in that folder for the list of
screens, sizes and which store field each folder goes in.
