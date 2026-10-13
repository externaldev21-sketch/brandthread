-- 270: Drop SMS waitlist (public brandthread.app/@handle/drop page) and the
-- once-only "drop is live" text blast claim per drop. No IP addresses stored.
CREATE TABLE IF NOT EXISTS drop_sms_waitlist (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id    TEXT NOT NULL,
  drop_id      UUID REFERENCES drops(id) ON DELETE SET NULL,
  phone_e164   TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  consent_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opted_out_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS drop_sms_waitlist_seller_phone_uniq ON drop_sms_waitlist (seller_id, phone_e164);
CREATE INDEX IF NOT EXISTS drop_sms_waitlist_phone_idx ON drop_sms_waitlist (phone_e164);

CREATE TABLE IF NOT EXISTS drop_sms_blasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id         UUID NOT NULL UNIQUE REFERENCES drops(id) ON DELETE CASCADE,
  seller_id       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'sending',
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count      INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
