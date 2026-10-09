# Launch path, video preload and image pipeline

Measured 2026-09-30 / 2026-10-01 on `claude/reliability-performance` against `dev` @ `b54d9e1`.
Nothing here changes how a screen looks. Everything new is either off until a key is set, inert on web, or defers work that already existed.

## What was and was not measured

| Claim | Measured? | How |
| --- | --- | --- |
| Web bundle bytes before and after | Yes | Production `expo export --platform web` (preview build from `scripts/store-screenshots/harness.mjs`) |
| Time until the first real screen on web | Yes | Playwright, 393x852, CPU throttled 4x, cache off, median of 7 (`scripts/launch-perf.mjs`) |
| App launch under 2 s on a phone | **No** | There is no simulator or device on this machine. No iOS/Android launch number is claimed anywhere in this PR. |
| Video preload hit rate, disk cache hit rate | **No** | `expo-video` caching and `createVideoPlayer` are native-only. The manager is unit tested; real behaviour needs a device. |
| Image upload size on a real camera photo | Partly | Server resize and EXIF stripping are tested with sharp. The client step (`expo-image-manipulator`) needs a device or simulator. |

## Launch path

What runs before the first paint, in order (native):

1. `index.ts` imports `lib/bootstrap`: `LogBox` config, `initMonitoring()` (Sentry, a no-op without a DSN) and web style injection. Crash capture stays here on purpose so start-up crashes are reported.
2. `expo-router/entry` evaluates `app/_layout.tsx`, which calls `SplashScreen.preventAutoHideAsync()` at module load.
3. `RootLayout` renders `AppIntroSplash`. It reads the persisted theme and first-launch flag from AsyncStorage, then calls `SplashScreen.hideAsync()`. The JS intro draws the same frame as the native splash, so the hand-off is invisible. The app tree mounts underneath at the same time, so data loading runs in parallel with the intro animation. The intro is the signature launch animation and was not touched.
4. Inter fonts load through `useFonts`; the intro holds on the logo until they are ready, so text never renders in a fallback face.
5. Clerk loads (`ClerkLoading` shows `BootScreen`; `ClerkBootGate` offers Retry after 12 s).

Existing behaviour that already followed the brief (confirmed, not changed): the OTA check is native (`updates.checkAutomatically: ON_LOAD`, `fallbackToCacheTimeout: 0`) and `lib/otaUpdates.ts` only registers a foreground listener; `lib/appStartPrefetch.ts` warms every tab after `InteractionManager.runAfterInteractions`; `RevenueCat`, `skia`, `stripe`, `view-shot` and the call SDK are only pulled in by the screens that use them (dynamic `import()` or route-level), not by the root layout.

### Changes

| Change | Where | Effect |
| --- | --- | --- |
| Deferred appearance-asset preload, notification-event flush, granted-push-token check and the OTA foreground-listener registration until after first paint | `lib/deferStartup.ts`, `app/_layout.tsx`, `lib/bootstrap.ts` | Four pieces of non-critical work no longer run inside the first render/effect pass. `runAfterFirstPaint` uses `InteractionManager.runAfterInteractions` with a 3 s ceiling so the work still runs if an animation keeps the queue busy. The push-token effect records the user as registered only when the work actually runs, so a cancelled pass retries. |
| One JS chunk per route on the **web** export | `app.config.js` (marker file), `scripts/build-web.js` | See numbers below. Native is unaffected (Metro already evaluates modules lazily with inline requires). |

Why a marker file and not `app.json`: `runtimeVersion.policy` is `fingerprint`, and a changed `extra.router` would change the native fingerprint and strand existing builds from OTA updates. `scripts/release-tooling.test.ts` also forbids `process.env` in `app.config.js`. `build-web.js` writes `.web-async-routes` for the duration of the web export and removes it on exit; the file is git-ignored; native and EAS builds never see it (`tests/appConfigAsyncRoutes.test.ts` asserts the native config is unchanged without the marker). Export with `BRANDTHREAD_WEB_ASYNC_ROUTES=0 pnpm run build` to get the old single bundle.

