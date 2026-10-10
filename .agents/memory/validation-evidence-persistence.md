---
name: Validation evidence persistence
description: Preserve long-running validation evidence across workspace restarts
---

**Rule:** Save long-running merge-validation logs and reports in an ignored workspace directory, not only in `/tmp`.

**Why:** A workspace restart can preserve committed code while removing temporary files and killing the unfinished validation process. Temporary-only evidence then cannot be inspected or reused.

**How to apply:** Keep generated reports out of Git and deployment outputs. After a restart, distinguish checks that actually completed from interrupted checks; rerun interrupted validation rather than claiming it passed.
