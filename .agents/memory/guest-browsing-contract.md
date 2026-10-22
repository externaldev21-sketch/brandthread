---
name: Guest browsing contract
description: Owner-approved public browsing, action-time authentication, navigation return and preview isolation.
---

The owner wants TikTok-style browsing without an account. Open the app on the real buyer feed, not a sign-in screen. Public feeds, Discover/search, public account headers/posts, product pages and comment reading must not acquire authentication walls.

**Why:** The owner explicitly rejected having to sign in throughout the app.

**How to apply:** Ask for sign-in through one dismissible sheet only at account actions. Keep private messages, orders, own editing, checkout and seller functions protected. Following may use an inline sign-in empty state. Dismissal must leave browsing usable; successful sign-in returns to the viewed content and never automatically replays a mutation. Public browsing is not authority to expose friend-only posts, private stories, blocked relationships or private account data.

Opening any screen, deep link, or tab must never automatically show the sign-in sheet, including owner-only routes. Signed-out private screens use a quiet inline state with a Sign in button; only an explicit action/button tap opens the existing sheet.

**Why:** The owner explicitly rejected sign-in prompts on screen entry, even for Messages, Activity, own Profile, Bag, orders, and seller screens.

**How to apply:** Keep authentication navigation effects passive for guests. Guard private screen mounting separately from presenting the sheet, preserve public tab navigation, and verify both cold entry and in-app tab switching.

Fresh browser sessions browse actual public data. Synthetic buyer/seller review remains an explicit development choice, never inferred from a real account's remembered role. Populated fixtures still require the current URL's demo opt-in.

**Why:** A review bypass must not hide real guest behavior or fabricate public content.

**How to apply:** Keep explicit review URLs working across in-tab navigation, allow an explicit guest review to clear that selection, and never carry synthetic review authority onto production hosts.

Preserve intentional session persistence settings, and never sign users out just because a development page reloads or a request loses connectivity. Storage restoration tests are not evidence of an actual multi-day iPhone login.

**Why:** The owner requires sign-in to survive restarts; native device longevity cannot be inferred from a mocked cache test.

**How to apply:** Use actual device/account checks for long-lived session claims and clearly distinguish them from token-storage tests.
