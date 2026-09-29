---
name: Concurrent Git rebase in shared checkout
description: How to protect work when another session leaves the shared workspace rebasing
---

Before acting on a rebase you did not start, inspect its original branch, current HEAD, index, and reflog. Preserve the original branch tip with a backup ref and snapshot any uncommitted conflict worktree before aborting; do not continue another session's rebase or manually delete its metadata when abort succeeds.

**Why:** A concurrent session initiated a rebase in the shared checkout during preview verification, detaching HEAD and leaving a mobile file with conflict markers. The app returned HTTP 500 even though the prior merge commit and checks had passed. The original branch tip still held the completed work.

**How to apply:** When Git unexpectedly shows `HEAD (no branch)` or rebase markers, stop ordinary edits and check whether another session owns the operation. If explicitly asked to repair it, back up the branch and uncommitted state before `git rebase --abort`; verify the intended branch, clean tree, and app startup afterward.