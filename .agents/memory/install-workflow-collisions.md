---
name: Install-triggered workflow collisions
description: Duplicate managed service processes after workspace-wide dependency synchronization
---

**Rule:** After a workspace-wide package sync, treat port-in-use errors and Expo's interactive "use another port" prompt as possible duplicate managed workflow processes, not a reason to change the configured port. Identify which process groups own the prescribed ports, stop only the stale groups, and restart the affected managed workflows once.

**Why:** Package synchronization automatically restarts artifact workflows, but in this workspace an earlier API, Expo, and design-system listener remained on their ports while replacement processes tried to start. The replacements failed or prompted for a different port despite healthy application code.

**How to apply:** Use `lsof` and process parent/group information to establish port ownership before stopping anything. Never start Expo directly or reconfigure artifact workflows as a workaround for duplicate listeners.