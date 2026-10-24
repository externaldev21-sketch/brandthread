---
name: Concurrent Git operations in shared checkout
description: How to protect and verify work when another session changes Git operation state
---

Check both the unmerged index and literal conflict markers in source before committing a merge. Resolve modify/delete paths separately from paths that have an "ours" version.

**Why:** A batched `git checkout --ours` that includes a path with no stage-two version can fail without restoring the other paths. Staging afterward can hide the unresolved source markers from Git's unmerged-path list.

**How to apply:** Check the command's exit status, resolve each remaining path deliberately, scan the source for markers, and typecheck the final combined tree before delivering it.

Before acting on a rebase you did not start, inspect its original branch, current HEAD, index, and reflog. Preserve the original branch tip with a backup ref and snapshot any uncommitted conflict worktree before aborting; do not continue another session's rebase or manually delete its metadata when abort succeeds.

**Why:** A concurrent session initiated a rebase in the shared checkout during preview verification, detaching HEAD and leaving a mobile file with conflict markers. The app returned HTTP 500 even though the prior merge commit and checks had passed. The original branch tip still held the completed work.

**How to apply:** When Git unexpectedly shows `HEAD (no branch)` or rebase markers, stop ordinary edits and check whether another session owns the operation. If explicitly asked to repair it, back up the branch and uncommitted state before `git rebase --abort`; verify the intended branch, clean tree, and app startup afterward.

An automatic workspace checkpoint can commit a conflict worktree and remove `MERGE_HEAD` while a merge decision is pending, without actually merging the upstream parent. A clean tree and absent conflict markers therefore do not prove that the requested merge finished.

**Why:** In a paused merge, a checkpoint preserved only the local side of a conflict as a new single-parent commit; the upstream branch was still absent from HEAD's ancestry.

**How to apply:** After any pause in a shared Git operation, recheck HEAD's parents, upstream ancestry, unmerged entries, and operation metadata before continuing. If the upstream branch is not an ancestor, resume with a merge rather than treating the clean checkpoint as completion.

Run final merge validation against a stable pre-batch baseline or the complete affected components, not only working-tree differences from HEAD. A checkpoint can commit unvalidated source, making a HEAD-only check examine nothing even while errors remain.

For explicitly ordered PR batches, drive the sequence from the complete authoritative list, not a numeric range or reconstructed subset. Check complete preceding coverage before starting the designated final merge.

**Why:** A specially designated final PR can have a lower number than preceding entries. An incomplete loop can merge it prematurely; an end-only audit discovers the mistake after the no-history-rewrite constraint prevents same-branch repair.

**How to apply:** Verify the ledger equals the exact requested prefix and confirm each incoming head's ancestry before the final merge. Deduplicate ledger rows before counting coverage. With user approval, recover premature terminal merges on a new branch from the preceding commit while retaining the original branch intact; never disguise a reset.

## Reconcile complete UI components

Resolve conflicts across component openings, props, bodies and closing tags as one unit, not as independently selected hunks. Preserve current functional handlers while integrating the incoming presentation.

**Why:** Older UI branches can use a different component hierarchy. Hunk-by-hunk resolution can pair incompatible containers or silently omit the intended UI change even when the branch becomes an ancestor.

**How to apply:** Compare complete components, check types after the conflict batch, and verify the resulting interaction. If an incoming change remains unintegrated, report it explicitly rather than treating ancestry alone as proof of integration.

Keep the authoritative ordered request and per-step audit ledger in an ignored workspace directory, not only in `/tmp`.

**Why:** A workspace runtime replacement discarded temporary audit files while preserving the repository. Git ancestry could recover coverage, but it could not independently recover the user's intended order; the earlier complete-prefix verification was essential.

**How to apply:** Persist the original sequence before starting a long batch and append each actual merge or already-included result durably. Distinguish requested order from order reconstructed from Git history.

When an incoming PR is based on a single-commit snapshot of earlier local integration work, distinguish its actual PR delta from inherited snapshot differences before resolving conflicts.

**Why:** The snapshot and original local commits can contain equivalent earlier work without equivalent ancestry. Ordinary three-way merging then presents hundreds of conflicts that would otherwise revert newer local repairs.

**How to apply:** Identify the incoming PR's own base, compare its changed paths against conflict paths, and preserve the current version for verified snapshot-only conflicts. Manually combine actual overlapping PR edits with current behavior; then verify the requested head is a true ancestor of the completed merge.

Explicitly excluded work must also be excluded from the ancestry of every approved head. Hold a dependent head that contains excluded work rather than merging it and trying to remove selected files afterward.

**Why:** An approved head can include an unapproved visual change through its parent history. Resolving file conflicts does not remove that ancestry or make the exclusion true.

**How to apply:** Fetch the excluded ref read-only when needed, check each requested head with `git merge-base --is-ancestor`, and request a clean replacement head for any dependent PR.

Review unexpected deletions and markerless unmerged paths against the pre-batch tree, not only the visible conflict markers.

**Why:** Older integration snapshots can leave a required native provider absent while its unchanged callers still reference it. A feedback-only merge must not treat that absence as an intentional feature retirement.

**How to apply:** Check baseline existence and indexed merge stages before accepting a deletion. Preserve the current functional dependency, layer the actual incoming change, and confirm native imports and TypeScript after the complete batch.
Preserve established financial field semantics when merging independently designed commerce features; adapt the new feature at the shared pricing/wire boundary rather than replacing the existing engine wholesale.

**Why:** Parallel bundle implementations used different meanings for the same discount field and different shipping assumptions. Blindly combining them risks double discounts, misleading totals, and broken fee validation even when each isolated branch passes.

**How to apply:** Check explicit versus automatic eligibility, keep them mutually exclusive, preserve the existing quote and ledger contracts, and reconcile incoming fixtures with actual shipping and fee inputs. Verify both backend charges and customer-facing savings.

After stacked merges, scan source content for conflict markers as well as checking Git's unmerged index.

**Why:** A partially reconciled component retained embedded markers after the index was resolved; later merges carried them forward without listing that file as an unresolved conflict.

**How to apply:** Before final compilation and restart, check tracked runtime sources for marker lines. A clean Git merge status alone does not establish syntactically valid source.
