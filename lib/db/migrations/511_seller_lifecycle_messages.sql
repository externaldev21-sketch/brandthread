-- 511: Seller lifecycle messages (activation nudges, weekly summary,
-- checkout-blocked alerts). One row per (seller, kind, period) is claimed
-- before sending, so each message goes out once even with several API
-- instances running the same job.
CREATE TABLE IF NOT EXISTS seller_lifecycle_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  period_key  TEXT NOT NULL,
  push_sent   BOOLEAN NOT NULL DEFAULT FALSE,
  email_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS seller_lifecycle_messages_once
  ON seller_lifecycle_messages(seller_id, kind, period_key);
CREATE INDEX IF NOT EXISTS seller_lifecycle_messages_created_idx ON seller_lifecycle_messages(created_at);
