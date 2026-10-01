-- ─── Migration 124: Affiliate / creator program ──────────────────────────────
-- A seller turns on a program; creators (existing users) promote the brand with
-- a personal code usable as a ?aff= link or a checkout code. Commission ledger
-- (affiliate_commissions + append-only events) and Stripe Connect payouts.
-- Purely additive: no existing table is altered. Idempotent.

CREATE TABLE IF NOT EXISTS affiliate_programs (
  seller_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  default_commission_bps INTEGER NOT NULL DEFAULT 1000,
  buyer_discount_bps INTEGER NOT NULL DEFAULT 0,
  window_days INTEGER NOT NULL DEFAULT 30,
  hold_days INTEGER NOT NULL DEFAULT 30,
  min_payout_cents INTEGER NOT NULL DEFAULT 2500,
  auto_approve BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS affiliate_creators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  status TEXT NOT NULL,
  origin TEXT NOT NULL,
  code TEXT NOT NULL,
  commission_bps_override INTEGER,
  discount_code_id TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_creators_seller_creator_unique ON affiliate_creators (seller_id, creator_id);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_creators_code_unique ON affiliate_creators (code);
CREATE INDEX IF NOT EXISTS affiliate_creators_creator_idx ON affiliate_creators (creator_id);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id BIGSERIAL PRIMARY KEY,
  affiliate_id UUID NOT NULL,
  seller_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  visitor_hash TEXT,
  day TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS affiliate_clicks_affiliate_idx ON affiliate_clicks (affiliate_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_clicks_visitor_day_unique
  ON affiliate_clicks (affiliate_id, visitor_hash, day) WHERE visitor_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS affiliate_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL,
  seller_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  clicked_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_attributions_buyer_seller_unique ON affiliate_attributions (buyer_id, seller_id);

CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL,
  seller_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  order_id UUID NOT NULL,
  source TEXT NOT NULL,
  base_cents INTEGER NOT NULL,
  commission_bps INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  reversed_cents INTEGER NOT NULL DEFAULT 0,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  eligible_at TIMESTAMPTZ,
  payout_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_commissions_order_unique ON affiliate_commissions (order_id);
CREATE INDEX IF NOT EXISTS affiliate_commissions_creator_idx ON affiliate_commissions (creator_id, status);
CREATE INDEX IF NOT EXISTS affiliate_commissions_seller_idx ON affiliate_commissions (seller_id, status);

CREATE TABLE IF NOT EXISTS affiliate_commission_events (
  id BIGSERIAL PRIMARY KEY,
  commission_id UUID NOT NULL,
  seller_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS affiliate_commission_events_commission_idx ON affiliate_commission_events (commission_id);

CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'processing',
  attempt INTEGER NOT NULL DEFAULT 1,
  stripe_transfer_id TEXT,
  failure_code TEXT,
  failure_message TEXT,
  next_attempt_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_payouts_open_unique
  ON affiliate_payouts (seller_id, creator_id) WHERE state IN ('processing', 'failed');
CREATE INDEX IF NOT EXISTS affiliate_payouts_creator_idx ON affiliate_payouts (creator_id, created_at);

CREATE TABLE IF NOT EXISTS affiliate_payout_items (
  id BIGSERIAL PRIMARY KEY,
  payout_id UUID NOT NULL,
  commission_id UUID NOT NULL,
  seller_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS affiliate_payout_items_payout_idx ON affiliate_payout_items (payout_id);
