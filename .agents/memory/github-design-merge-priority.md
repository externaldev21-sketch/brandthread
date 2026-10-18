---
name: GitHub design merge priority
description: How to resolve reviewed GitHub design changes against local Repl fixes during requested syncs.
---

The approved public landing keeps “Shop, sell and design streetwear.” and uses a tilted phone playing a recording of the real app, an email/Get started form, and a download QR code.

**Why:** The owner rejected the fashion-photo carousel redesign, then explicitly approved the Kraken-style hero that retains the original headline and uses the real app capture.

**How to apply:** Preserve this landing concept unless a subsequent request explicitly approves replacing it; retain the real pricing catalogue and do not reintroduce the rejected carousel during bulk merges.

When syncing reviewed design PRs from GitHub dev, treat origin/dev as the source of truth for conflicting UI screen and component files. Preserve nonconflicting local build or runtime fixes, and report local-only commits so they can be brought into GitHub deliberately. Preserve the local development preview selector when the user explicitly asks. For requested dev syncs, use a merge; do not rebase, force-update, or push without a separate instruction.

**Why:** The user reviewed the GitHub design changes and explicitly chose them over divergent local UI when a merge conflict occurred. They later explicitly required merge-only syncing with the local preview selector intact; a concurrent rebase previously disrupted the shared checkout.

**How to apply:** During a requested GitHub dev sync, safeguard uncommitted work, inspect conflicts before resolution, and take the incoming file for UI conflicts when the user has confirmed those PRs as authoritative. Keep unrelated runtime fixes and the requested local preview selector intact, then verify the combined app with typecheck and preview.

For reviewed PRs based on an older GitHub snapshot, the owner's explicit instruction to keep both sides takes precedence over taking an incoming UI file wholesale. Port the PR's described changes into the current shared component when an old route has since become a wrapper.

**Why:** Older PRs can restore monolithic inbox, conversation, or Bag screens and silently bypass newer shared privacy, persistence, quantity, and cache behavior.

**How to apply:** Read each PR's body, identify the current owner of its behavior, and integrate there. Preserve native icon imports and shared haptics while applying the approved visual or interaction change. A merge commit alone is not proof that every described change was integrated. Compare the running fresh buyer and seller previews at 390×844 with the PR's committed screenshots: newer conditional layouts, shared components and preview gates can hide an otherwise merged change. Approved PR layout wins; preserve newer data and persistence behavior underneath it.