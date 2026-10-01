# Store listing kit

Everything Dev needs on the day the store listings are filled in. This page adds
what [`app-store-metadata.md`](./app-store-metadata.md) did not have: verified
character counts, release notes, the Google Play Data safety answers, a cross-check of
the privacy answers against the real SDKs and permissions, and the list of
required artwork. It does not repeat the listing copy: edit the copy in
`app-store-metadata.md` and the counts below are re-checked by
`artifacts/mobile/scripts/store-listing-limits.test.ts`.

Related: [`privacy-labels.md`](../app-store/privacy-labels.md) (source of truth for
privacy answers), [`screenshots-plan.md`](./screenshots-plan.md),
[`testflight-checklist.md`](./testflight-checklist.md), [`dev-only-tasks.md`](./dev-only-tasks.md).

## 1. Character counts (verified)

Counts are Unicode characters, the way App Store Connect and Play Console count.
`pnpm --filter @workspace/mobile exec vitest run scripts/store-listing-limits.test.ts`
fails if a value goes over its limit or if the **Used** column here goes stale.

| Field | Used | Limit | Store | Source |
| --- | --- | --- | --- | --- |
| App name | 11 | 30 | App Store and Play | `app-store-metadata.md` |
| Subtitle | 30 | 30 | App Store | `app-store-metadata.md` (at the limit, any edit must shorten it) |
| Promotional text | 147 | 170 | App Store | `app-store-metadata.md` |
| Keywords | 92 | 100 | App Store | `app-store-metadata.md` (no spaces after commas) |
| Short description | 72 | 80 | Google Play | `app-store-metadata.md` |
| Long description | 1030 | 4000 | App Store and Play | `app-store-metadata.md` |

Release notes are checked against 4000 (App Store) and 500 (Google Play) below.

## Release notes, 1.0.0 (App Store)

```
Welcome to Brandthread! Shop independent streetwear, run your own storefront, and design new pieces with AI-assisted tools, all in one app.
```

## Release notes, 1.0.0 (Google Play)

```
Welcome to Brandthread! Shop independent streetwear, run your own storefront, and design new pieces with AI-assisted tools, all in one app.
```

Later releases use the "What's new" template in `app-store-metadata.md`.

## 3. Privacy answers cross-checked against the code

The privacy answers in `privacy-labels.md` were re-checked against `app.json` and
`package.json` on the `dev` branch at the time of writing. Every SDK that can touch
user data is listed here with the answer it leads to.

| SDK or permission (where declared) | What it touches | Covered by |
| --- | --- | --- |
| `@clerk/expo` (package.json) | Name, email, phone, user ID, sign-in with Apple and Google | Contact Info, User ID |
| `expo-apple-authentication` + `com.apple.developer.applesignin` entitlement (app.json) | Apple sign-in | Email, Name |
| `@stripe/stripe-react-native` (package.json, app.json plugin) | Card entry and Google Pay; Brandthread keeps brand, last four and expiry | Payment Info |
| `react-native-purchases` (RevenueCat) | Subscription status, app user ID | Purchase History, User ID |
| `react-native-agora` | Live video and call audio | Photos or Videos, Audio Data |
| `expo-camera`, `expo-image-picker`, `expo-media-library` (app.json plugins, purpose strings present) | Photos and video the person chooses or records | Photos or Videos |
| `expo-audio` (microphone purpose string) | Voice messages, sound in videos | Audio Data |
| `expo-notifications` | Expo push token | Device ID |
| `expo-local-authentication` | Face ID result stays on the device | Nothing collected |
| `@sentry/react-native` (only active when `EXPO_PUBLIC_SENTRY_DSN` is set) | Crash and performance data, not linked to the user | Crash Data, Performance Data |
| `expo-updates` | Update checks to Expo | Nothing beyond standard request metadata |
| Location, Contacts, Health, ATT, advertising SDKs | None in `package.json` or `app.json` | Not collected |

Result: no row contradicts `privacy-labels.md`, and no SDK collects a data type that table
leaves out. Re-run this check whenever `package.json` gains a native package
(`pnpm run verify:privacy-manifest:config` covers the iOS manifest).

Permissions to expect in the store consoles (from the config plugins): camera,
microphone, photo library read and save, Face ID, notifications. No location and no
contacts. After the first Android build, open the built manifest in Play Console
(App bundle explorer) and confirm the declared permissions match this list before
filling in the permissions forms.

## 4. Google Play Data safety answers

Same facts as [`privacy-labels.md`](../app-store/privacy-labels.md), in Play's wording.
Play Console, App content, Data safety.

**Top-level questions**

| Question | Answer |
| --- | --- |
| Does the app collect or share required user data types? | Yes |
| Is all collected data encrypted in transit? | Yes (HTTPS only) |
| Do you provide a way for users to request data deletion? | Yes. In app: Settings, Danger zone, Delete account. Play also asks for a URL that works outside the app: see "Open items" below. |
| Independent security review | No |

