# iPad release checklist

Brandthread ships on iPad from version 1.0 (`ios.supportsTablet: true` in
`artifacts/mobile/app.json`). **This can't be undone**: once an iPad build is
live, Apple won't let later versions drop iPad support. Every item below has
to pass before the first submission, and again for any release that changes
layout.

## What the build does on iPad

- **iPhone** stays portrait-only (`orientation: "portrait"`).
- **iPad** supports all four orientations, plus Split View, Slide Over and
  Stage Manager (the generated `Info.plist` has `UIRequiresFullScreen = false`
  and all four `UISupportedInterfaceOrientations~ipad`). Apple requires this
  for an iPad app that is not full-screen only.
- The app is always dark (`userInterfaceStyle: "dark"`), so keyboards, alerts,
  action sheets and pickers should all render dark.

## Devices

Test every screen on both sizes, in **portrait and landscape**:

| Device | Where |
| --- | --- |
| iPad Pro / iPad Air **13-inch** | TestFlight on a real device, or Xcode Simulator on a borrowed Mac / cloud Mac |
| iPad Pro **11-inch** / iPad Air 11-inch | Same |

Without a Mac, use a real iPad with the TestFlight build (see
[release-flow.md](release-flow.md)). Take the App Store 13-inch iPad
screenshots at the same time, since App Store Connect requires them once iPad
is supported.

## Pass criteria for every screen

For each screen, in each of the 4 combinations (11-inch/13-inch × portrait/landscape):

