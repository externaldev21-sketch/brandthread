# Re-applying full-quality media on Replit's live code

This PR is built on GitHub `dev` (Oct 9). Replit's live code is newer: it has an HLS feed
pipeline, `ZoomablePhotoPager`/`PhotoSlide` and other files that `dev` doesn't have. I read
the live files read-only through the Replit connector on Oct 17. Below are the exact live
values that make posts blurry and what to change them to. Everything in section A exists
**only on Replit**, so nothing in this PR's diff touches it. It is also the biggest blur
source: every feed video is streamed at 720p or lower.

## A. Live-only files (not in this PR's diff), the main blur

### `artifacts/api-server/src/lib/feedVideoRenditions.ts`
Live today:
- Ladder `[480, 720]`.
- `crf` is 23 for 720 and 25 for 480.
- `-maxrate` is 1800k for 720 and 800k for 480, capped by the source bitrate.
- `-preset veryfast -r 30`, `-b:a 64k`.
- `master.m3u8` lists **480 first** ("AVPlayer starts conservatively").

Every feed video is therefore at most 1280x720, 1.8 Mb/s, 30 fps, and starts on the
480p / 0.8 Mb/s rung.

Change to:
- **Bump the profile key** so cached 720p renditions are rebuilt:
  `FEED_STREAM_PROFILE = "feed-abr-1080-720-480-hls2-source-cap-v5"`.
- **Ladder `[480, 720, 1080]`.** The 1080 rung is long edge 1920, `-crf 18`,
  `-maxrate min(12000k, source)`, `-bufsize 2x`. The 720 rung is `-crf 20`,
  `-maxrate min(5000k, source)`. The 480 rung stays for weak networks at `-crf 22`,
  `-maxrate min(1500k, source)`.
- **Never upscale.** Keep the existing `min(iw, …)` scale expressions. Use `flags=lanczos`.
- **Keep the source frame rate up to 60.**
  - Drop `-r 30`.
  - Set `-g`/`-keyint_min` to `round(2 * fps)`.
  - Keep `-force_key_frames expr:gte(t,n_forced*2)`, so 2-second segments still line up across rungs.
  - Probe fps with `avg_frame_rate` and cap it at 60. `outputFps()` in this PR's `lib/mediaQuality.ts` does exactly this.
- **HDR.** If the source is HLG/PQ, add the tone map after the scale. Copy
  `hdrToSdrFilter(hasZscale)` and `sdrStage()` from `lib/mediaQuality.ts`.
- **Encoder.** Use `-preset medium` (the threads limit is fine), `-profile:v high`,
  `-level:v 4.2` for 60 fps, and BT.709 tags. Use `-b:a 160k -ar 48000`.
- **`master.m3u8`.** List **1080 first**, then 720, then 480. Set honest `BANDWIDTH` values
  (roughly 1080: 9000000, 720: 4500000, 480: 1600000). AVPlayer starts on the first listed
  variant and only steps down if the network can't keep up. Listing 480 first is why Dev
  sees a soft start.
- **Path regexes.** Add the 1080 rung to `feedStreamMasterPath` and `legacyFeedStreamTarget`,
  changing `(?:480|720)` to `(?:480|720|1080)`. Keep `720.mp4` as the canonical MP4 path if
  you don't want to touch the routes, or switch the canonical path to `1080.mp4` and update
  `routes/post-video.ts`, which hard-codes `/720.mp4`.

### `artifacts/api-server/src/lib/feedVideoEncoding.ts`
- **`meetsFeedVideoProfile` (pass-through gate).** It is applied to the encoded output, so
  it must be raised together with the ladder or every publish throws
  "Encoded video failed playback-profile validation". Change it to
  `max(w,h) <= 1920 && min(w,h) <= 1080 && bitrate <= 14_000_000`, accept HEVC tagged `hvc1`
  as well as h264, and remove the `major_brand` `qt` rejection. Remuxing with
  `-movflags +faststart` gives an `isom`/`mp42` brand anyway.
- **Pass-through.** When a clip has no edits and is already H.264/HEVC SDR at or below
  1080x1920, 60 fps and 20 Mb/s, store a faststart remux instead of re-encoding it. Use
  `canPassthrough()` + `passthroughRemuxArgs()` from `lib/mediaQuality.ts`.
- **`FEED_VIDEO_FFMPEG_ARGS`** (legacy single pass) has the same values as the 720 rung.
  Update it to the 1080-rung settings, or delete it if nothing calls it any more.
- **`createFeedVideoPoster`.** Change `scale=720:-2` to `scale='min(1080,iw)':-2` and keep
  `-q:v 2`, so posters are as sharp as the video.

### `artifacts/api-server/src/lib/muxVideo.ts` (only when the MUX_* env vars are set)
`createMuxAsset` uses `video_quality: "basic"`, Mux's lowest encoding tier. Use
`video_quality: "plus"` and keep `max_resolution_tier: "1080p"`.

### `artifacts/mobile/lib/videoPreload.ts`
- **Web low-rendition swap.** `preferLowFeedRendition` swaps `720.mp4` → `480.mp4` when
  `downlink < 2`. Keep it only for `saveData` / `2g`. On normal connections, play the top rung.
- **`preloadVideoBytes`.** It warms the first child playlist, which is 480 today because 480
  is listed first. Once 1080 is listed first in the master playlist, it warms the right
  rung automatically.

