---
name: Recently watched semantics
description: Product rule for video history distinct from ordinary feed views.
---

Recently watched is an account-scoped recovery tool for videos someone actually played. Do not populate it from the feed's ordinary view/impression count or from merely opening a video page. Count meaningful playback progress, keep the latest watch per video, and show only watches from the preceding 36 hours that the viewer can still access.

**Why:** The user specifically wants to recover a clip after accidentally refreshing. Counting swipe-past impressions would bury the clip they really watched, while retaining inaccessible or expired clips would be misleading and could expose private content.

**How to apply:** Any new video player that should contribute to buyer watch history must report actual playback through the same account-bound API; list reads must recheck current visibility and block/friend access. Exclude live broadcasts and non-video posts.