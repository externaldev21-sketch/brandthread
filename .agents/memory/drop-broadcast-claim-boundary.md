---
name: Drop broadcast claim boundary
description: Once-only and lifecycle rules shared by manual and scheduled drop notifications.
---

Manual sends and launch-time workers must claim the same database-backed once-only broadcast boundary. The claim must lock and recheck that the drop is still eligible at send time, then clear any pending schedule atomically.

**Why:** A worker can select a due drop while a seller closes it or sends manually. Separate checks allow a closed drop to notify followers, duplicate sends, or a completed broadcast to remain labeled as scheduled.

**How to apply:** Any new drop notification trigger must call the shared claim path rather than sending directly. Scheduled callers must recheck both launch and schedule timestamps inside the claim transaction; all callers must recheck active status there.