### `artifacts/mobile/components/media/PhotoSlide.tsx` and `ZoomablePhotoPager.tsx`
- **`PhotoSlide`** sizes itself from `onLoad` (`e.source.width/height`) when no authored
  aspect is passed. The frame is full-page until load, then jumps to the contain rect. That
  is Dev's "big, then regular size".
- **Fix:** pass `aspects` from the post's stored sizes. This PR adds `mediaDims` to the post
  payload, and `lib/mediaFrame.ts` `mapMediaDims()` → `resolveAspect()` turns them into an
  aspect. With that, `aspects?.[i]` is always set on frame one.
- **Placeholder and fade.** Pass `placeholder={null}` and `transition={0}` to the foreground
  image. The live `CachedImage` default `placeholder = lowResPlaceholder(source)` flashes a
  32px image, then fades for 180ms.
- **Prefetch.** Prefetch with `Image.prefetch(urls, 'memory-disk')`.

### `artifacts/mobile/lib/imageUploadPrep.ts` (live has per-surface presets)
The presets are avatar/logo 1080, message 1600, and banner/product/post/default 2048, all
at q0.8. Apply this PR's rule instead:
- Send JPEG/PNG/WebP up to 4096 px untouched.
- Re-encode only HEIC, or anything over 4096, at quality 1.
- Keep the 1600 cap for `message` if DM bandwidth matters, but at quality 0.9.

### `artifacts/mobile/components/CachedImage.tsx` (live)
Live defaults are `transition = 180` and `placeholder = lowResPlaceholder(source)`. Keep
them for lists, but feed pages, carousels and posters must pass `placeholder={null}` and
`transition={0}`. This PR makes `placeholder={null}` mean "no placeholder".

## B. Files in this PR whose live version differs. Re-apply these values by hand
| Live file | Live value today | Change to (this PR) |
|---|---|---|
| `routes/post-slide.ts` `SLIDE_CANVAS` | 9:16 720x1280, 3:4 810x1080, 4:5 864x1080, `-q:v 3`, bicubic; thumb 360w `-q:v 4` | 1080 wide for every ratio (1080x1920 / 1080x1440 / 1080x1350 / 1080x1080). Render with `lib/slideRender.ts`: sharp lanczos3 to PNG, ffmpeg draws the text, one libjpeg q92 4:4:4 encode. Thumb 540w q88. Scale overlay fonts by new/old width. Upload stored raw, so no `normalizeUploadedImage` |
| `routes/post-video.ts` compose | 1080x1920 `increase,crop`, `fps=30`, `level 4.0 veryfast crf 20 maxrate 8.5M` | Keep your crop-to-fill if that's the intended look; otherwise use this PR's downscale-only fit + pad. Use `videoEncodeArgs()`: crf 18, 12M peak, slow/medium preset by length, source fps up to 60, 48k/192k audio. HDR tone-mapped. No-edit passthrough |
| `routes/post-carousel.ts` | `crf 21 maxrate 8M fps=30`, poster `-q:v 3` | Video: downscale-only to 1080 wide, `videoEncodeArgs`, source fps. Photo: `format=yuvj444p -q:v 2` |
| `routes/product-videos.ts` | 1280 long edge, `crf 28`, `fps=30` | `renderSilentRendition({ scale: longEdgeFilter() })`: 1920 long edge, crf 18, source fps |
| `routes/profile-cover.ts` | 1280 long edge, crf 28 (GIF crf 26), `fps=30` | Same as product videos. Keep a GIF branch at crf 20 |
| `routes/avatar-video.ts` | 480x480 crf 28 | 800x800 lanczos, crf 18, 6M peak |
| `lib/productImageResize.ts` | 2048 long edge, q80; variants q82 | 2160 wide / 3840 long edge, q90 libjpeg 4:4:4 (not mozjpeg). Variants q88 lanczos3 |
| `lib/mediaCrop.ts` | upscales crops below 1080x1440, `compress: 0.92` | No upscale, `compress: 1` |
| `lib/createPost/publish.ts` | crops the `ph://` uri directly | `resolveLocalAssetUri()` first, so you get the full-res original and `fetch()` can read videos |
| Pickers (story, avatar, product, camera, chat, returns) | 0.7–0.9 | 1 for posts/stories/avatars/products/store images, 0.9 for chat/returns, 0.8 for disputes (Stripe 5 MB) |

## C. New in this PR, which Replit can copy as whole files
- `artifacts/api-server/src/lib/mediaQuality.ts`
- `artifacts/api-server/src/lib/slideRender.ts`
- `artifacts/api-server/src/lib/mediaDimensions.ts`
- `artifacts/api-server/src/lib/postDimsColumns.ts`
- `artifacts/api-server/src/jobs/mediaDimensionsBackfill.ts`
- `artifacts/api-server/scripts/backfillMediaDimensions.ts`
- `artifacts/api-server/scripts/auditOfficialSeedMedia.ts`
- `artifacts/mobile/lib/mediaFrame.ts`
- `artifacts/mobile/lib/createPost/localAssetUri.ts`
- `lib/db/migrations/271_post_media_dimensions.sql`. Renumber it if 271 is taken. It's
  idempotent and tracked by filename.

Plus their tests.
