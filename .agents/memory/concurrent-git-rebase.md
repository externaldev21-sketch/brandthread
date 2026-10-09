---
name: Concurrent Git operations in shared checkout
description: How to protect and verify work when another session changes Git operation state
---

Before acting on a rebase you did not start, inspect its original branch, current HEAD, index, and reflog. Preserve the original branch tip with a backup ref and snapshot any uncommitted conflict worktree before aborting; do not continue another session's rebase or manually delete its metadata when abort succeeds.

**Why:** A concurrent session initiated a rebase in the shared checkout during preview verification, detaching HEAD and leaving a mobile file with conflict markers. The app returned HTTP 500 even though the prior merge commit and checks had passed. The original branch tip still held the completed work.

**How to apply:** When Git unexpectedly shows `HEAD (no branch)` or rebase markers, stop ordinary edits and check whether another session owns the operation. If explicitly asked to repair it, back up the branch and uncommitted state before `git rebase --abort`; verify the intended branch, clean tree, and app startup afterward.

An automatic workspace checkpoint can commit a conflict worktree and remove `MERGE_HEAD` while a merge decision is pending, without actually merging the upstream parent. A clean tree and absent conflict markers therefore do not prove that the requested merge finished.

**Why:** In a paused merge, a checkpoint preserved only the local side of a conflict as a new single-parent commit; the upstream branch was still absent from HEAD's ancestry.

**How to apply:** After any pause in a shared Git operation, recheck HEAD's parents, upstream ancestry, unmerged entries, and operation metadata before continuing. If the upstream branch is not an ancestor, resume with a merge rather than treating the clean checkpoint as completion.

For explicitly ordered PR batches, drive the sequence from the complete authoritative list, not a numeric range or reconstructed subset. Check complete preceding coverage before starting the designated final merge.

**Why:** A specially designated final PR can have a lower number than preceding entries. An incomplete loop can merge it prematurely; an end-only audit discovers the mistake after the no-history-rewrite constraint prevents same-branch repair.

**How to apply:** Verify the ledger equals the exact requested prefix and confirm each incoming head's ancestry before the final merge. Deduplicate ledger rows before counting coverage. With user approval, recover premature terminal merges on a new branch from the preceding commit while retaining the original branch intact; never disguise a reset.

Keep the authoritative ordered request and per-step audit ledger in an ignored workspace directory, not only in `/tmp`.

**Why:** A workspace runtime replacement discarded temporary audit files while preserving the repository. Git ancestry could recover coverage, but it could not independently recover the user's intended order; the earlier complete-prefix verification was essential.

**How to apply:** Persist the original sequence before starting a long batch and append each actual merge or already-included result durably. Distinguish requested order from order reconstructed from Git history.