---
name: External object deletion
description: Durable rule for deleting private object-storage files whose ownership is recorded in PostgreSQL.
---

Commit the database deletion and a durable cleanup intent in the same transaction. Process the external deletion afterward, and recheck for live database references immediately before removing the object.

**Why:** Object storage cannot participate in the PostgreSQL transaction. Deleting storage first can damage still-editable records when the database operation fails, while deleting database rows without durable cleanup intent leaks private objects when storage is unavailable.

**How to apply:** Use this pattern whenever a database-owned private object must be reclaimed. Treat missing objects as successful cleanup, retry temporary failures with bounded backoff, and never delete a path while any authoritative reference remains.