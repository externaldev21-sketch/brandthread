---
name: Post-merge setup timeout
description: Timeout sizing for dependency relinks and post-merge reconciliation.
---

The post-merge setup must reconcile package manifests with the lockfile before migrations and builds, and its timeout must allow for a cold or forced pnpm relink; frozen-lockfile installs and 20-second limits are unsafe here.

**Why:** Isolated task merges can legitimately change a workspace package manifest without carrying the regenerated root lockfile. A frozen install then fails immediately. Normal dependency relinks have also taken more than 90 seconds even though migrations and API builds finish quickly.

**How to apply:** Let the post-merge install update a stale lockfile non-interactively, keep the configured timeout at five minutes unless installation is intentionally optimized, and validate changes with a full setup run.