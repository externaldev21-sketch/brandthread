# Buyer tab bar over playing video — before / after

Captured on the web preview build (Chromium, 390x844, dark mode, real motion), `origin/dev` ("before") vs. this branch ("after"). There is no iOS simulator in the environment these were made in, so iOS-only behaviour (UIVisualEffectView blur, native-driver slides) still needs a look on a device.

Scripts (all in `artifacts/mobile/scripts/`):

- `tabbar-over-video-capture.mjs --label <before|after> [--clip busy|runway] [--no-screencast] [--profile]`
- `no-reload-walkthrough.mjs --label <before|after> --build-dir <dev web export>`
- `hold-to-switch-capture.mjs --label after`

## Over a playing video (Threads feed)

The bar's surface is measured as the mean per-channel change (0–255) between consecutive frames, over 24 frames ~110ms apart. That is how much of the video's motion shows through the bar, i.e. the flicker.

| | before | after |
|---|---|---|
| Capsule, busy test clip | 5.5 | **1.5** (−73%) |
| Profile circle, busy test clip | 6.9 | **1.9** |
| Capsule, real runway clip (`assets/videos/fashion_runway_01`) | 1.5 | **0.4** |
| Bare video just above the bar (busy clip, for scale) | 33.0 | 30.8 |
| BuyerTabBar re-renders while the video played (~16s, ~130 React commits) | 0 | **0** |
| BuyerTabBar re-renders during the 10-tap burst (positive control for the counter) | 22 | 22 |

Files:

- `compare-busy-video-bar.jpg` and `compare-runway-video-bar.jpg`: before (top) and after (bottom), the same frame.
- `*/over-video-frames/` and `*/over-video-contact-sheet.jpg`: the frame sequences.
- `compare-bar-edge-zoom-4x.png`: the bar's top edge and the 24pt above it, at 4x. The full-width line just above the capsule is the feed's progress scrubber. It isn't part of the tab bar and is moved up by `claude/tiktok-rail-no-repost`. Nothing shows through or across the bar after this change.
- `compare-discover-bar.png`: a non-video screen. The bar is unchanged; 20 of ~428k pixels differ by more than 8/255, all on the bubble's antialiased edge.

## Rapid 10-tap burst (~8 taps/s)

- `*/burst-10-taps.mp4` and `*/burst-bar-contact-sheet.jpg`: the burst on video.
- `*-timing/results.json`: the same burst without screen capture running.

| web build, no capture | before | after |
|---|---|---|
| ends on the last tapped tab | yes | yes |
| avg fps / p95 frame | 46.9 / 50ms | 47.4 / 50ms |
| press -> route committed, max | 160ms | 149ms |

On web every tab press costs one 65–160ms main-thread task, which is ordinary React rendering of the screens being switched. On web, Reanimated also runs on that thread, so these numbers include it. This PR doesn't change that cost, and web doesn't meet the 100ms / 60fps targets. On iOS/Android the bubble runs on the UI thread and hidden tabs are frozen, so those targets need measuring on a device or release build.

## "Nothing reloads" walkthrough

Threads → Messages → open a thread → back → Threads → Profile → Threads → Profile, recorded in `*/walkthrough/` (mp4 and contact sheet), run on a development build so the preview inbox has threads. Every check passes before and after:

- the same `<video>` element keeps playing, with no `emptied`/`loadstart`, so it is never reloaded;
- Messages and Profile keep the same DOM nodes;
- no spinner or skeleton appears on any return.

Scroll position after backing out of a thread can't be measured on web: the browser hides the Messages list with `display:none` while the thread is on top, which resets `scrollTop`. Native keeps the hidden view's offset. The reload fixes in this PR (refresh errors, a deep-link filter re-applied on focus, a thread opening blank) are on paths this walkthrough doesn't hit.

## Hold to switch accounts

`after/hold-to-switch/`, preview accounts @ava (buyer) and @atelier.noire (seller):

1. Early release at ~320ms: the ring starts and retracts, and nothing switches.
2. Full hold: the ring closes, the app fades through to the seller account, the toast shows `@atelier.noire`, and the seller bar appears.
3. Plain tap: opens Profile.

The `*-ring-contact-sheet.jpg` files are crops of the Profile button.
