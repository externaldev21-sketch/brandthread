# Crash-proofing and iPad risk (static audit + web-preview crawl)

`ios.supportsTablet: true` in `artifacts/mobile/app.json`, so Apple reviews on an
iPad and may rotate it. There is no iOS Simulator on Linux, so this is a static
audit of the high-risk list in `docs/app-store/ipad-release-checklist.md` plus a
Playwright crawl of the web preview. **No app code was changed**: the crawl found
no crash, and the one class of defect that does exist (below) cannot be fixed
invisibly or safely in bulk.

## Crawl method

`artifacts/mobile/scripts/crash-ipad-crawl.mjs` (new, read-only, reuses the store
screenshot harness: fake Clerk, fake API, `?bt_preview=buyer|seller`). Per route it
records `pageerror`, `console.error`, error-boundary text, horizontal page
overflow, and clipped/ellipsised visible text (Dev's text-fit rule).

Sizes: 393x852, 430x932, 820x1180, 1024x1366, plus 1180x820 landscape.
Routes: 9 signed-out, 31 buyer, 30 seller (every screen on the checklist that has
a route, including live, camera, story, call, checkout, report, delete account,
studio, design, store builder, finance).

```
node scripts/crash-ipad-crawl.mjs --skip-build            # all sizes and roles
node scripts/crash-ipad-crawl.mjs --skip-build --sizes ipad-air --only buyer --shots
```

## Results

| Check | Result |
| --- | --- |
| Uncaught page errors, console errors, error boundary, all sizes | PASS: 0 across ~70 routes x 5 sizes |
| Signed-out screens load with every external request blocked (so nothing protected or paid is called) | PASS at all five sizes (no errors, no crash) |
| Horizontal page overflow at 393 / 430 / iPad | PASS: none |
| Text-fit (visible ellipsis or clipped text) at 393 | 2 findings, below |
| Text-fit at 820x1180 and 1180x820 | none |

Text-fit findings on existing screens (reported, not changed):

1. Messages: the note chip above "Your story" is truncated ("Your thou...") at 393
   (about 64px of text cut). `app/(buyer)/inbox.tsx` area.
2. Messages empty state: the white "Send a message" button has no visible
   horizontal padding; the label touches both edges at 393.

Both are on a screen another session owns (Composer / hide-tab-bar work), so they
are listed for that owner rather than patched here. An earlier crawl pass without
a "visible only" filter reported 100+ clipped prices; those were off-screen or
transparent elements, not user-visible, and are filtered out.

## Static audit of the high-risk list

| Risk | Finding | Action |
| --- | --- | --- |
| `Dimensions.get` at module scope | 35 files (every screen the checklist marks High risk, plus MediaCropper, TextOverlayEditor, AiResultsGrid, CommunityMessageRow). Window size is read once at launch, so after an iPad rotation, Split View or Stage Manager resize, widths and heights are stale. It does not throw. Worst cases: `buyer-story-viewer`, `call-screen`, `buyer-live`, `seller-live`, `buyer-product-detail` (gallery width), `design-canvas`, `create-post`. | **OWNER-ACTION.** Converting 35 files to `useWindowDimensions()` is a layout change per screen and needs a device pass; not done blind. If time is short the checklist's fallback is the cheap safe choice: ship iPad portrait-only/full-screen (`requireFullScreen`), which needs Dev's sign-off and a new store build. |
| Rotation-aware code that already exists | 34 files use `useWindowDimensions` (tab bar metrics, ai-brain tablet layout, etc.). No `Dimensions.addEventListener` anywhere. | None |
| Fixed widths | No fixed width over 360 in screen code outside design-export presets, `AuroraGlow` (decorative 400) and `WebAppShell` (web only). 123 `maxWidth` uses. | PASS |
| Modal / sheet presentation | `fullScreenModal` for camera, create-post, stories, live; `modal` for report and comments; no `formSheet`/`pageSheet` so nothing relies on iPad popover geometry. `ActionSheetIOS` is imported in `manufacturer-hub.tsx` but not invoked. | PASS (still tick on device: share sheets use `Share`/`expo-sharing`, which anchor to screen centre on iPad) |
| Camera / live on wide layouts | `camera-capture`, `seller-go-live`, `seller-live`, `buyer-story-create`, `fulfill-order` use `CameraView` full-bleed; sizes come from module-scope `Dimensions`, so the stale-size issue above applies in landscape. Camera preview orientation on iPad landscape is not testable here. | OWNER-ACTION (device) |
| Safe area | 224 files use `useSafeAreaInsets`/`SafeArea`, 46 use `KeyboardAvoidingView`. The existing notch crawl and tab-bar clearance e2e specs cover phone insets. iPad has no notch but has a larger home-indicator and status-bar inset in Stage Manager. | PASS statically, device check |

## Limits of this web crawl

- `components/web/WebAppShell.tsx` renders the app as a fixed-width phone column
  on wide web viewports, so the iPad-size runs prove the screens do not crash at
  a larger window, **not** that the native iPad layout is correct. They cannot
  reproduce native rotation, Split View, Slide Over, Stage Manager, safe-area
  insets, keyboard behaviour, camera, Agora live/calls, StoreKit sheets or
  Sign in with Apple.
- The crawl uses the fake demo API, so real server responses (empty states,
  errors) are not exercised. Signed-out runs check that pages load, not what a
  signed-out user can do.
- Runs are against a build with the preview bypass on; production gates that
  bypass off.

## What Dev still needs a physical iPad or Simulator for

1. Rotate on every High-risk screen in `ipad-release-checklist.md` (stale
   `Dimensions` is the one real finding) and in Split View at 1/3, 1/2, 2/3.
2. Camera, Go live and a call in landscape; microphone/camera permission prompts.
3. In-app purchase sheet and Sign in with Apple on iPad (App Review always
   exercises both).
4. Share sheets and the Manufacturer hub action sheet as popovers; photo picker.
5. Keyboard (external and on-screen) in sign-in, checkout and Messages.
6. Decision: if (1) fails and there is no time to fix it, switch to iPad
   full-screen portrait-only before submission (checklist, "If a high-risk
   screen fails").