**Data types**

"Collected" means sent off the device to Brandthread. Service providers that process
data for Brandthread (Clerk, Stripe, RevenueCat, Agora, Sentry, Expo) are not counted as
"sharing" under Play's rules. Nothing is sold, and nothing is used for advertising.

| Play category, type | Collected | Shared | Required or optional | Purpose |
| --- | --- | --- | --- | --- |
| Personal info, Name | Yes | No | Required | App functionality, Account management |
| Personal info, Email address | Yes | No | Required | App functionality, Account management |
| Personal info, Phone number | Yes | No | Optional | App functionality |
| Personal info, Address | Yes | No | Optional (needed to ship an order) | App functionality |
| Personal info, User IDs | Yes | No | Required | App functionality, Account management |
| Financial info, User payment info | Yes (card brand, last four, expiry) | No | Optional | App functionality |
| Financial info, Purchase history | Yes | No | Required to buy or subscribe | App functionality |
| Financial info, Other financial info | Yes (seller payout status, bank last four, tax settings) | No | Optional (sellers) | App functionality |
| Photos and videos, Photos / Videos | Yes | No | Optional | App functionality |
| Audio, Voice or sound recordings | Yes | No | Optional | App functionality |
| Messages, Other in-app messages | Yes | No | Optional | App functionality |
| Messages, Emails | No (support messages are declared as in-app messages) | | | |
| App activity, App interactions | Yes | No | Required | App functionality, Analytics, Personalization |
| App info and performance, Crash logs | Yes (not linked to the user) | No | Required | App functionality |
| App info and performance, Diagnostics | Yes | No | Required | App functionality |
| Device or other IDs | Yes (push token) | No | Optional | App functionality |
| Location, Health and fitness, Contacts, Web browsing, Calendar, Files and docs | No | | | |

Notes: Face ID checks stay on the device and are not collected. Seller identity
verification (ID photo and selfie) happens on Stripe Identity's own page, so those images
are not collected by Brandthread.

Other Play declarations to answer in the same session: Ads (No), Target audience
(18 and over, not a Families app), News app (No), Government app (No), Financial
features (No, the app sells goods and does not offer loans or banking), and the
photo and video permission declaration (the app reads the photo library so people can
choose media to post).

## 5. Required artwork and what the tooling already covers

Generate with `pnpm run screenshots` from `artifacts/mobile` (details and demo data in
[`screenshots-plan.md`](./screenshots-plan.md) and
[`release-flow.md`](../app-store/release-flow.md#store-screenshots)). Do not rebuild the tooling.

| Store asset | Required | Covered by `scripts/store-screenshots` | Pixels |
| --- | --- | --- | --- |
| iPhone 6.9" screenshots (2 to 10) | Yes | Yes, `iphone-6.9in/` | 1320 x 2868 |
| iPad 13" screenshots (2 to 10) | Yes (iPad is supported) | Yes, `ipad-13in/` | 2064 x 2752 |
| iPhone 6.5" screenshots | No, Apple scales the 6.9" set | No | 1284 x 2778 |
| App Store icon | Yes | From `app.json` icon, uploaded by the build | 1024 x 1024 |
| Play phone screenshots (2 to 8) | Yes | Yes, `android-phone/` | 1080 x 1920 |
| Play 7" and 10" tablet screenshots | Recommended | Yes, `android-tablet-7in/`, `android-tablet-10in/` | 1200 x 1920, 1600 x 2560 |
| **Play feature graphic** | **Yes** | **No, missing** | 1024 x 500 |
| **Play app icon (store listing)** | **Yes** | **No, missing** (source `assets/images/icon.png` is 1254 x 1254 and needs a 512 x 512 export) | 512 x 512 |
| App preview video (optional) | No | No | see `screenshots-plan.md` |

Missing and needing a human: the **Play feature graphic (1024 x 500, PNG or JPEG,
no transparency)** and the **512 x 512 Play icon**. Both come from the brand artwork
and are a design decision, so they are not generated here. The generated screenshot
set in the repo is from 2026-09-23; regenerate it from the final `dev` before uploading
(`pnpm run screenshots -- --strict`).

Screenshot captions (one per slot, in order) are in `screenshots-plan.md`.

## 6. Open items before pressing Submit

- A deletion-request URL that works without the app for Play's Data safety form. Account
  deletion exists in the app (`/delete-account`) but that route needs a signed-in session.
  Point the form at a public page or a `support@brandthread.app` process and say which in
  the answer.
- Landing page store badges: set `EXPO_PUBLIC_APP_STORE_URL` and `EXPO_PUBLIC_PLAY_STORE_URL`
  once the listings are live (see the PR description for where each value is found).
