---
name: Feed media framing
description: Owner-approved media framing and carousel zoom behavior in feeds and viewers.
---

Videos in the vertical feed always fill the viewport with centered cover/crop. Photos and carousels preserve the posting ratio or natural ratio with contain, over a blurred, darkened copy of the same photo.

**Why:** The owner explicitly rejected video letterboxing and also rejected forcing slideshow photos into 9:16. These are deliberately different presentation rules.

**How to apply:** Keep media behind the floating navigation while reserving clearance for controls and captions. Preserve photo counters, dots and horizontal swiping; do not change navigation styling to solve media framing.

## Carousel interaction contract

The owner wants Instagram/TikTok-style photo browsing across Threads, Following and profile-opened posts. Feed pinch zoom is temporary and springs home on release; full-screen viewer zoom stays until explicitly reset or pinched out. Horizontal paging must not move the vertical feed, and returning to a post should restore its last photo.

**Why:** These two zoom behaviors were explicitly requested for different contexts. Do not unify them into either always-sticky or always-reset zoom.

**How to apply:** Preserve this distinction when sharing carousel components, and keep natural/authored photo framing and neighboring-image preloading in both contexts.

## TikTok feed contract

Threads/Following uses the supplied TikTok iOS flows as the layout and interaction reference. The latest approved header has LIVE as its first text tab, not the older red edge notch. Keep Cart and navigation. The seller swipe/glow and system font are protected exceptions, not redesign targets. Photo auto-advance is optional and defaults off; when enabled it advances every three seconds and stops while interacting or zooming.

**Why:** The owner explicitly requested the whole TikTok feed, not just a loosely similar action rail, while retaining those Brandthread-specific controls and manual photo browsing.

**How to apply:** Compare actual feed states against the reference frames, preserve those exceptions, and never alter real post captions or invent creators merely to produce visual evidence.

The latest approved rail design supersedes the earlier rail brief: Repost lives in the share sheet, not on the rail. Every displayed count remains visible at zero. Rail geometry stays fixed between posts; captions cannot move it. Sound is always on natively (including silent mode), and on after the first gesture on web; there is no mute control or caption music line. Keep the sound disc and persistent paused icon.

**Why:** The owner explicitly approved this newer design over earlier interpretations. Older branches must not restore a Repost rail button, hidden zeros, per-post rail jumps or sound toggles.

**How to apply:** Apply reviewed visual changes on top of the current playback, HLS, carousel and persistence internals; do not replace those internals with an older implementation.
