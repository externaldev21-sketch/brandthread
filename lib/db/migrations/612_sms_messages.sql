-- 612: SMS send log + phone confirmation codes.
-- sms_messages: one row per outbound text. The partial unique index on
-- (order_id, kind) makes order texts idempotent: a retried webhook or a second
-- "shipped" publish for the same order never sends twice. Rows with
-- status 'deferred' are sent by jobs/smsDeferredSend.ts once send_after passes
-- (8am-9pm in the recipient's time zone).
CREATE TABLE IF NOT EXISTS sms_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  order_id    UUID,
  kind        TEXT NOT NULL,
  to_phone    TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  twilio_sid  TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  error       TEXT,
  send_after  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_order_kind_unique
  ON sms_messages (order_id, kind) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_messages_deferred_idx
  ON sms_messages (send_after) WHERE status = 'deferred';
CREATE INDEX IF NOT EXISTS sms_messages_user_created_idx
  ON sms_messages (user_id, created_at);

CREATE TABLE IF NOT EXISTS sms_phone_verifications (
  user_id     TEXT PRIMARY KEY,
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
