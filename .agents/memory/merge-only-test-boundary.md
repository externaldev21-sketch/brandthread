---
name: Merge-only test boundary
description: Handling stale test failures during a requested upstream-only merge
---

When a merge-only sync exposes an older test that no longer matches the product behavior, do not modify production behavior or silently delete the test to make the sync green. Preserve the merged code, report the failing suite, and scope test repair separately.

**Why:** A payment-detail test combined incomplete animation mocks with an assertion for an obsolete preview-only flow. Updating one mock at a time could not make the obsolete behavioral assertion valid.

**How to apply:** Resolve actual merge conflicts and verify the requested runtime/data outcomes first; distinguish integration regressions from pre-existing or stale test contracts before expanding the merge scope.

If the requested sync explicitly requires focused tests to pass, reconcile stale source-contract assertions with already-approved shared screens rather than restoring obsolete route implementations. Keep all behavioral tests and do not weaken runtime requirements.

**Why:** Older upstream audits can predate screen extraction and can mistake documented JSX examples for rendered UI. Restoring old screens to satisfy those checks would discard approved features without fixing a runtime bug.

**How to apply:** Follow rendered components when auditing wrappers, distinguish real JSX from comments, and remove only obsolete migration exceptions. Explain which test contracts were updated to match approved behavior.

A passing API test command does not establish that Drizzle prepared the isolated test database when its output includes non-TTY prompt errors. Report that bootstrap warning separately from the suite results.

**Why:** The Drizzle subprocess emitted interactive-prompt errors while the wrapper's exit-code check accepted completion and the suites passed against an existing test schema. Exit status alone did not establish successful schema preparation.

**How to apply:** Keep merge verification scoped to the requested changes; defer deterministic, fail-closed test-schema bootstrap to a separate task. Any test-harness repair must retain isolated-database safety and never reset development or production data.