---
name: Merge-only test boundary
description: Handling stale test failures during a requested upstream-only merge
---

When a merge-only sync exposes an older test that no longer matches the product behavior, do not modify production behavior or silently delete the test to make the sync green. Preserve the merged code, report the failing suite, and scope test repair separately.

**Why:** A payment-detail test combined incomplete animation mocks with an assertion for an obsolete preview-only flow. Updating one mock at a time could not make the obsolete behavioral assertion valid.

**How to apply:** Resolve actual merge conflicts and verify the requested runtime/data outcomes first; distinguish integration regressions from pre-existing or stale test contracts before expanding the merge scope.