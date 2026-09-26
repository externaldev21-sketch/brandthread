---
name: Profile video square
description: Why the buyer edit-profile video tile controls the existing profile cover
---

The square next to the buyer's profile-photo circle is the picker and preview for the profile cover video, not a separate video avatar or new profile-video field. The photo remains the circular identity image; the video appears in the profile hero and the edit-page square.

**Why:** The existing cover pipeline already persists a short video, strips audio on the server, and plays it muted on a loop. A second video field would create competing profile-video sources for the same request.

**How to apply:** Keep the square, profile hero, and existing cover management backed by the same video. Only add a distinct profile-video resource if a future user explicitly wants two independently managed videos.