---
name: Haptics control boundary
description: The owner's single-control requirement for app-wide haptics.
---

Brandthread must expose only one “Sounds & haptics” control for both buyer and seller. Turning haptics off must silence every haptic, not just named events. Do not add a second inverse toggle in Accessibility.

**Why:** The owner explicitly required consolidation of competing settings controls, keeping the shared service and switch rather than presenting contradictory preferences.

**How to apply:** Preserve one authoritative preference when merging accessibility or feedback changes. A separate “New order sound” switch controls notification audio, not haptics, and may remain.
