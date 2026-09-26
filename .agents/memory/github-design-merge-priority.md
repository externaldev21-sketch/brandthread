---
name: GitHub design merge priority
description: How to resolve reviewed GitHub design changes against local Repl fixes during requested syncs.
---

When syncing reviewed design PRs from GitHub dev, treat origin/dev as the source of truth for conflicting UI screen and component files. Preserve nonconflicting local build or runtime fixes, and report local-only commits so they can be brought into GitHub deliberately.

**Why:** The user reviewed the GitHub design changes and explicitly chose them over divergent local UI when a merge conflict occurred.

**How to apply:** During a requested GitHub dev sync, inspect conflicts before resolution; take the incoming file for UI conflicts when the user has confirmed those PRs as authoritative. Keep unrelated runtime fixes only when they still work with the incoming interface, and verify the combined app with typecheck and preview.