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

## Following creator-card framing

The owner requires the Following empty-state creator card to preserve at least roughly 80% of a portrait video's height at full card width. Make the card taller instead of accepting a heavily cropped cover-fit preview. Small top/bottom cropping is acceptable; preserve the creator overlay, dismiss control and carousel behavior.

**Why:** The owner repeated that the short card looked zoomed in and explicitly rejected leaving that framing unchanged.

**How to apply:** Protect portrait-height retention in card-sizing tests across phone widths. Do not fix this by changing unrelated Following layout or its overlays.

## Rail avatar preservation

The owner rejected the larger feed-rail avatar and requested the original small circular profile control. Do not enlarge it while polishing icons, shared avatars or other screens.

The avatar and its red follow badge must share the action buttons' horizontal center and stay completely on-screen. Fixing their alignment must not move or restyle the action buttons.

**Why:** An unrelated rail rebuild changed a profile control the owner already liked. Avatar changes must not move or restyle the remaining action groups.

**How to apply:** Treat rail-avatar sizing as independently protected; keep the red follow badge centered over its bottom edge and preserve the other groups' positions.

## Watched-post availability

Watched videos stay in Threads/Following: unseen posts rank first, followed by watched posts. Watch history must never remove posts from fresh pages, pagination or repeat loops, on either client or server.

**Why:** Hiding completed videos made the small official catalogue shrink to its two photo carousels. The owner approved ordering watched posts later instead of hiding them.

**How to apply:** Preserve explicit not-interested, block, privacy and mute exclusions; do not confuse those intentional visibility controls with watch-history ordering.
