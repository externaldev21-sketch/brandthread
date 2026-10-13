---
name: Pinned-post consolidation
description: Owner requires one canonical pinned-post model, API and UI when integrating independent implementations.
---

Keep exactly one pinned-post persistence model, one canonical pin API and one set of pin controls. When integrating another implementation, prefer the more complete version and migrate existing data rather than retaining duplicate columns, tables, endpoints or pin icons.

**Why:** The owner explicitly identified independently developed versions of the same feature and required consolidation, not parallel implementations.

**How to apply:** Before merging any competing pinned-post implementation, compare the existing and incoming behavior, preserve the complete feature set, and plan an idempotent data migration where necessary.
