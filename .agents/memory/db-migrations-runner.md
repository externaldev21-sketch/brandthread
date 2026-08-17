---
name: DB migration runner
description: How @workspace/db migrations are applied; idempotency requirement and clean-boot flow
---

# DB migrations

Migrations run through an ordered, schema_migrations-tracked runner (the db package's `migrate` script); a fresh database boots with `setup` = drizzle push (base schema) then migrate.

**Why:** the previous migrate script hardcoded the first few files and went stale, and long-lived DBs had later migrations applied ad hoc — fresh environments silently missed tables.

**How to apply:** every statement in a migration must be idempotent (IF NOT EXISTS; wrap ADD CONSTRAINT in a duplicate_object exception guard) because existing databases may already contain any given change. Adding a migration = dropping a new .sql file in the migrations dir; nothing to register.