1. Nothing is cut off, overlapping or stuck behind the status bar or home indicator.
2. Content isn't stretched into unreadable full-width lines: text, cards and forms stay a sensible width.
3. Images and video keep their aspect ratio (no squashing or letterboxing where it shouldn't be).
4. **Rotate while on the screen**: the layout reflows at once, without needing to leave and come back.
5. The keyboard (external and on-screen) doesn't cover the focused field, and it renders dark.
6. Bottom tab bar and headers are placed and sized correctly.
7. Every button and tap target still works (nothing sits under an invisible layer).

## Screens to verify

Tick each cell only after checking all 7 pass criteria above.
**⚠ High risk** marks screens that read the screen width once at load
(`Dimensions.get` at module scope). These are the most likely to break when
the iPad rotates or the window is resized.

### Launch, sign-in and onboarding

| Screen | File | 11″ portrait | 11″ landscape | 13″ portrait | 13″ landscape |
| --- | --- | --- | --- | --- | --- |
| Splash / launch | `app/splash.tsx`, splash in `app.json` | ☐ | ☐ | ☐ | ☐ |
| Onboarding (buyer and seller paths) ⚠ High risk | `app/onboarding.tsx` | ☐ | ☐ | ☐ | ☐ |
| Sign in (email, Apple, Google) | `app/sign-in.tsx` | ☐ | ☐ | ☐ | ☐ |
| Forgot password | `app/forgot-password.tsx` | ☐ | ☐ | ☐ | ☐ |
| Account type / switcher | `app/account-type.tsx`, `app/account-switcher.tsx` | ☐ | ☐ | ☐ | ☐ |
| Thread explainer ⚠ High risk | `app/thread-explainer.tsx` | ☐ | ☐ | ☐ | ☐ |

### Buyer app

| Screen | File | 11″ portrait | 11″ landscape | 13″ portrait | 13″ landscape |
| --- | --- | --- | --- | --- | --- |
| Home feed (tab) | `app/(buyer)/index.tsx`, `app/(buyer)/feed.tsx` | ☐ | ☐ | ☐ | ☐ |
| Discover (tab) | `app/(buyer)/discover.tsx` | ☐ | ☐ | ☐ | ☐ |
| Search | `app/(buyer)/search.tsx` | ☐ | ☐ | ☐ | ☐ |
| Friends (tab) ⚠ High risk | `app/(buyer)/friends.tsx` | ☐ | ☐ | ☐ | ☐ |
| Inbox (tab) | `app/(buyer)/inbox.tsx` | ☐ | ☐ | ☐ | ☐ |
| Conversation, incl. voice message ⚠ High risk | `app/buyer-conversation.tsx`, `app/chat/[id].tsx` | ☐ | ☐ | ☐ | ☐ |
| Profile (tab) ⚠ High risk | `app/(buyer)/profile.tsx` | ☐ | ☐ | ☐ | ☐ |
| Other user's profile ⚠ High risk | `app/buyer-other-profile.tsx`, `app/u/[username].tsx` | ☐ | ☐ | ☐ | ☐ |
| Product detail ⚠ High risk | `app/buyer-product-detail.tsx` | ☐ | ☐ | ☐ | ☐ |
| Drop detail ⚠ High risk | `app/buyer-drop-detail.tsx` | ☐ | ☐ | ☐ | ☐ |
| Cart | `app/(buyer)/cart.tsx` | ☐ | ☐ | ☐ | ☐ |
| Checkout | `app/buyer-checkout.tsx` | ☐ | ☐ | ☐ | ☐ |
| Orders and order detail | `app/(buyer)/orders.tsx`, `app/buyer-order-detail.tsx` | ☐ | ☐ | ☐ | ☐ |
| Story viewer ⚠ High risk | `app/buyer-story-viewer.tsx` | ☐ | ☐ | ☐ | ☐ |
| Story create ⚠ High risk | `app/buyer-story-create.tsx` | ☐ | ☐ | ☐ | ☐ |
| Post viewer and comments | `app/buyer-post-viewer.tsx`, `app/buyer-post-comments.tsx` | ☐ | ☐ | ☐ | ☐ |
| Saved and archive ⚠ High risk | `app/buyer-saved.tsx`, `app/buyer-archive.tsx` | ☐ | ☐ | ☐ | ☐ |
| Watch a live stream ⚠ High risk | `app/buyer-live.tsx` | ☐ | ☐ | ☐ | ☐ |
| Notifications | `app/buyer-notifications.tsx` | ☐ | ☐ | ☐ | ☐ |
| Settings and personal details | `app/buyer-settings.tsx`, `app/buyer-personal-details.tsx` | ☐ | ☐ | ☐ | ☐ |
| Addresses and payment methods | `app/buyer-addresses.tsx`, `app/buyer-payment-methods.tsx` | ☐ | ☐ | ☐ | ☐ |
| Report a problem / content ⚠ High risk | `app/buyer-problem-report.tsx`, `app/buyer-report.tsx` | ☐ | ☐ | ☐ | ☐ |

### Seller app

| Screen | File | 11″ portrait | 11″ landscape | 13″ portrait | 13″ landscape |
| --- | --- | --- | --- | --- | --- |
| Dashboard (tab) | `app/(tabs)/index.tsx` | ☐ | ☐ | ☐ | ☐ |
| Studio create menu ⚠ High risk | `app/(tabs)/studio.tsx`, `components/SellerStudioRadialMenu.tsx` | ☐ | ☐ | ☐ | ☐ |
| Products (tab) and product editor | `app/(tabs)/products.tsx`, `app/product-editor.tsx`, `app/add-product.tsx` | ☐ | ☐ | ☐ | ☐ |
| Orders (tab) and order detail | `app/(tabs)/orders.tsx`, `app/order-detail.tsx` | ☐ | ☐ | ☐ | ☐ |
| Profile (tab) / seller profile ⚠ High risk | `app/(tabs)/profile.tsx`, `app/seller-profile.tsx` | ☐ | ☐ | ☐ | ☐ |
| Analytics and post analytics ⚠ High risk | `app/(tabs)/analytics.tsx`, `app/post-analytics.tsx` | ☐ | ☐ | ☐ | ☐ |
| Marketing | `app/(tabs)/marketing.tsx` | ☐ | ☐ | ☐ | ☐ |
| Create post ⚠ High risk | `app/create-post.tsx` | ☐ | ☐ | ☐ | ☐ |
| Camera capture | `app/camera-capture.tsx` | ☐ | ☐ | ☐ | ☐ |
| Design studio home ⚠ High risk | `app/design.tsx` | ☐ | ☐ | ☐ | ☐ |
| Design canvas, incl. text overlay ⚠ High risk | `app/design-canvas.tsx`, `components/TextOverlayEditor.tsx` | ☐ | ☐ | ☐ | ☐ |
| Design AI tools (photoshoot, bg removal, text-to-design, mockups, sketch upload, export) ⚠ High risk | `app/design-*.tsx` | ☐ | ☐ | ☐ | ☐ |
| AI studio | `app/ai-studio.tsx` | ☐ | ☐ | ☐ | ☐ |
| Store builder, editor and preview | `app/store-builder.tsx`, `app/store-editor.tsx`, `app/store-preview.tsx` | ☐ | ☐ | ☐ | ☐ |
| Product store ⚠ High risk | `app/product-store.tsx` | ☐ | ☐ | ☐ | ☐ |
| Seller inbox and conversation ⚠ High risk | `app/seller-inbox.tsx`, `app/seller-conversation.tsx` | ☐ | ☐ | ☐ | ☐ |
| Go live ⚠ High risk | `app/seller-go-live.tsx`, `app/seller-live.tsx` | ☐ | ☐ | ☐ | ☐ |
| Inventory | `app/inventory.tsx` | ☐ | ☐ | ☐ | ☐ |
| Finance and payouts | `app/finance.tsx`, `app/payouts.tsx` | ☐ | ☐ | ☐ | ☐ |
| Manufacturer hub (check the "More" action sheet) | `app/manufacturer-hub.tsx` | ☐ | ☐ | ☐ | ☐ |
| Seller verification | `app/seller-verification.tsx` | ☐ | ☐ | ☐ | ☐ |
| Settings | `app/settings.tsx`, `app/seller-settings.tsx` | ☐ | ☐ | ☐ | ☐ |

### Shared screens

| Screen | File | 11″ portrait | 11″ landscape | 13″ portrait | 13″ landscape |
| --- | --- | --- | --- | --- | --- |
| Voice / video call ⚠ High risk | `app/call-screen.tsx` | ☐ | ☐ | ☐ | ☐ |
| Plans, subscription and billing (the in-app purchase sheet, which App Review always tests on iPad) | `app/plans.tsx`, `app/subscription.tsx`, `app/billing.tsx` | ☐ | ☐ | ☐ | ☐ |
| Share profile / store, QR code | `app/share-profile.tsx`, `app/share-store.tsx`, `app/buyer-qr-code.tsx` | ☐ | ☐ | ☐ | ☐ |
| Privacy Policy and Terms | `app/privacy.tsx`, `app/terms.tsx` | ☐ | ☐ | ☐ | ☐ |
| Help | `app/help.tsx` | ☐ | ☐ | ☐ | ☐ |

## iPad-specific checks (do these once on each device)

| Check | 11″ | 13″ |
| --- | --- | --- |
| Share sheets open as a popover next to the button that opened them, and can be dismissed (profile, store, post, Thread video, data export, tech pack) | ☐ | ☐ |
| Action sheets (Manufacturer hub → More) appear and can be dismissed | ☐ | ☐ |
| System permission prompts (camera, microphone, photos, Face ID, notifications) show the Brandthread wording, in dark style | ☐ | ☐ |
| Photo picker and camera open and return the selected media in both orientations | ☐ | ☐ |
| **Split View** at ⅓, ½ and ⅔ width: app still works and relaunches correctly | ☐ | ☐ |
| **Slide Over**: app works as a narrow phone-sized window | ☐ | ☐ |
| **Stage Manager** (M-series iPads): resize the window freely, and the layout follows | ☐ | ☐ |
| External keyboard: typing, Return and Tab work in sign-in, checkout and messages | ☐ | ☐ |
| Sign in with Apple completes on iPad | ☐ | ☐ |
| Push notification tap opens the right screen | ☐ | ☐ |
| App icon (and each alternate icon in App Icon settings) looks right on the home screen | ☐ | ☐ |

## If a high-risk screen fails

These screens compute sizes from `Dimensions.get('window')` once, when the
file loads, so they don't react to rotation or window resizes. The fix is to
read the size inside the component with `useWindowDimensions()` and derive
layout values from it. Fix every failing screen before submitting. If time
runs out, the fallback is to make iPad full-screen and portrait-only (set
`ios.requireFullScreen: true` and a portrait-only
`UISupportedInterfaceOrientations~ipad`). That needs a new store build and
means Split View and landscape won't work. Only do it with the owner's
sign-off.

## Sign-off

| Device | Tester | Build number | Date | Result |
| --- | --- | --- | --- | --- |
| iPad 11-inch | | | | |
| iPad 13-inch | | | | |
