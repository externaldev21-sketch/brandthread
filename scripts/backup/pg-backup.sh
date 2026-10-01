#!/usr/bin/env bash
# Nightly Postgres backup. Read-only against the database: it only runs pg_dump.
#
#   DATABASE_URL        database to back up (required)
#   BACKUP_DIR          where dumps are written (default ./backups)
#   BACKUP_RETENTION_DAYS  delete local dumps older than this (default 14; 0 keeps everything)
#   BACKUP_S3_URI       optional, e.g. s3://my-bucket/brandthread/. Needs the `aws` CLI and
#                       AWS_* credentials (works with any S3-compatible store via AWS_ENDPOINT_URL)
#   BACKUP_LABEL        optional prefix, default "brandthread"
#
# Output: <label>-<UTC timestamp>.dump (pg_dump custom format, compressed) and a .sha256 file.
# Exit code is non-zero if the dump is empty, unreadable, or the upload fails, so a scheduler
# can alert on it. See docs/reliability/backups.md.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
LABEL="${BACKUP_LABEL:-brandthread}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${BACKUP_DIR}/${LABEL}-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"
umask 077

echo "[backup] dumping to ${FILE}"
pg_dump --format=custom --no-owner --no-privileges --file "${FILE}.partial" "$DATABASE_URL"
mv "${FILE}.partial" "$FILE"

# A dump pg_restore cannot list is not a backup.
pg_restore --list "$FILE" > /dev/null
SIZE="$(wc -c < "$FILE" | tr -d ' ')"
if [ "$SIZE" -lt 1024 ]; then
  echo "[backup] dump is suspiciously small (${SIZE} bytes)" >&2
  exit 1
fi

( cd "$BACKUP_DIR" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256" )
echo "[backup] ok: ${SIZE} bytes, sha256 $(cut -d' ' -f1 "${FILE}.sha256")"

if [ -n "${BACKUP_S3_URI:-}" ]; then
  command -v aws > /dev/null || { echo "[backup] BACKUP_S3_URI is set but the aws CLI is missing" >&2; exit 1; }
  aws s3 cp "$FILE" "${BACKUP_S3_URI%/}/$(basename "$FILE")"
  aws s3 cp "${FILE}.sha256" "${BACKUP_S3_URI%/}/$(basename "$FILE").sha256"
  echo "[backup] uploaded to ${BACKUP_S3_URI}"
fi

if [ "$RETENTION_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -maxdepth 1 -name "${LABEL}-*.dump*" -type f -mtime "+${RETENTION_DAYS}" -print -delete \
    | sed 's/^/[backup] pruned /'
fi
