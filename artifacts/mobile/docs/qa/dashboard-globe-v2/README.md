# Seller dashboard globe v2: solid continents, activity-only dots, arcs

Hands-on check of the Live globe (`components/SellerOrderGlobe.tsx`) after the
owner's feedback on #1119. Expo web in Chromium at 390×844, demo preview
(`?bt_preview=seller&demo=1`) and fresh store (`?bt_preview=seller`).

## What changed on screen

- **Land is solid.** The silver dot matrix is gone. Continents are filled shapes
  (the Live map's own Natural Earth 1:110m outline), clipped at the horizon so
  land runs right up to the rim, lit from the upper left and shaded toward the
  limb. Black sphere and silver palette are the same as before.
- **Dots only mean activity.** A white glowing dot is a place with a recent
  order (tap: order number, item, amount, place, time, plus "N sessions right
  now" when shoppers are browsing from there too). A silver ring is a place with
  shoppers on the store right now (tap: "Visitors right now · N sessions ·
  City"). No activity, no dot (fresh store: an empty globe).
- **Arcs.** Thin silver lines dart from activity to the store's home (or across
  to another activity point when the store has no location), glow, then fade.
  A new order over the seller socket fires one at once; while the globe is on
  screen recent activity takes turns at a calm cadence. At most 5 fly at once
  and slots recycle. Reduce Motion turns arcs off.

## Results (`globe-v2-check.json`)

| Check | Result |
|---|---|
| Frame pacing over 4 s (rAF) | 240 frames, avg 60 fps, p95 16.8 ms, 0 frames over 33 ms |
| Arcs in flight | 2–3 at once (avg 2.3), cap 5 |
| Land coverage inside the disc | 26% of sampled pixels lit (silver fill) |
| Order popover (front-most order dot) | BT-18591 · Wide Pleated Trousers · $62.00 · Brooklyn, NY · 15h ago, matches the data |
| Session popover (front-most ring) | "2 sessions · Chicago, IL", matches `sessions` |
| Order + sessions popover | BT-18594 · London, GB · "1 session right now" |
| Drag / wheel zoom | yaw +0.53 rad / zoom 1 → 1.25 |
| Captions | "Latest 60 orders · last 7 days" · "10 visitors right now" |
| Fresh store | 0 dots, 0 arcs, "No orders in the last 7 days", no visitor caption |
| Page errors | none |

Native Skia renderer: `globe-native-skia-on-canvaskit.png` draws the native
draw list (`components/globe/GlobeSurface.tsx`: the same `landPath()` /
`arcFrame()` SVG strings, even-odd fill, gradients) on CanvasKit, Skia's own
WASM build; all 8 path strings parsed, including the empty-path placeholder,
and 3 arcs drew. Not run on a device or simulator in this environment.

## Media

- `globe-arcs.gif`: 6 s of the demo globe (arcs firing, dots pulsing, rotation).
- `globe-recording.mp4`: the whole check at 1.5× (taps, popovers, drag, zoom).
- `globe-frame-1/2/3.png`, `globe-zoomed.png`, `globe-order-popover.png`,
  `globe-session-popover.png`, `globe-order-with-sessions-popover.png`,
  `globe-fresh-store.png`, `dashboard-390x844.png`.

The red toast at the bottom of `dashboard-390x844.png` is the dev build's
offline warning that Clerk's hosted script can't load in this sandbox; it isn't
part of the globe.

## Re-running

```
CI=1 EXPO_OFFLINE=1 EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuYnJhbmR0aHJlYWQudGVzdCQ= pnpm exec expo start --web --port 8081
node docs/qa/dashboard-globe-v2/harness/globe-v2-check.mjs /tmp/out/v2
node docs/qa/dashboard-globe-v2/harness/globe-v2-fresh.mjs /tmp/out/v2
node docs/qa/dashboard-globe-v2/harness/globe-v2-animation.mjs /tmp/out/anim
NODE_PATH=<canvaskit-wasm's node_modules> pnpm exec tsx docs/qa/dashboard-globe-v2/harness/skia-canvaskit-render.mts /tmp/out/skia.png
```
