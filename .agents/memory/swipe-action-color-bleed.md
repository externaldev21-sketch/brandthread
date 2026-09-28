---
name: Swipe action color bleed
description: Why colored swipe actions behind closed Activity rows must be absent rather than merely covered
---

**Rule:** Do not render the colored action layer behind a closed Activity row. An opaque front and explicit stacking order alone are insufficient to prevent thin strips beneath the trailing thumbnails on some renderers.

**Why:** A user-provided phone screenshot showed lines beneath follows, likes, comments, and orders after a coverage-only fix; a separate web preview looked clean. The cross-renderer seam was easy to miss without the device screenshot.

**How to apply:** Preserve row structure and swipe gestures, mount actions only when a horizontal swipe starts, and remove them when closing finishes. Confirm closed rows have no action nodes and verify the swipe still reveals its buttons.