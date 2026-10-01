---
name: Managed workflow process collisions
description: Orphaned service listeners after workflow startup or workspace dependency synchronization
---

**Rule:** During workflow startup or after a workspace-wide package sync, treat port-in-use errors and Expo's interactive "use another port" prompt as possible orphaned managed workflow processes, not a reason to change the configured port. Identify which process groups own the prescribed ports, stop only the stale groups, and restart the affected managed workflows once.

**Why:** Earlier listeners can survive while replacement managed processes start. This also occurred during a merge-only sync with an unchanged lockfile and no package installation, so installation is not a prerequisite. Replacement processes fail or prompt for another port despite healthy application code.

**How to apply:** Use `lsof` and process parent/group information to establish port ownership before stopping anything. Never start Expo directly or reconfigure artifact workflows as a workaround for duplicate listeners.