# Google Play: Data safety, account deletion URL, permissions, target API

Derived from the code on `dev` (2026-09-30). Companion to
`docs/app-store/privacy-labels.md`, which it must never contradict: the
data types below are the same data, expressed in Google's categories. Enter
these answers in **Play Console, App content, Data safety**.

## Global answers

| Question | Answer |
| --- | --- |
| Does the app collect or share any of the required user data types? | Yes |
| Is all user data encrypted in transit? | **Yes.** Every API call, Clerk, Stripe, RevenueCat, Agora and Sentry use HTTPS/TLS. |
| Do you provide a way for users to request data deletion? | **Yes** |
| Account deletion URL (Play requires it) | `https://brandthread.app/account-deletion` (public page, no sign-in needed). In-app path: Settings, Delete account (`app/delete-account.tsx`). |
| Data deletion requests that delete only some data | Yes: order, payment, refund and tax records are kept with name and address removed, as the law requires. Declare this under "data retained". |
| Independent security review / Families / Committed to Play Families policy | No / not a Families app |
| Is the app's data used for tracking or advertising? | No. No ad SDK, no advertising ID. The Meta/TikTok pixels run on the website only (`lib/marketingPixels.ts`), never in the Android app. |

**Sharing convention used below.** Google does not count a transfer to a
service provider acting on Brandthread's behalf (Clerk, Stripe, Sentry,
RevenueCat, Agora, Resend, Shippo, cloud storage) as "sharing", so those are
not ticked as shared. Data a buyer's checkout sends to the seller or
manufacturer that fulfils the order is a transfer to another party, so it is
declared as **shared**, conservatively.

## Per data type

"Optional" means the user can use the app (browse, sign up) without providing
it. All collected data is **encrypted in transit** and **deletable** (in-app
or on the web page above) unless the row says otherwise.

| Play category, data type | Collected | Shared | Purposes | Required or optional | Code that collects it |
| --- | --- | --- | --- | --- | --- |
| Personal info, **Name** | Yes | Yes (seller/manufacturer that fulfils an order) | App functionality, Account management | Required | `app/onboarding.tsx`, `app/edit-profile.tsx`, checkout shipping name |
| Personal info, **Email address** | Yes | Yes (seller receives buyer email for order contact) | App functionality, Account management, Communications (receipts, order updates) | Required | Clerk sign-in, synced to profile |
| Personal info, **User IDs** | Yes | No | App functionality, Account management | Required | Clerk ID; RevenueCat app user ID (`lib/revenueCat.native.tsx`) |
| Personal info, **Address** | Yes | Yes (seller/manufacturer and carrier for delivery) | App functionality | Optional (needed only to buy physical goods) | `app/buyer-addresses.tsx`, seller locations |
| Personal info, **Phone number** | Yes | Yes (delivery contact) | App functionality | Optional | Personal Details, checkout |
| Financial info, **User payment info** | Yes (card brand, last four, expiry only; full card numbers go to Stripe) | No | App functionality | Optional (needed to pay by card) | `app/buyer-payment-methods.tsx` |
| Financial info, **Purchase history** | Yes | No | App functionality, Account management | Required for purchases | Orders, returns, refunds, subscriptions |
| Financial info, **Other financial info** | Yes (seller payouts, bank last four, tax settings) | No | App functionality | Optional (sellers only) | `app/payouts.tsx`, `app/finance.tsx` |
| Photos and videos, **Photos**, **Videos** | Yes | No | App functionality | Optional | Posts, stories, products, designs, message attachments, live video (camera, photo picker) |
| Audio, **Voice or sound recordings** | Yes | No | App functionality | Optional | Voice messages, sound in videos, live streams and calls over Agora |
| Files and docs, **Files and docs** | Yes | No | App functionality | Optional | Document upload (`expo-document-picker` in `app/design.tsx`, `app/design-canvas.tsx`) |
| Messages, **Other in-app messages** | Yes | No | App functionality | Optional | Direct messages, community chat, manufacturer messages |
| App activity, **App interactions** | Yes | No | App functionality, Analytics, Personalization | Required (server-side events) | Notification opened events, story views, storefront visits, shopping preferences |
| App activity, **Other user-generated content** | Yes | No | App functionality | Optional | Bio, comments, reviews, listings, designs, AI prompts |
| App activity, **Other actions** (support reports) | Yes | No | App functionality | Optional | Problem, content and IP reports |
| App info and performance, **Crash logs** | Yes (not linked to the user) | No (Sentry is a service provider) | Analytics (crash and stability) | Required when a DSN is configured | `lib/monitoring.ts` |
| App info and performance, **Diagnostics** | Yes (performance samples, call lifecycle events) | No | App functionality, Analytics | Required | Sentry traces at 10%, `/api/call/events` |
| Device or other IDs, **Device or other IDs** | Yes (Expo push token, linked to account) | No | App functionality | Optional (only if notifications are allowed) | `lib/contextualPushPermission.ts` |

