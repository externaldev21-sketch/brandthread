-- ─── Migration 085: Thread Cash (platform-funded buyer reward credit) ────────
-- Thread Cash is NOT money: it cannot be cashed out, withdrawn, or converted
-- to money, and is spendable only toward purchases in the app. This mirrors
-- the loyalty_points design (append-only signed-cent ledger, balance = SUM).

CREATE TABLE IF NOT EXISTS thread_cash_entries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id      TEXT        NOT NULL,
  amount_cents  INTEGER     NOT NULL, -- + earned/refunded, - spent/expired
  source        TEXT        NOT NULL, -- 'daily_checkin'|'streak_bonus'|'redemption'|'checkout_spend'|'refund_credit'|'expiry'|'admin_adjustment'
  reference_id  TEXT,
  note          TEXT,
  checkout_session_id TEXT,
  used_at       TIMESTAMPTZ,
  used_order_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS thread_cash_entries_buyer_idx  ON thread_cash_entries(buyer_id);
CREATE INDEX IF NOT EXISTS thread_cash_entries_source_idx ON thread_cash_entries(source);
CREATE UNIQUE INDEX IF NOT EXISTS thread_cash_checkin_once_per_reference
  ON thread_cash_entries(buyer_id, reference_id)
  WHERE source = 'daily_checkin';
CREATE UNIQUE INDEX IF NOT EXISTS thread_cash_redemption_token_unique
  ON thread_cash_entries(reference_id)
  WHERE source = 'redemption';
CREATE INDEX IF NOT EXISTS thread_cash_redemption_checkout_idx
  ON thread_cash_entries(checkout_session_id)
  WHERE source = 'redemption';

CREATE TABLE IF NOT EXISTS thread_cash_streaks (
  buyer_id           TEXT        PRIMARY KEY,
  timezone           TEXT        NOT NULL DEFAULT 'UTC',
  current_streak     INTEGER     NOT NULL DEFAULT 0,
  longest_streak     INTEGER     NOT NULL DEFAULT 0,
  last_check_in_date TEXT,
  last_check_in_at   TIMESTAMPTZ,
  last_device_id     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Single configurable-rules row, edited the same way as feature_flags.
CREATE TABLE IF NOT EXISTS thread_cash_config (
  id                             TEXT        PRIMARY KEY DEFAULT 'default',
  daily_amount_cents             INTEGER     NOT NULL DEFAULT 10,
  streak_bonus_cents             INTEGER     NOT NULL DEFAULT 100,
  streak_bonus_days              INTEGER     NOT NULL DEFAULT 7,
  grace_hours                    INTEGER     NOT NULL DEFAULT 6,
  expiry_days                    INTEGER,    -- null = never expires (default)
  max_redemption_per_order_cents INTEGER,    -- null = up to the order total
  updated_by                     TEXT,
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO thread_cash_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- Send-in-chat (Apple-Cash-style) transfers. Feature-flagged OFF — see
-- 'threadCashSend' below; peer-to-peer cash-like transfer needs legal
-- sign-off (money-transmitter / App Store rules) before it is turned on.
CREATE TABLE IF NOT EXISTS thread_cash_transfers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id       TEXT        NOT NULL,
  recipient_id    TEXT        NOT NULL,
  conversation_id UUID,
  amount_cents    INTEGER     NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending', -- pending|claimed|expired|cancelled
  message_id      UUID,
  claimed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS thread_cash_transfers_sender_idx    ON thread_cash_transfers(sender_id);
CREATE INDEX IF NOT EXISTS thread_cash_transfers_recipient_idx ON thread_cash_transfers(recipient_id, status);

-- Thread Cash applied at checkout, tracked separately from seller-funded
-- discount_code discounts (orders.discount_amount_cents) so the two are
-- auditable independently — they have opposite economic effect.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS thread_cash_applied_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS thread_cash_token TEXT,
  ADD COLUMN IF NOT EXISTS thread_cash_discount_cents INTEGER NOT NULL DEFAULT 0;

INSERT INTO feature_flags (key, enabled, description)
VALUES
  ('threadCash', true, 'Thread Cash daily check-in, streaks and wallet'),
  -- OFF until the platform-funded checkout discount preserves seller payout
  -- via a supplemental transfer (see PR description) and has been reviewed.
  ('threadCashCheckoutDiscount', false, 'Apply Thread Cash balance as a discount at checkout'),
  -- OFF until Dev confirms with a lawyer that peer-to-peer Thread Cash
  -- transfer does not trigger money-transmitter / App Store rules.
  ('threadCashSend', false, 'Send Thread Cash to another buyer in chat')
ON CONFLICT (key) DO NOTHING;
