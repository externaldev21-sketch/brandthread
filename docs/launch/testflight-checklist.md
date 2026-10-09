# TestFlight checklist

Step by step from zero accounts to a go/no-go decision. The commands, environment variable
table and store-review details live in [`release-flow.md`](../app-store/release-flow.md);
this page only orders the steps and adds the tester and go/no-go parts. Account tasks that
only a person can do are also tracked in [`dev-only-tasks.md`](./dev-only-tasks.md).

Run every command from `artifacts/mobile`.

## Build profiles (`eas.json`)

| Profile | Use it for | Command |
| --- | --- | --- |
| `testflight` | iOS build for TestFlight. Extends `production` (store distribution, production environment, build number auto-increment) on its own `testflight` update channel. | `eas build --platform ios --profile testflight` |
| `production` | What `pnpm run build:testflight` and store releases use. Unchanged. | `pnpm run build:testflight` |
| `preview-ios-simulator` | Build that runs in the iOS Simulator on a Mac. Extends `preview`. | `eas build --platform ios --profile preview-ios-simulator` |
| `production-apk` | Production-environment `.apk` for installing on an Android phone without Play (sideload test). Does not raise `versionCode`, so it never wastes a store version number. | `eas build --platform android --profile production-apk` |
| `preview`, `development` | Unchanged internal builds. | `pnpm run build:preview` |

`pnpm run build:testflight` keeps working and uses `production`. Use the `testflight` profile
when you want TestFlight builds kept on a separate update channel
(`pnpm run update:production` does not reach them, use `eas update --channel testflight`).
Submit either kind with `eas submit --platform ios --profile production --latest`.

## 1. Accounts (once)

- [ ] Expo account, `eas login`, `eas init` (commit the `app.json` change it writes).
- [ ] Apple Developer Program, agreements accepted in App Store Connect.
- [ ] Agreements, Tax and Banking completed (needed before subscriptions can be tested).
- [ ] App record in App Store Connect with bundle ID `com.brandthread.mobile`.
- [ ] `eas.json` `submit.production.ios` filled in (`appleId`, `ascAppId`, `appleTeamId`;
      where to find each is in `release-flow.md`). Check with `pnpm run verify:submit-config`.
- [ ] Subscription products created in App Store Connect and connected in RevenueCat.

## 2. Environment variables (once, then when a value changes)

- [ ] Every value in the `release-flow.md` production variable table set in the EAS
      `production` environment (API base URL, domain, Clerk production key, RevenueCat
      iOS key, optional Sentry).
- [ ] `EXPO_PUBLIC_ENABLE_TEST_SUBSCRIPTION_BYPASS`, `EXPO_PUBLIC_REVENUECAT_TEST_API_KEY`
      and `EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST` are **not** set.
- [ ] Production API and `https://brandthread.app` are live (a reviewer hitting a dead backend
      is an instant rejection).

## 3. Pre-flight (every build)

- [ ] On the commit you are building: `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm test`.
- [ ] `pnpm run verify:privacy-manifest:config`.
- [ ] Version in `app.json` is right. Build numbers raise themselves.

## 4. First build

- [ ] `pnpm run build:testflight` (or the `testflight` profile above). It runs the checks first,
      builds on Expo's Macs (15 to 30 minutes) and uploads.
- [ ] First run only: sign in to Apple when asked, answer yes to creating the certificate and
      provisioning profile, and let EAS create the push key.
- [ ] Apple emails you when processing finishes (5 to 30 minutes). Export compliance is already
      answered in `app.json`.

## 5. Testers

- [ ] **Internal** (up to 100 people on the App Store Connect team): TestFlight, Internal Testing,
      add a group, add the build. No review needed.
- [ ] **External** (up to 10,000): create a group, add the build, fill in Test Information below.
      The first external build goes through Beta App Review (usually a day).
- [ ] Testers install the TestFlight app and accept the invite by email or public link.

**Test Information for Beta App Review**

| Field | What to enter |
| --- | --- |
| Beta app description | Brandthread is a marketplace app. Buyers shop independent streetwear and message sellers. Sellers run a storefront, go live and use design tools. |
| Feedback email | `support@brandthread.app` |
| What to test | Paste the "What to test" list in section 6. |
| Sign-in required | Yes. Enter the demo buyer and demo seller credentials (create them as described in `app-store-metadata.md`, "Demo buyer + seller accounts"). |
| Notes | Seller subscriptions, Boost, Create ad, Featured on Discover and AI credit packs use in-app purchase (sandbox in TestFlight). Physical goods use Stripe. |

## 6. What to test

Send this to testers. Test on at least one iPhone and one iPad (iPad is supported, see
[`ipad-release-checklist.md`](../app-store/ipad-release-checklist.md)).

- [ ] Sign up as a buyer, then as a seller. Sign in with email, Apple and Google.
- [ ] Buyer: scroll the feed, open a product from a post, add to cart, check out, see the order in Orders, message the seller.
- [ ] Seller: add a product with photos, see a buyer's order, fulfil it, open Plan and subscription and buy a plan in the sandbox.
- [ ] Go live as a seller and join as a buyer (camera and microphone prompts).
- [ ] Design Studio: create a mockup and remove a background.
- [ ] Push notifications arrive after an order and a message, and tapping one opens the right screen.
- [ ] Face ID unlock if turned on. Sign out and back in.
- [ ] Delete an account created for testing (Settings, Danger zone, Delete account).
- [ ] Nothing sits under the notch or home indicator, on every device size tested.
- [ ] Kill the app mid-checkout and reopen it: nothing is charged twice.

## 7. Go / no-go

Go only if every line is true:

- [ ] The build has been on at least 3 real devices for 48 hours with no crash in Sentry (if enabled) or TestFlight crash reports.
- [ ] Every item in section 6 passed on iPhone and iPad, with failures fixed and re-tested on a new build.
- [ ] Demo reviewer accounts work right now.
- [ ] Privacy answers match [`privacy-labels.md`](../app-store/privacy-labels.md) and the listing copy is inside its limits ([`store-listing-kit.md`](./store-listing-kit.md)).
- [ ] The Boost and Create-ad payment decision is made (`app-store-readiness.md` row 10).
- [ ] Screenshots regenerated from this build's code (`pnpm run screenshots -- --strict`).

No-go if any of these fails. Fix, build again (the number raises itself) and repeat from section 4.

## 8. Submit

- [ ] Follow "Store review" in `release-flow.md`: select the TestFlight build, Add for Review, Submit.
- [ ] Android in parallel: `production` build, `eas submit --platform android --profile production --latest`,
      internal testing, then closed testing (12 testers for 14 days on a new personal account).
