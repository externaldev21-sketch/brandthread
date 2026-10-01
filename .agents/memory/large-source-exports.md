---
name: Large source exports
description: Packaging the full runnable app source under the downloadable asset size limit.
---

A project ZIP larger than 100 MiB was rejected by asset registration even though it was a valid archive. The complete runnable app source, including onboarding, every screen, bundled runtime assets, backend, and shared packages, can fit by omitting non-runtime review screenshots and uploaded reference archives.

**Why:** A full project capture containing large visual-review galleries exceeded the asset upload limit, while the runtime-source archive was delivered and passed ZIP integrity verification.

**How to apply:** For requested one-file source exports, inventory tracked files and runtime asset references first. Preserve all code, configs, and bundled app media; exclude only unrelated uploads, generated dependencies, caches, credentials, and non-runtime captures. Verify archive integrity before presenting it, and recheck the live size limit if the platform changes.

Large LFS archives can make working-tree refreshes and merge hooks unexpectedly slow during local batch integration.

**Why:** Working-tree Git audits timed out and left empty index locks, while explicit commit-to-commit comparisons and cached staged checks completed without refreshing archive content.

**How to apply:** Use explicit tree endpoints for read-only history audits and cached checks for staged resolutions. Avoid unnecessary LFS downloads during local source merges; retain archive data and normal LFS configuration. Remove a timeout's empty orphaned lock only after confirming no Git or Git LFS process is active.