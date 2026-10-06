---
name: Store responsiveness boundary
description: Performance and authority boundaries when rendering or editing a locally saved store draft.
---

Saved store drafts may render and accept local edits before remote publication verification finishes. Publishing, restoring server versions, and other authority-sensitive actions must retain their server verification. A visible draft is not evidence that the storefront is live.

**Why:** The user reported unacceptable lag while clicking through the preview. Repeated server reads and replacing existing content with loading screens made ordinary draft navigation depend on network latency. Removing those waits must not weaken publication truth.

**How to apply:** Keep local draft edits independent of remote read latency; refresh server-owned status separately and ignore results after the initiating screen loses focus. Measure browser click-to-content and native animation frames separately—fast browser navigation does not establish smooth physical-iPhone rendering.
