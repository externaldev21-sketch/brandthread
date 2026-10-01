-- 112: AI credits ledger, daily spend counters, spend alerts and credit-pack
-- purchases. Additive only. See lib/db/src/schema/aiCredits.ts.

CREATE TABLE IF NOT EXISTS ai_credit_accounts (
  clerk_user_id     TEXT PRIMARY KEY,
  monthly_balance   INTEGER NOT NULL DEFAULT 0 CHECK (monthly_balance >= 0),
  -- Last month's unused monthly credits (Starter/Growth), kept for one month only.
  rollover_balance  INTEGER NOT NULL DEFAULT 0 CHECK (rollover_balance >= 0),
  purchased_balance INTEGER NOT NULL DEFAULT 0 CHECK (purchased_balance >= 0),
  monthly_allowance INTEGER NOT NULL DEFAULT 0,
  monthly_period    TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_credit_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id   TEXT NOT NULL,
  kind            TEXT NOT NULL,      -- monthly_grant | monthly_expire | rollover | rollover_expire | pack_purchase | debit | refund | usage | usage_refund | adjustment
  delta           INTEGER NOT NULL,   -- signed credits (spend is negative)
  tool_key        TEXT,
  reference       TEXT,
  idempotency_key TEXT,
  monthly_delta   INTEGER NOT NULL DEFAULT 0,
  rollover_delta  INTEGER NOT NULL DEFAULT 0,
  purchased_delta INTEGER NOT NULL DEFAULT 0,
  balance_after   INTEGER NOT NULL DEFAULT 0,
  meta            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_ledger_idem_uq
  ON ai_credit_ledger (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_credit_ledger_user_idx
  ON ai_credit_ledger (clerk_user_id, created_at DESC);

-- One row per UTC day and scope: '*' is the global counter, 'text:<user>' the
-- silent per-user chat ceiling.
CREATE TABLE IF NOT EXISTS ai_spend_daily (
  day           DATE NOT NULL,
  clerk_user_id TEXT NOT NULL,
  spent         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, clerk_user_id)
);

CREATE TABLE IF NOT EXISTS ai_spend_alerts (
  day       DATE NOT NULL,
  scope     TEXT NOT NULL,            -- 'global' | 'user:<id>'
  threshold INTEGER NOT NULL,         -- percent of the cap
  fired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (day, scope, threshold)
);

CREATE TABLE IF NOT EXISTS ai_credit_purchases (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id              TEXT NOT NULL,
  pack_id                    TEXT NOT NULL,
  credits                    INTEGER NOT NULL,
  amount_cents               INTEGER NOT NULL,
  stripe_checkout_session_id TEXT,
  status                     TEXT NOT NULL DEFAULT 'pending_payment', -- pending_payment | paid
  paid_at                    TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_purchases_session_uq
  ON ai_credit_purchases (stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_credit_purchases_user_idx ON ai_credit_purchases (clerk_user_id, created_at DESC);

-- Pro is unlimited: no balance, but usage is tracked for the hidden fair-use
-- queue (credits-worth per UTC month) and the hidden per-day generation ceiling.
CREATE TABLE IF NOT EXISTS ai_pro_usage (
  clerk_user_id   TEXT PRIMARY KEY,
  period          TEXT NOT NULL DEFAULT '',   -- YYYY-MM the credits_used figure belongs to
  credits_used    INTEGER NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  day             TEXT NOT NULL DEFAULT '',   -- YYYY-MM-DD the generations_today figure belongs to
  generations_today INTEGER NOT NULL DEFAULT 0 CHECK (generations_today >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
