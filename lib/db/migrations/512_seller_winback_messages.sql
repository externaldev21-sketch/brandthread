-- 512: Win-back message after a seller's plan ends — one per subscription
-- end (seller + period end), so a re-subscribe-and-cancel later gets its own.
CREATE TABLE IF NOT EXISTS seller_winback_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   TEXT NOT NULL,
  period_end  TIMESTAMP NOT NULL,
  push_sent   BOOLEAN NOT NULL DEFAULT FALSE,
  email_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS seller_winback_messages_once ON seller_winback_messages(seller_id, period_end);
