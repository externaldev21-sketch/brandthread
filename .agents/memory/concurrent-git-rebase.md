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