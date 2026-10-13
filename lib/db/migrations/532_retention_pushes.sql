-- 532: Retention pushes (weekly followed-brands digest, order anniversary).
-- users.timezone: the device's IANA timezone, reported with the push token
-- (POST /api/push/register). Nullable: unknown until a device reports it.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS timezone TEXT;

-- One row per retention push actually claimed. The unique key is the
-- claim-before-notify idempotency boundary: only the run that inserts the
-- row sends, so overlapping runs and replicas never double-send.
--   weekly_digest:     period_key = ISO week in the buyer's local time, e.g. 2026-W42
--   order_anniversary: period_key = <orderId>:<year>
--   order_anniversary_day: period_key = local YYYY-MM-DD (one anniversary push per day)
CREATE TABLE IF NOT EXISTS retention_push_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  period_key TEXT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS retention_push_log_user_kind_period_unique
  ON retention_push_log (user_id, kind, period_key);
