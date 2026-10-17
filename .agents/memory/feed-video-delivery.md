---
name: Feed video delivery constraints
description: Decoder budgets, bitrate ceilings, HLS origin handling, and cached URLs during video backfills.
---

Count all prepared native players against the feed's three-player budget, including speculative warmups. Warm additional videos through bounded network requests, not extra native player instances.

**Why:** A separate preload pool added native players beyond the visible current/previous/next pool. Paused prepared players can still compete for native decoding resources. Network prefetch is not proof that AVPlayer's private playback cache is warm.

**How to apply:** Verify mounted and speculative players together; report actual native timing separately from browser playback and HTTP checks.

Treat rendition bitrates as ceilings, not instructions to enlarge an already compressed source. Preserve the source master.

**Why:** Both fixed-rate encoding and a generic CRF/maxrate combination enlarged already compressed clips. Bounding the rate by the probed source bitrate avoided the large increases; small muxing/GOP-related size differences remain possible.

**How to apply:** Compare actual outputs before accepting a backfill. Version immutable encoding profiles whenever settings change. Overall file size is not a measurement of startup latency.

Keep relative HLS playlists on an origin that can authorize every child URL.

**Why:** Redirecting a playlist to a signed storage URL does not sign the variant and segment URLs resolved relative to it.

**How to apply:** Proxy playlists or rewrite/sign every child. Byte segments may redirect independently after authorization.

Preserve authorized old media URLs across backfills, including clients that skip multiple encoding versions.

**Why:** Offline and persisted feed caches can outlive a media URL replacement. Looking up only the post's current URL makes earlier cached URLs fail even though the post remains published.

**How to apply:** Resolve bounded, cycle-safe aliases to the current published post, keeping its current visibility checks; never bypass authorization for an old URL.
