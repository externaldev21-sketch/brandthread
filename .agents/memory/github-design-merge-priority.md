---
name: GitHub design merge priority
description: How to resolve reviewed GitHub design changes against local Repl fixes during requested syncs.
---

When syncing reviewed design PRs from GitHub dev, treat origin/dev as the source of truth for conflicting UI screen and component files. Preserve nonconflicting local build or runtime fixes, and report local-only commits so they can be brought into GitHub deliberately. Preserve the local development preview selector when the user explicitly asks. For requested dev syncs, use a merge; do not rebase, force-update, or push without a separate instruction.

**Why:** The user reviewed the GitHub design changes and explicitly chose them over divergent local UI when a merge conflict occurred. They later explicitly required merge-only syncing with the local preview selector intact; a concurrent rebase previously disrupted the shared checkout.

**How to apply:** During a requested GitHub dev sync, safeguard uncommitted work, inspect conflicts before resolution, and take the incoming file for UI conflicts when the user has confirmed those PRs as authoritative. Keep unrelated runtime fixes and the requested local preview selector intact, then verify the combined app with typecheck and preview.