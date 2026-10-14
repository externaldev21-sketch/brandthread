---
name: Publish identifier storage compatibility
description: Preserve deployed identifier storage contracts when integrating newer ORM definitions.
---

Treat persisted identifier storage types as compatibility contracts. UUID-formatted strings do not require changing an established text primary key to PostgreSQL's uuid type.

**Why:** Publish generated a text-to-uuid alteration without an explicit conversion clause and PostgreSQL rejected it even with zero rows. The historical text-backed UUID default already satisfied the application's ID format contract.

**How to apply:** Compare historical migrations, current development metadata and read-only production metadata before changing identifier types. Check foreign keys and data counts. Preserve the compatible storage type in the schema source and development database when no feature requires a type conversion; leave production changes to Publish.
