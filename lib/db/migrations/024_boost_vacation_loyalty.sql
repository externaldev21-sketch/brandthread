-- ─── Migration 024: Paid Boosts, Vacation Mode, Loyalty Points ────────────────

-- 1. Paid promotion boosts
CREATE TABLE IF NOT EXISTS boosts (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id                TEXT        NOT NULL,
  target_type              TEXT        NOT NULL,            -- 'post' | 'product'
  target_id                TEXT        NOT NULL,
  budget_cents             INTEGER     NOT NULL,
  spent_cents              INTEGER     NOT NULL DEFAULT 0,
  duration_days            INTEGER     NOT NULL DEFAULT 7,
  stripe_payment_intent_id TEXT,
  status                   TEXT        NOT NULL DEFAULT 'active', -- 'active' | 'paused' | 'completed' | 'cancelled'
  impressions_count        INTEGER     NOT NULL DEFAULT 0,
  starts_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at                  TIMESTAMPTZ NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS boosts_seller_idx ON boosts(seller_id);
CREATE INDEX IF NOT EXISTS boosts_target_idx ON boosts(target_id);
CREATE INDEX IF NOT EXISTS boosts_active_idx ON boosts(status, ends_at);

-- 2. Vacation mode on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS vacation_mode     BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS vacation_message  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS vacation_until    TIMESTAMPTZ;

-- 3. Loyalty / rewards points ledger
CREATE TABLE IF NOT EXISTS loyalty_points (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id      TEXT        NOT NULL,          -- Clerk user ID of the buyer
  points        INTEGER     NOT NULL,          -- positive = earned, negative = redeemed
  source        TEXT        NOT NULL,          -- 'purchase' | 'referral' | 'signup' | 'redemption'
  reference_id  TEXT,                          -- order_id, referral_id, etc.
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS loyalty_buyer_idx  ON loyalty_points(buyer_id);
CREATE INDEX IF NOT EXISTS loyalty_source_idx ON loyalty_points(source);

-- Broadcast throttle: one row per drop broadcast to prevent spam
CREATE TABLE IF NOT EXISTS drop_broadcasts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id     UUID        NOT NULL,
  seller_id   TEXT        NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_count  INTEGER     NOT NULL DEFAULT 0,
  UNIQUE(drop_id)
);
