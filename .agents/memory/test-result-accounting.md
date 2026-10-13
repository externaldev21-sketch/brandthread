---
name: Test result accounting
description: Distinguish passing assertions from failed setup and skipped coverage when reporting Vitest results.
---

Check failed file statuses and skipped/pending tests as well as failed assertion counts.

**Why:** A database integration setup hook timed out while the JSON report showed zero failed assertions. The file failed, and its assertions were skipped rather than exercised.

**How to apply:** Do not call a targeted rerun successful solely because `numFailedTests` is zero. Inspect each file's status and setup error, and distinguish preexisting skips from coverage lost to a failed hook.

Explicit Vitest file arguments still obey the active configuration's include patterns. Compare the requested file list against the reported files.

**Why:** A release-script test passed as an explicit CLI argument was silently excluded by the mobile suite's include patterns, even though the other requested files passed.

**How to apply:** Use a narrowly scoped configuration for excluded script tests, run them separately, and include their actual results in the coverage totals.
