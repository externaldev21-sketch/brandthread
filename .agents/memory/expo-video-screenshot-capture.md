---
name: Expo video screenshot capture
description: How to verify bundled Expo videos when automated app screenshots show a black media plane.
---

Automated app-preview screenshots can capture Expo Video hardware surfaces as black even when the clip loads and plays correctly.

**Why:** A valid bundled H.264/yuv420p clip produced a black screenshot without a player error. Direct frame extraction showed the expected image, and the earlier unsupported-source error disappeared after passing the raw bundled asset module to `useVideoPlayer`.

**How to apply:** Pass local videos to Expo Video as raw `require(...)` modules, not early-resolved asset URIs. Verify codec metadata, extract a representative frame, and inspect Expo logs for player errors. Do not treat a black static screenshot alone as proof that the video is broken.

Playback intent belongs in effect setup as well as cleanup, not only in the player constructor.

**Why:** Development Strict Mode replays effect cleanup. A constructor-only `play()` paired with effect-cleanup `pause()` can leave a valid, fully loaded preview paused after replay.

**How to apply:** Restore play in the active effect setup and pause in cleanup. Test setup/cleanup replay and confirm that the actual video advances, rather than accepting a decoded first frame as playback proof.

Expo Video's web `VideoView` may not forward its `testID` to the DOM.

**Why:** A locator reported no player even though its HTML video existed and was fully loaded.

**How to apply:** Put automation identifiers on a neutral wrapping View and also inspect the HTML video's paused/readiness state. A missing SDK test identifier is not evidence that no player is mounted.

Cold-start screenshots can also capture an entirely black startup frame before the preview settles, even on non-video routes.

**Why:** Both buyer and seller previews produced black quick captures, but a browser that waited for startup displayed usable empty-account screens. A first-render log alone did not establish that the visible screen had settled.

**How to apply:** If a quick capture is black, distinguish an actual runtime error from a short capture window. For a required startup check, wait for visible interactive content rather than repeatedly taking the same immediate screenshot or reporting success from compilation alone.

The workspace's headless Chromium can lack H.264 decoding altogether.

**Why:** The capture browser returned an empty `canPlayType('video/mp4; codecs="avc1.64001F"')` result for valid H.264/yuv420p uploads whose stored bytes and HTTP range responses were verified independently.

**How to apply:** Probe the current browser rather than assuming this historical limitation still applies. The system Chromium subsequently decoded the real H.264 uploads and rendered them in the feed. Check actual frame callbacks and visible content, not just canPlayType. Disclose any current capture limitation, never substitute demo media, and never claim browser playback verifies an iPhone.

Browser-only codec adaptations can exercise rendering, but cannot establish native playback performance.

**Why:** A test runner could play VP8 copies of the actual uploads, while its H.264 decoder was unavailable. A thumbnail, cold-start frame callback, or a callback from the previous player did not establish swipe-to-first-visible-frame latency.

**How to apply:** Label compatibility renditions and controlled aspect-ratio fixtures explicitly, keep them out of app storage and application code, and never report their measurements as iPhone timings. Require a changed active source before accepting a swipe sample.