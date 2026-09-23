# App Store privacy labels

Use this page to fill in **App Store Connect → App Privacy**. It matches the
iOS privacy manifest in `artifacts/mobile/app.json`
(`expo.ios.privacyManifests`) one-for-one. The automated tests
(`scripts/legal-privacy.test.ts`) fail if this table, the manifest and
`scripts/verify-ios-privacy-manifest.js` ever disagree.

Last audited: 2026-09-22, against the mobile app source on `dev`.

## Answers that apply to every row

| Question in App Store Connect | Answer |
| --- | --- |
| Do you or your third-party partners collect data from this app? | **Yes** |
| Is this data linked to the user's identity? | **Yes**, for every type below (all of it is tied to the signed-in Clerk account) |
| Is this data used to track the user? | **No**, for every type. The native app has no advertising SDK, no IDFA and no App Tracking Transparency prompt. The Meta/TikTok pixels in `lib/marketingPixels.ts` load **only on the website**, after cookie consent. |

## Data collected

| App Store category → data type | Manifest key | Feature that collects it (where in the code) | Purposes to tick |
| --- | --- | --- | --- |
| Contact Info → Name | `NSPrivacyCollectedDataTypeName` | Sign-up, onboarding and profile editing (`app/onboarding.tsx`, `app/edit-profile.tsx`, `app/buyer-personal-details.tsx`); shipping name at checkout | App Functionality |
| Contact Info → Email Address | `NSPrivacyCollectedDataTypeEmailAddress` | Sign-in with email, Apple or Google through Clerk; synced to the Brandthread profile | App Functionality |
| Contact Info → Phone Number | `NSPrivacyCollectedDataTypePhoneNumber` | Optional phone in Personal Details; delivery phone at checkout (`app/buyer-checkout.tsx`); seller/manufacturer contact details | App Functionality |
| Contact Info → Physical Address | `NSPrivacyCollectedDataTypePhysicalAddress` | Saved delivery addresses and address autocomplete (`app/buyer-addresses.tsx`); seller business, shipping-origin and inventory locations | App Functionality |
| Financial Info → Payment Info | `NSPrivacyCollectedDataTypePaymentInfo` | Saved Stripe cards (`app/buyer-payment-methods.tsx`). Full card numbers are entered on Stripe's page and never reach Brandthread, but Brandthread stores the card brand, last four digits and expiry, so this is declared | App Functionality |
| Financial Info → Other Financial Info | `NSPrivacyCollectedDataTypeOtherFinancialInfo` | Seller payouts and Stripe Connect status, bank last four digits, tax and duty settings (`app/payouts.tsx`, `app/finance.tsx`, `app/taxes-duties.tsx`) | App Functionality |
| Purchases → Purchase History | `NSPrivacyCollectedDataTypePurchaseHistory` | Orders, returns, refunds and disputes (`app/(buyer)/orders.tsx`, `app/order-detail.tsx`); subscription status through RevenueCat (`lib/revenueCat.native.tsx`) | App Functionality |
| User Content → Photos or Videos | `NSPrivacyCollectedDataTypePhotosorVideos` | Posts, stories, product photos, design and AI studio uploads, message attachments, live video (camera, photo library and image picker) | App Functionality |
| User Content → Audio Data | `NSPrivacyCollectedDataTypeAudioData` | Voice messages (`expo-audio` recorder in `app/buyer-conversation.tsx`, `app/seller-conversation.tsx`); sound in recorded videos; live streams and calls over Agora (`app/call-screen.tsx`, `app/buyer-live.tsx`, `app/seller-live.tsx`) | App Functionality |
| User Content → Emails or Text Messages | `NSPrivacyCollectedDataTypeEmailsOrTextMessages` | In-app direct messages, community chat and manufacturer messages (`app/chat/[id].tsx`, `app/buyer-conversation.tsx`, `app/community-chat.tsx`, `app/manufacturer-messages.tsx`) | App Functionality |
| User Content → Customer Support | `NSPrivacyCollectedDataTypeCustomerSupport` | Problem reports, content/IP reports, return and refund requests (`app/buyer-problem-report.tsx`, `app/buyer-report.tsx`, `app/ip-report.tsx`, `app/help.tsx`) | App Functionality |
| User Content → Other User Content | `NSPrivacyCollectedDataTypeOtherUserContent` | Profile bio, pronouns and style interests, comments, reviews, product listings, store builder content, designs, AI prompts, uploaded documents | App Functionality |
| Identifiers → User ID | `NSPrivacyCollectedDataTypeUserID` | Clerk account ID used as the Brandthread user ID; RevenueCat app user ID | App Functionality |
| Identifiers → Device ID | `NSPrivacyCollectedDataTypeDeviceID` | Expo push token registered to the account (`lib/contextualPushPermission.ts`) | App Functionality |
| Usage Data → Product Interaction | `NSPrivacyCollectedDataTypeProductInteraction` | Notification received/opened/tapped events (`lib/notificationEventOutbox.ts`); story views; storefront visits (`/api/public/sellers/:id/visit`) and post analytics shown to sellers; shopping preferences for "Personalized recommendations" (`app/shopping-preferences.tsx`) | App Functionality, Analytics, Product Personalization |
| Diagnostics → Other Diagnostic Data | `NSPrivacyCollectedDataTypeOtherDiagnosticData` | Call lifecycle events including failures (`/api/call/events`); request IDs and error logs kept by the API to troubleshoot and secure the service | App Functionality |

## Checked and **not** collected

Leave these unticked in App Store Connect. If a future feature adds one,
update the manifest, this page and the verifier together.

| Data type | Why it is not declared |
| --- | --- |
| Sensitive Info | Apple's category covers racial/ethnic data, sexual orientation, pregnancy, disability, religious or political beliefs, trade-union membership, genetic data and biometric data. **No feature collects any of these.** Face ID is handled by iOS on the device, and the app only receives a success or failure result. Seller identity checks (ID photo and selfie) run on Stripe Identity's hosted page, opened in the external browser (`app/seller-verification.tsx`). Brandthread receives only a session ID and a verified/not-verified status. |
| Precise Location / Coarse Location | The app has no device-location library and never asks for location permission. Addresses are typed by the user and declared as Physical Address. IP addresses are used for rate limiting and passed to Clerk for sign-in security; Brandthread never works out or stores a location from them. |
| Contacts | The app does not read the address book. In-app follows and friends are Brandthread content (Other User Content), not an imported contact list. |
| Search History | Search queries are sent only to return results and are not stored on the server. Recent searches are kept only on the device (`app/(buyer)/search.tsx`). |
| Browsing History | The app does not see what people view outside it. |
| Health & Fitness, Credit Info, Gameplay Content, Advertising Data, Other Usage Data | No feature collects these. |
| Crash Data, Performance Data | The app has no crash-reporting or performance SDK. |
| Other User Contact Info, Other Data Types | Nothing else is collected. Birthday is shown as "managed by Clerk" and is never sent to Brandthread. |

## Required-reason APIs (not part of the questionnaire)

The manifest also declares the required-reason APIs React Native and
AsyncStorage use: File Timestamp `C617.1`, System Boot Time `35F9.1`,
Disk Space `E174.1`, User Defaults `CA92.1`. Nothing to fill in for these;
the build embeds them in `PrivacyInfo.xcprivacy`.

## Before each submission

1. Run `pnpm --filter @workspace/mobile run verify:privacy-manifest:config`.
2. If any feature that sends data to the server was added or changed since
   the date above, re-check this table.
3. Make the App Store Connect answers match this table exactly. Apple rejects
   apps whose labels disagree with the privacy policy (`app/privacy.tsx`).
