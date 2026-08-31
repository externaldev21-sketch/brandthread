---
name: Post-merge setup timeout
description: Timeout sizing for dependency relinks and post-merge reconciliation.
---

The post-merge setup timeout must allow for a cold or forced pnpm relink before migrations and the API build begin; 20 seconds is not a safe limit for this workspace.

**Why:** A normal dependency relink has taken more than 90 seconds even though migrations and the API build complete quickly. Short limits report false setup failures during otherwise healthy merges.

**How to apply:** Keep the configured post-merge timeout at five minutes unless the install process is intentionally optimized; validate with a full setup run after changing it.