# Pre-launch QA checklist

Run this on **all five devices** before every App Store / Play submission and
before a store build moves past 10% (see
[release-flow.md → Staged rollout](release-flow.md#staged-rollout-10--50--100)).
Install the **TestFlight / internal-track build you are about to submit**, not
a dev build.

## Devices

| # | Device | Why it's on the list |
| --- | --- | --- |
| 1 | iPhone SE (3rd gen), 4.7" | Smallest screen, Touch ID, no notch: catches cut-off text and buttons |
| 2 | iPhone 13 | Notch, the most common older size |
| 3 | iPhone 15 Pro | Dynamic Island, 120 Hz |
| 4 | iPhone 16 Pro Max | Largest phone: catches stretched layouts and one-handed reach |
| 5 | iPad (any 11" or 13") | Portrait + landscape, Split View. Also run [ipad-release-checklist.md](ipad-release-checklist.md) |

Use one Android phone too when the build includes Android.

## Every device

### Install and first launch
- [ ] Fresh install from TestFlight opens to the welcome screen with no crash and no white flash.
- [ ] **No tracking (ATT) prompt** and **no notification prompt** on first launch.
- [ ] Notification permission is asked only after an action that needs it (e.g. following a brand or placing an order).
- [ ] Contacts permission is explained in-app before the system prompt appears.

### Core flows (end to end, real account, test card)
- [ ] **Sign up:** Apple → username → interests → done, in under 30 seconds.
- [ ] **Buy:** product → add to bag → checkout → order confirmation → order shows in Orders.
- [ ] **Sell:** create a listing with photos → it appears on the store.
- [ ] **Ship:** seller marks the order shipped / buys a label → buyer sees tracking.
- [ ] **Refund:** buyer requests a refund → seller approves → buyer sees the refund.
- [ ] Sign out lands on the welcome screen; signing back in works.

### Layout
- [ ] Nothing sits under the notch / Dynamic Island, the status bar or the home indicator.
- [ ] Nothing is hidden behind the tab bar; the last row of every list can be scrolled into view.
- [ ] Keyboard never covers the field being typed in (sign-in, checkout address, chat).
- [ ] No text is cut off or overlapping on: Discover, product page, bag, checkout, profile, seller dashboard, Settings.

### Accessibility
- [ ] **Larger Text** at the largest accessibility size (Settings → Accessibility → Display & Text Size): the core-flow screens still work, with no overlapping or unreachable buttons.
- [ ] **VoiceOver:** every icon button on the core-flow screens reads a label; focus moves top to bottom, left to right.
- [ ] **Reduce Motion** on: no large sliding or zooming transitions besides system ones.
- [ ] Brandthread Settings → Accessibility → **Disable haptic feedback** on: no vibration anywhere (likes, follows, add to bag, tab switches).

### Conditions
- [ ] Airplane mode: screens show an offline/error state with Retry, never a blank screen or crash. Turning the network back on recovers.
- [ ] Background the app for 10+ minutes, reopen: still signed in, current screen restored or sensibly reset.
- [ ] Receive a push while the app is closed; tapping it opens the right screen.
- [ ] Settings → About → App version shows the version **and build number** being submitted.

## Release-wide (once per submission)

- [ ] `pnpm run typecheck` and `pnpm test` pass on the release commit.
- [ ] The previous release's crash-free sessions are ≥ 99.8% (`pnpm run release:gate -- --release "<previous release>"`).
- [ ] Store screenshots, privacy labels ([privacy-labels.md](privacy-labels.md)) and the What's New text match this build.

## Sign-off

Copy this table into the release PR or ticket and fill it in.

| Device | iOS version | Build | Tester | Date | Pass / issues |
| --- | --- | --- | --- | --- | --- |
| iPhone SE (3rd gen) | | | | | |
| iPhone 13 | | | | | |
| iPhone 15 Pro | | | | | |
| iPhone 16 Pro Max | | | | | |
| iPad | | | | | |

A submission goes out only when all five rows say **Pass**. Any issue found
gets a ticket, and the row is re-tested on the build that fixes it.