### Not collected (leave unticked)

Location (approximate and precise), Contacts, Calendar, Health and fitness,
Web browsing history, Search history (only kept on-device), SMS or call log,
Installed apps, Race/ethnicity, Political or religious beliefs, Sexual
orientation, Biometric data (Face ID and fingerprint are handled by the OS
and the app only receives pass/fail, `lib/appLock.ts`). Seller identity
checks run on Stripe Identity's hosted page, so ID photos never reach
Brandthread.

## Account deletion page (Play policy)

- URL: `https://brandthread.app/account-deletion`, plain HTML served by
  `artifacts/mobile/server/serve.js` from `server/templates/account-deletion.html`.
- Flow: enter the account email. The API answers identically whether or not the
  email exists (no enumeration). If an active account matches, a single-use,
  60-minute link is emailed (hash only stored in `account_deletion_requests`,
  migration `211_account_deletion_requests.sql`). Opening the link asks the
  owner to type DELETE. Only then does the existing deletion logic
  (`accountDeletionHandler` in `routes/auth.ts`, unchanged) run, including its
  blockers check (open orders, held funds, disputes) and Clerk user removal.
  Nobody can delete someone else's account without access to that inbox.
- Endpoints: `POST /api/public/account-deletion/request` and `/confirm`
  (`routes/account-deletion-public.ts`), rate-limited with the "authentication" policy.
- Needs `RESEND_API_KEY` (and `MAIL_FROM`) to send the link. Without it the
  request endpoint answers `422 MAIL_NOT_CONFIGURED` rather than pretending.
- Tests use mocks only (`routes/__tests__/account-deletion-public.test.ts`); no
  real account is ever deleted.

## Android permissions (`artifacts/mobile/app.json`)

What the final manifest will request, and why:

| Permission | Source | Why |
| --- | --- | --- |
| CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS | expo-camera, expo-audio, Agora | Photos and video, voice messages, live video and calls. Requested in context only. |
| READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_MEDIA_VISUAL_USER_SELECTED | expo-media-library (`granularPermissions: photo, video`) | In-app gallery grid (`components/create-post/MediaGrid.tsx`, story create). See Play risk below. |
| READ/WRITE_EXTERNAL_STORAGE | expo-media-library, expo-file-system | Library-declared; only effective on Android 12 and lower (minSdk is 24). Kept so saving and gallery browsing work on old devices. |
| POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED | expo-notifications | Push notifications. |
| USE_BIOMETRIC, USE_FINGERPRINT | expo-local-authentication | App Lock. |
| INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE, BLUETOOTH | Agora, Sentry, expo-updates | Networking; Bluetooth headset audio routing in calls. |

`blockedPermissions` now also blocks fine and coarse location, media location,
contacts, phone state, audio media, Bluetooth scan and advertise, so a
transitive SDK update cannot add a permission this form says we do not use.
`scripts/verify-ios-privacy-manifest.js` fails if these are removed.

**Play risk (owner decision):** since 2025 Play restricts READ_MEDIA_IMAGES and
READ_MEDIA_VIDEO to apps whose core purpose needs broad gallery access, and
expects the system Photo Picker otherwise. The custom gallery grid in post and
story creation is what needs it. Either declare it in Play Console under
**Policy, App content, Photo and video permissions** (core use: creating
posts and stories from the user's library), or later replace the grid with the
system picker. That would change an existing screen, so it was not done here.

## Target API level

- Play requires new apps and updates to target Android 15 (API 35) since
  31 Aug 2025, and Android 16 (API 36) from 31 Aug 2026 as announced. Confirm the
  current date in Play Console, Policy status, because Google adjusts it.
- This app: Expo SDK 57 with React Native 0.86.3, whose defaults are
  `targetSdk = 36`, `compileSdk = 36`, `minSdk = 24`
  (`node_modules/react-native/gradle/libs.versions.toml`). There is no
  `expo-build-properties` override in `app.json` or `eas.json`, so the build
  targets API 36. **Compliant, no change needed.**
- Build type for Play is `app-bundle` (`eas.json`, production profile).