### Web numbers (this machine, headless Chromium, 4x CPU throttle, no cache)

| | Before | After | Change |
| --- | ---: | ---: | ---: |
| JavaScript fetched before the first screen | 11.41 MB (1 file) | 7.57 MB (6 files) | -34% |
| Time to the buyer home screen (median of 7) | 4892 ms | 4139 ms | -15% |
| Largest single route chunk | n/a (everything in the entry) | 176 KB (`design-canvas`) | |

Run-to-run spread was about 4.5-5.2 s before and 4.0-4.7 s after. `__common` (shared node_modules code, 5.46 MB) and the router entry (2.09 MB) dominate what is left; route chunks are small (the next largest after `design-canvas` are 101 KB and 95 KB). Splitting `__common` further is a Metro/vendor question this PR does not attempt.

**This is not a sub-2 s launch and the PR does not claim one.** On a phone the cost is Hermes bytecode load, native module init and Clerk, none of which the web build measures. To measure on a device: build a preview/release binary, cold-start it ten times from a force-quit with the screen recording running (or `adb shell am start -W` on Android, Xcode Instruments "App Launch" on iOS), and read time to the first interactive frame of the home tab.

Re-run:

```bash
cd artifacts/mobile
git worktree add /tmp/base origin/dev && (cd /tmp/base && pnpm install --frozen-lockfile)
(cd /tmp/base/artifacts/mobile && node -e "import('./scripts/store-screenshots/harness.mjs').then(m => m.buildPreviewWeb('/tmp/before', '/tmp/base/artifacts/mobile'))")
echo marker > .web-async-routes   # what build-web.js does for the real export
node -e "import('./scripts/store-screenshots/harness.mjs').then(m => m.buildPreviewWeb('/tmp/after'))"; rm .web-async-routes
node scripts/launch-perf.mjs --before /tmp/before --after /tmp/after --runs 7
```

## Video feed preload and cache

Files: `lib/videoPreload.ts` (pure logic), `hooks/useFeedVideoPreload.ts` (React glue), a three-line hook-in in `app/(tabs)/feed.tsx`. The create flow and the Following tab are untouched.

Behaviour:

- The feed list already mounts a real player for the active page and the page after it (`preload` on `VideoVisual`, `lib/feedPager.ts`). The manager adds the next video beyond that, so **current, current+1 and current+2 are all warm** and no more than two extra players ever exist (`maxWarm = 2`).
- Each warm player is `createVideoPlayer({ uri, useCaching: true })`, muted and paused. It buffers into expo-video's on-disk LRU cache, so the real player that mounts for that page later, a replay, and a swipe back are served from disk. `withVideoCaching` adds `useCaching: true` to remote feed sources on native (same object reference per uri). The cache budget is set to 512 MB (`setVideoCacheSizeAsync`, default is 1 GB).
- Released the moment a page leaves the window, and all at once when the app leaves the foreground, the feed unmounts, or the user is signed out.
- Never on web (the browser owns `<video>` buffering; `useCaching` is native-only) and never signed out, so the signed-out preview never preloads anything.
- Data saver: honoured where the platform exposes it (`navigator.connection.saveData` / 2g). React Native has no public API for iOS Low Data Mode or Android Data Saver without a new native module, so on phones this check returns false. It is isolated in `detectDataSaver` for the day a native signal is added.
- Posters: the feed already prefetches the next two posters with `expo-image`; that code is unchanged.

