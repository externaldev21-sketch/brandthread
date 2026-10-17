---
name: Validation evidence persistence
description: Preserve long-running validation evidence across workspace restarts
---

**Rule:** Save long-running merge-validation logs and reports in an ignored workspace directory, not only in `/tmp`.

**Why:** A workspace restart can preserve committed code while removing temporary files and killing the unfinished validation process. Temporary-only evidence then cannot be inspected or reused.

**How to apply:** Keep generated reports out of Git and deployment outputs. After a restart, distinguish checks that actually completed from interrupted checks; rerun interrupted validation rather than claiming it passed.

**Resource rule:** Bound Node's heap for large checks, reuse an existing incremental TypeScript cache, and serialize expensive validation with performance measurements.

**Why:** Unbounded cold typechecks have restarted this workspace and interrupted live services. A bounded heap plus incremental validation avoids exhausting the workspace, but a full mobile check after a shared-component change also exceeded the initial 3 GB cap.

**How to apply:** Start conservatively, inspect cgroup memory limit/current usage before increasing the cap, and serialize expensive checks with builds. A cold mobile check completed with a 6 GB heap when sufficient headroom existed; do not assume 3 GB always suffices or remove the cap. Persist checkpoints and never treat timings collected during a competing build/typecheck as an isolated device benchmark.

**Rule:** Confirm that edits actually reached disk after a failed multi-file patch or a delegated implementation report.

**Why:** A failed patch batch reported earlier files as successful even though their changes were absent afterward; delegated reports also described files that had not been written.

**How to apply:** After a nonzero patch result, inspect every intended change from that batch before continuing. Verify the reported files exist and the relevant source changed before counting delegated work as complete.
