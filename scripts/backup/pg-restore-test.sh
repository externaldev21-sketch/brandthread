#!/usr/bin/env bash
# Proves a backup can be restored. Restores one dump into a SCRATCH database and checks it.
#
#   ./scripts/backup/pg-restore-test.sh <dump file>
#
#   RESTORE_TEST_DATABASE_URL  connection string for the scratch database (required). The
#                              database name must contain "restore_test" — the script refuses
#                              anything else, and refuses to run if it equals DATABASE_URL or
#                              PRODUCTION_DATABASE_URL. It is emptied and reloaded, so point it
#                              at a throwaway database only.
#
# Checks: the restore completes, and the core tables exist and are readable.
# Never touches the source database.
set -euo pipefail

DUMP="${1:?usage: pg-restore-test.sh <dump file>}"
TARGET="${RESTORE_TEST_DATABASE_URL:?RESTORE_TEST_DATABASE_URL is required}"
[ -f "$DUMP" ] || { echo "[restore-test] no such file: $DUMP" >&2; exit 1; }

DBNAME="${TARGET##*/}"
DBNAME="${DBNAME%%\?*}"
case "$DBNAME" in
  *restore_test*) ;;
  *) echo "[restore-test] refusing: database name '$DBNAME' must contain 'restore_test'" >&2; exit 2 ;;
esac
for protected in "${DATABASE_URL:-}" "${PRODUCTION_DATABASE_URL:-}"; do
  if [ -n "$protected" ] && [ "$protected" = "$TARGET" ]; then
    echo "[restore-test] refusing: target is the live database" >&2
    exit 2
  fi
done

if [ -f "${DUMP}.sha256" ]; then
  ( cd "$(dirname "$DUMP")" && sha256sum --check "$(basename "$DUMP").sha256" )
fi

echo "[restore-test] restoring $(basename "$DUMP") into ${DBNAME}"
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error \
  --dbname "$TARGET" "$DUMP"

# Core tables every environment has. A missing one means the restore is incomplete.
for table in users products orders conversations; do
  count="$(psql "$TARGET" -At -c "SELECT count(*) FROM ${table}")"
  echo "[restore-test] ${table}: ${count} rows"
done
echo "[restore-test] ok"