Tests: `tests/videoPreload.test.ts` (planning, caching source, warm limit, release on scroll, cancel, data saver, failure tolerance). `tests/feed-video-plays.web.mjs` still passes on this branch exactly as on `dev` (it reports the runner's missing codec as a non-fatal skip on both).

## Image pipeline

### Client (one helper, both upload paths)

`lib/imageUploadPrep.ts` is called from `lib/api.ts` `uploadImage()` (every raw-body picker upload: product photos, post slides, avatar, logo, banner, manufacturer photos and thread attachments, returns evidence, sample-order photos) and `lib/uploadWithProgress.ts`. It:

- caps the long edge at **2048 px** (never upscales, keeps aspect ratio),
- re-encodes JPEG at **0.8**; PNG stays PNG (cut-out transparency survives) and WebP stays WebP; HEIC/HEIF becomes JPEG; GIF is sent untouched,
- drops EXIF/GPS (the manipulator decodes to pixels and writes a new file),
- fails open: on any error the original image uploads unchanged.

It extends `uploadImage` rather than adding another uploader. Not covered on the client: the direct-message photo sender (`app/buyer-conversation.tsx`, `app/seller-conversation.tsx`), which sends a base64 string from the picker at quality 0.85 to `/api/conversations/upload-media` and is capped on the server instead; `design-campaign.tsx` (Design area, off limits); and the AI endpoints in `services/aiService.ts`. `app/add-product.tsx`, `store-from-logo.tsx` and `store-from-social.tsx` already run their own `expo-image-manipulator` compress step before they reach `uploadImage`, which now just caps and strips again (a no-op resize).

### Server (extends `productImageResize.ts`)

| Route | Change |
| --- | --- |
| `POST /api/products/images` | image normalised before storage |
| `POST /api/posts/photo-slides` | normalised; response `contentType`/`size` describe what was stored |
| `POST /api/sample-orders/:id/images/upload` | normalised |
| `POST /api/returns/evidence` | normalised |
| `POST /api/seller/profile/{avatar,logo,banner}/upload` | normalised |
| `POST /api/conversations/upload-media` | images normalised and stored with immutable `Cache-Control`; video and audio unchanged |
| Communities photo upload | already re-encoded (EXIF stripped, 2048 px cap) by existing code; left alone |

`normalizeUploadedImage` applies EXIF orientation, caps at 2048 px, re-encodes at quality 80 and strips metadata. It stores the original bytes when it cannot decode the file, for GIFs, and for files that are already within the cap, have no EXIF block and would not get smaller. The existing magic-byte validation still runs first. `getChatCardImagePath` is now a thin wrapper over the generalised `getImageVariantPath(path, width)` (`snapVariantWidth` picks from 240/480/720/1080/1600). Variant objects are written with `Cache-Control: private, max-age=31536000, immutable` (their paths are a random UUID plus a width suffix and are never rewritten). `createObjectEntityFromBuffer` takes an optional `cacheControl`; default stays `private, max-age=0`.

Tests: `src/lib/__tests__/imageNormalize.test.ts` (size math, aspect ratio, never upscale, EXIF/GPS stripped, orientation applied, PNG alpha kept, GIF and garbage pass-through), `cdnUrl.test.ts`, existing `productImageResize.test.ts`; mobile `tests/imageUploadPrep.test.ts`.

### CDN URLs (off unless configured)

| Variable | Where | Meaning |
| --- | --- | --- |
| `CDN_BASE_URL` (or `ASSET_CDN_URL`) | API server | Origin of a CDN in front of object storage. Signed object URLs on `https://storage.googleapis.com` are returned on this origin with path and signature query unchanged. |
| `EXPO_PUBLIC_CDN_BASE_URL` | mobile build | Same origin; `CachedImage` rewrites storage URLs through it (`lib/cdnUrl.ts`). |

Unset (the default) means every URL is returned exactly as today. The CDN must use the storage host as its origin and forward the query string, because the signature lives in it. Foreign hosts (for example imported Shopify images) are never rewritten. Where to get it: any CDN that can front a Google Cloud Storage bucket (Cloudflare, Fastly, Cloud CDN). Nothing here requires one.

## Environment variables added

| Key | Required | Default |
| --- | --- | --- |
| `CDN_BASE_URL` / `ASSET_CDN_URL` (API) | no | unset = no rewriting |
| `EXPO_PUBLIC_CDN_BASE_URL` (mobile) | no | unset = no rewriting |
| `BRANDTHREAD_WEB_ASYNC_ROUTES=0` (build time) | no | unset = web export uses one chunk per route |
