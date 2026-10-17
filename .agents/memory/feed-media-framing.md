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

Threads/Following uses the supplied TikTok iOS flows as the layout and interaction reference, but keeps Brandthread's red LIVE side tab, Cart and navigation. The seller swipe/glow and system font are protected exceptions, not redesign targets. Photo auto-advance is optional and defaults off; when enabled it advances every three seconds and stops while interacting or zooming.

**Why:** The owner explicitly requested the whole TikTok feed, not just a loosely similar action rail, while retaining those Brandthread-specific controls and manual photo browsing.

**How to apply:** Compare actual feed states against the reference frames, preserve those exceptions, and never alter real post captions or invent creators merely to produce visual evidence.

The owner reiterated that all five rail counts must remain visible at zero and the rail must stay compact. Align Share to the caption text's last line, not the music row or a footer disc's bottom.

**Why:** Earlier rail revisions contradicted the explicit count/spacing brief, and adding a sound-disc footer can silently shift the Share anchor.

**How to apply:** Follow the latest explicit rail specification over older spacing conventions, measure the caption and footer independently, and leave LiveEdgeTab's measured-label sizing alone.
