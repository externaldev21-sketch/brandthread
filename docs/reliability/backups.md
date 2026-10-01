# Database backups

## Nightly backup

`scripts/backup/pg-backup.sh` runs `pg_dump` (custom format, compressed) against `DATABASE_URL`. It only reads the database. It writes `brandthread-<UTC timestamp>.dump` plus a `.sha256`, verifies `pg_restore --list` can read the dump, fails on an empty or tiny dump, optionally uploads to S3-compatible storage, and prunes local dumps older than `BACKUP_RETENTION_DAYS` (default 14).

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Database to back up. Use a read-only role if you have one |
| `BACKUP_DIR` | Output folder (default `./backups`) |
| `BACKUP_S3_URI` | Optional, e.g. `s3://bucket/brandthread/`. Needs the `aws` CLI and `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (+ `AWS_ENDPOINT_URL` for non-AWS stores). Keep the bucket private with versioning on |
| `BACKUP_RETENTION_DAYS` | Local retention, `0` keeps everything |

Schedule it nightly (the exit code is non-zero on any failure, so the scheduler can alert):

- Replit: a Scheduled Deployment running `./scripts/backup/pg-backup.sh` with cron `0 3 * * *`.
- Any host: `0 3 * * * cd /app && ./scripts/backup/pg-backup.sh >> /var/log/brandthread-backup.log 2>&1`.

If the database provider already takes point-in-time snapshots (Neon, RDS, Supabase), keep them on; this script is the portable copy that does not depend on the provider.

Dumps contain customer data. Store them encrypted at rest with restricted access, and never commit them (`backups/` is ignored).

## Test restore (do this monthly and after any schema change)

A backup that has never been restored is a guess. `scripts/backup/pg-restore-test.sh <dump>` restores one dump into a scratch database and checks that `users`, `products`, `orders` and `conversations` are readable.

1. Create an empty scratch database whose name contains `restore_test`, e.g. `createdb brandthread_restore_test`.
2. `RESTORE_TEST_DATABASE_URL=postgres://.../brandthread_restore_test ./scripts/backup/pg-restore-test.sh backups/brandthread-<stamp>.dump`
3. Expect `[restore-test] ok` and plausible row counts. Drop the scratch database afterwards.

Safety: the script refuses any database whose name does not contain `restore_test`, and refuses a target equal to `DATABASE_URL` or `PRODUCTION_DATABASE_URL`. It is never run automatically against production.

Verified in the sandbox on a local Postgres 16 (backup, checksum, restore, row counts, and the refusal of a non-scratch target). It has not been run against the production database.

## Restoring for real

Only a person should do this, deliberately: restore into a new database first, check it, then repoint `DATABASE_URL`. Do not `--clean` into the live database.
