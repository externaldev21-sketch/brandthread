# Store screenshots plan

This reuses the existing screenshot tooling — do not build a new capture pipeline.
See [`artifacts/mobile/scripts/store-screenshots`](../../artifacts/mobile/scripts/store-screenshots)
for the implementation and [`docs/polish/screens/11-screenshots.md`](../polish/screens/11-screenshots.md)
for the separate visual-QA pass that uses the same web build. Commands below are also in
[`docs/app-store/release-flow.md`](../app-store/release-flow.md#store-screenshots).

## How to generate

```powershell
cd artifacts\mobile
pnpm exec playwright install chromium   # once
pnpm run screenshots                    # about 10 minutes, all devices + screens
pnpm run screenshots -- --skip-build    # re-capture without rebuilding (about 5 minutes)
pnpm run screenshots -- --strict        # fail the run instead of skipping a broken screen
```

Output lands in `artifacts/mobile/store-screenshots/`, one folder per required size (see
table below). Demo data (products, prices, seller/buyer names) comes from
`scripts/store-screenshots/demo-data.mjs` — the Northline Studio seller and Jordan Reyes
buyer persona, pinned to a fixed clock so every run looks identical. Edit that file to
change what's shown; do not hand-edit the generated screenshots.

## Required device sizes and where they map

| Store requirement | Tooling folder | Pixels | Upload to |
|---|---|---|---|
| iPhone 6.9″ (iPhone 16 Pro Max class) | `iphone-6.9in/` | 1320 × 2868 | App Store Connect → iPhone 6.9" Display |
| iPhone 6.5″ | *(not currently generated — see note below)* | 1284 × 2778 or 1242 × 2688 | App Store Connect → iPhone 6.5" Display, **only if Apple still requires it for this app's minimum deployment target** — as of the current App Store Connect, the 6.9" set alone satisfies the iPhone requirement for new submissions on recent Xcode/SDK versions. Confirm in App Store Connect at upload time; if a 6.5" set is still requested, add an `iphone-6.5in` entry to `devices.mjs` (copy the `iphone-6.9in` entry and change the CSS size) rather than screenshotting by hand. |
| iPad 13″ (iPad Pro/Air 13") | `ipad-13in/` | 2064 × 2752 | App Store Connect → iPad 13" Display (**required** — iPad is supported, see `ipad-release-checklist.md`) |
| Android phone | `android-phone/` | 1080 × 1920 | Play Console → Phone screenshots |
| Android 7" tablet | `android-tablet-7in/` | 1200 × 1920 | Play Console → 7-inch tablet screenshots |
| Android 10" tablet | `android-tablet-10in/` | 1600 × 2560 | Play Console → 10-inch tablet screenshots |

## The 8 screens captured, in order, with captions

The tooling already captures these 8 screens per device (`scripts/store-screenshots/capture.mjs`).
Below is the caption to overlay/use per store slot — write these into App Store Connect /
Play Console screenshot captions in this order. All 8 are used for iPhone 6.9" and iPad
13"; for Android phone, drop to 6-7 by cutting the theme picker (Android users don't see
that first — see note).

| # | Screen id | What it shows | Caption |
|---|---|---|---|
| 1 | `buyer-feed` | Video-first buyer home feed | "Discover streetwear from independent labels" |
| 2 | `product-sheet` (falls back to `buyer-product-detail` if the sheet can't be captured standalone) | Shop-the-post product sheet / product detail page | "Shop the post — tap any piece you see" |
| 3 | `discover` | Discover grid (Heavyweight Hoodie — Ember, etc.) | "Explore drops and rising labels" |
| 4 | `cart` | Order summary in cart | "Your cart, ready to check out" |
| 5 | `checkout` | Checkout with a real-looking shipping address | "Checkout in seconds, securely" |
| 6 | `seller-dashboard` | Seller dashboard with sales figures ($1,842.50) | "Run your storefront from your phone" |
| 7 | `manufacturer-hub` | Manufacturer hub (Porto Knit Collective) | "Go from design to production" |
| 8 | `theme-picker` | The 12 app-theme picker | "Make it yours — 12 app looks" |

For **Android phone**, if the store listing calls for fewer than 8, keep 1, 3 (or 2), 4,
5, 6, 7 — cut the theme picker (8) since it's a nice-to-have, not core value prop, and
merge 1/2 into one buyer-value shot if only 6 slots are wanted. Minimum useful set is 6:
feed, product/discover, cart, checkout, seller dashboard, manufacturer hub.

## What's NOT covered yet, and needs a human decision

- **iPhone 6.5" set** — see the table note above; add a `devices.mjs` entry only if App
  Store Connect actually rejects the submission without it.
- **Localized screenshots** — the tooling only captures English (demo-data.mjs strings
  are English). Out of scope unless the store listing ships in other languages.
- **App preview video** — not covered by this tooling or this plan. If a preview video is
  wanted, it's a separate, manual recording (e.g. screen-record the feed → shop the post
  → checkout flow on a real device or simulator) — not something `store-screenshots`
  produces.

## Before generating for real submission

1. Rebase this branch onto the latest `dev` first — screenshots reflect whatever's in the
   working tree, and other sessions are actively changing screens.
2. Run with `--strict` once to confirm no screen is silently skipped
   (`store-screenshots/README.md` documents what a skip looks like and why).
3. Spot-check the iPad 13" set against `docs/app-store/ipad-release-checklist.md` — a
   screenshot from a broken iPad layout (stretched pills, cut-off text) should not go to
   App Store Connect even if the capture script succeeds; fix the layout first.
