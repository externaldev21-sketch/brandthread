---
name: Large source exports
description: Packaging the full runnable app source under the downloadable asset size limit.
---

A project ZIP larger than 100 MiB was rejected by asset registration even though it was a valid archive. The complete runnable app source, including onboarding, every screen, bundled runtime assets, backend, and shared packages, can fit by omitting non-runtime review screenshots and uploaded reference archives.

**Why:** A full project capture containing large visual-review galleries exceeded the asset upload limit, while the runtime-source archive was delivered and passed ZIP integrity verification.

**How to apply:** For requested one-file source exports, inventory tracked files and runtime asset references first. Preserve all code, configs, and bundled app media; exclude only unrelated uploads, generated dependencies, caches, credentials, and non-runtime captures. Verify archive integrity before presenting it, and recheck the live size limit if the platform changes.