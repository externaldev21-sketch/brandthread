---
name: Expo video screenshot capture
description: How to verify bundled Expo videos when automated app screenshots show a black media plane.
---

Automated app-preview screenshots can capture Expo Video hardware surfaces as black even when the clip loads and plays correctly.

**Why:** A valid bundled H.264/yuv420p clip produced a black screenshot without a player error. Direct frame extraction showed the expected image, and the earlier unsupported-source error disappeared after passing the raw bundled asset module to `useVideoPlayer`.

**How to apply:** Pass local videos to Expo Video as raw `require(...)` modules, not early-resolved asset URIs. Verify codec metadata, extract a representative frame, and inspect Expo logs for player errors. Do not treat a black static screenshot alone as proof that the video is broken.

Cold-start screenshots can also capture an entirely black startup frame before the preview settles, even on non-video routes.

**Why:** Both buyer and seller previews produced black quick captures, but a browser that waited for startup displayed usable empty-account screens. A first-render log alone did not establish that the visible screen had settled.

**How to apply:** If a quick capture is black, distinguish an actual runtime error from a short capture window. For a required startup check, wait for visible interactive content rather than repeatedly taking the same immediate screenshot or reporting success from compilation alone.

The workspace's headless Chromium can lack H.264 decoding altogether.

**Why:** The capture browser returned an empty `canPlayType('video/mp4; codecs="avc1.64001F"')` result for valid H.264/yuv420p uploads whose stored bytes and HTTP range responses were verified independently.

**How to apply:** Check decoder capability before retrying black video captures. Present the real app capture and an extracted poster separately, disclose the capture limitation, and never substitute demo media or claim physical-device playback was verified.