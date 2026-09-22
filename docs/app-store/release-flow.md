# Release flow (Windows, no Mac needed)

Every step here runs on Windows. The iOS app is compiled on Expo's cloud Macs
(EAS Build), uploaded with EAS Submit, and tested on a real iPhone/iPad
through TestFlight. Run all commands from `artifacts/mobile` in PowerShell or
Windows Terminal.

```
 code on dev ──► eas build (cloud) ──► eas submit ──► TestFlight / Play internal testing ──► store review ──► live
```

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

Leave `EXPO_PUBLIC_ENABLE_TEST_SUBSCRIPTION_BYPASS`, `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY`
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
  sign-in setup and the Xcode image (`eas-build-pre-install` in
  `package.json`).

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

> **Right now every change needs a new store build.** `expo-updates` is not
> installed, so the app can't receive over-the-air (OTA) updates. To make
> quick fixes possible after launch, add it **before the first store build**:
>
> ```powershell
> pnpm exec expo install expo-updates
> eas update:configure        # sets the update URL, runtimeVersion and channels
> ```
>
> Commit the result and make a new store build. Only builds that include
> `expo-updates` can receive OTA updates. After that, ship JavaScript-only
> fixes with `eas update --channel production --message "Fix …"`.

| Change | New store build | OTA update (once `expo-updates` is set up) |
| --- | --- | --- |
| Screen code, styling, text, navigation, bug fixes in TypeScript/JavaScript | — | ✅ |
| Images, fonts and sounds that ship inside the JS bundle | — | ✅ |
| `EXPO_PUBLIC_*` environment variable values | ✅ (baked in at build time) | ✅ (taken from the environment when you publish the update) |
| API / server / database changes | — (deploy the server) | — (deploy the server) |
| Anything in `app.json`: name, icon, splash, `userInterfaceStyle`, `supportsTablet`, permissions and their wording, privacy manifest, plugins, URL scheme | ✅ | ❌ |
| Adding, removing or upgrading a package with native code (`expo-*`, `react-native-*`), or an Expo SDK upgrade | ✅ | ❌ |
| `eas.json` build settings, signing credentials, Xcode image | ✅ | ❌ |
| New in-app purchase products | ✅ if the app code changes; otherwise configure them in App Store Connect / Play and RevenueCat | — |
| Store listing, screenshots, privacy labels, pricing | Neither: edit in App Store Connect / Play Console | Neither |

Apple's rule for OTA updates: they may fix bugs and improve existing
features, but must not change what the app is for or add major features that
bypass review. Anything big goes through a store build.
