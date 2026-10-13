-- 619: Dunning state for seller platform subscriptions (Stripe) — item 115.
-- One row per seller. invoice.payment_failed advances last_attempt; after
-- BILLING_DUNNING_MAX_RETRIES failed retries the subscription is paused
-- (paused_at). invoice.paid on that invoice resumes it (resumed_at) and resets
-- the row. The conditional upsert on (invoice_id, last_attempt) makes webhook
-- replays and concurrent deliveries notify exactly once per attempt.
CREATE TABLE IF NOT EXISTS seller_subscription_dunning (
  clerk_user_id    TEXT PRIMARY KEY,
  subscription_id  TEXT NOT NULL,
  invoice_id       TEXT,
  last_attempt     INTEGER NOT NULL DEFAULT 0,
  max_retries      INTEGER NOT NULL DEFAULT 3,
  next_retry_at    TIMESTAMPTZ,
  paused_at        TIMESTAMPTZ,
  resumed_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seller_subscription_dunning_subscription_idx
  ON seller_subscription_dunning (subscription_id);
