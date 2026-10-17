# Full-quality media — proof

## Test media
The sandbox had no network access, so the inputs are **synthetic iPhone-style files**. `scripts/mediaQualityBench/mkphoto.py` builds them:
- **12 MP photo:** 4032x3024 JPEG q95, EXIF orientation 6 (stored landscape, shown portrait), with fine text, line gratings, a zone plate and sensor-like noise.
- **1080p30 clip:** 1080x1920 H.264, about 15 Mb/s, with AAC 48 kHz audio.
- **4K60 HDR clip:** 2160x3840 HEVC Main10, tagged HLG/BT.2020.

Both clips pan quickly over that photo with per-frame grain, a worst case for any encoder. Real footage compresses to lower bitrates at the same CRF.

## How the numbers were made
`scripts/mediaQualityBench/before.mjs` replays the old pipelines with their exact settings. `after.ts` runs the new code (`lib/mediaQuality`, `lib/slideRender`, `lib/productImageResize`). On-device JPEG steps (picker, crop, upload prep) are simulated with libjpeg at the same quality numbers.

- `before-after-table.md` gives resolution, encoder settings, bitrate and file size for every path.
- **SSIM** is measured against the original photo, with both shown at 1290 px wide (a 3x iPhone screen).

## Crops
`*.png` (other than the frame sequence) are side-by-side crops of the same region, as shown full-screen on a 1290 px-wide 3x iPhone and zoomed 2x (nearest neighbour), so individual pixels and artifacts are visible.

## Return-to-Threads frame sequence
`feed-return-sequence.png` shows Threads (slideshow), then Messages, then Home tapped. It includes the first frame after the tap, +60 ms, +250 ms, and settled.

The `feed-return-frames-*.json` files log, on every animation frame for 2.5 s after tapping Home, the on-screen rect of each visible image:
- **Before:** the slideshow `<img>` box was always 393x852, with the photo letterboxed inside it by `object-fit`.
- **After:** the box is the photo's own 393x699 rect, computed from its stored pixel size. It is identical on all 95 frames, with no fade and no placeholder.

The capture uses the `demo=1` web preview, through `e2e/feed-return-frames.mjs`. It was taken
with the @brandthread demo slideshow from pr/1052, since GitHub `dev` has no slideshow in
its demo feed. The web harness keeps the Home tab mounted, so even the old code holds its
size there. The real snap happens on a fresh native mount: a full-screen `cover` preview
image is replaced by the slide letterboxed with `contain`, which is the
"big then regular size" Dev saw. The fix sizes both from the stored pixel size
(`lib/mediaFrame` `slideFrame`, covered by unit tests). It should still be confirmed on a phone.

`live-feed-720p-rung-vs-after.png` and `live-feed-480p-first-rung-vs-after.png` compare
what the live Replit app actually streams (its 720/480 HLS rungs, `REAPPLY_ON_REPLIT.md` §A)
with this PR's output.
