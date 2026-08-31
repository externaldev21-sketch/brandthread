---
name: Thread pagination boundary
description: Reliability rules for merging independently paginated followed and public Thread sources.
---

Followed and public Thread sources must keep separate raw offsets. Exhaust followed
rows before emitting public rows, and carry emitted post IDs across pages so
overlap from the public source is removed without changing either source cursor.

**Why:** A single merged offset can skip rows, while advancing by deduplicated
output can repeat rows. Refresh can also race an older append and restore stale
paging state.

**How to apply:** Advance each source by raw rows consumed, deduplicate only at
the merge boundary, end only after both sources are exhausted, and fence async
screen updates with a refresh generation.