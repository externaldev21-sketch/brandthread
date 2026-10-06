-- 114: Promoted threads (Sponsored in For You) + Featured brand slots on Discover,
-- both behind an admin approval step. Extends the existing `boosts` table.

-- Legacy boosts were already live, so existing rows default to 'approved'.
-- New boosts are inserted as 'pending' by the API and stay out of delivery until
-- payment is verified AND an admin approves them.
ALTER TABLE boosts ADD COLUMN IF NOT EXISTS review_status          TEXT        NOT NULL DEFAULT 'approved';
ALTER TABLE boosts ADD COLUMN IF NOT EXISTS reviewed_by            TEXT;
ALTER TABLE boosts ADD COLUMN IF NOT EXISTS reviewed_at            TIMESTAMPTZ;
ALTER TABLE boosts ADD COLUMN IF NOT EXISTS rejection_reason       TEXT;
ALTER TABLE boosts ADD COLUMN IF NOT EXISTS refund_id              TEXT;
ALTER TABLE boosts ADD COLUMN IF NOT EXISTS refund_status          TEXT        NOT NULL DEFAULT 'none';
ALTER TABLE boosts ADD COLUMN IF NOT EXISTS refunded_at            TIMESTAMPTZ;
-- Spend actually delivered through the Sponsored placement (cents). Capped at budget_cents.
ALTER TABLE boosts ADD COLUMN IF NOT EXISTS delivered_spend_cents  INTEGER     NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS boosts_review_idx ON boosts (review_status, status);

-- One row per sponsored item served to a viewer; viewed_at is set when the
-- client confirms the item was actually on screen (that is what bills).
CREATE TABLE IF NOT EXISTS sponsored_deliveries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boost_id    UUID        NOT NULL REFERENCES boosts(id) ON DELETE CASCADE,
  viewer_id   TEXT        NOT NULL,
  session_id  TEXT        NOT NULL,
  cost_cents  INTEGER     NOT NULL DEFAULT 0,
  served_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  viewed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sponsored_deliveries_viewer_idx ON sponsored_deliveries (viewer_id, boost_id, served_at);
CREATE UNIQUE INDEX IF NOT EXISTS sponsored_deliveries_session_uq ON sponsored_deliveries (boost_id, viewer_id, session_id);

-- Time-boxed Featured brand slots on Discover.
CREATE TABLE IF NOT EXISTS featured_slots (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id                   TEXT        NOT NULL,
  placement                   TEXT        NOT NULL DEFAULT 'discover_brands',
  duration_days               INTEGER     NOT NULL,
  price_cents                 INTEGER     NOT NULL,
  starts_at                   TIMESTAMPTZ NOT NULL,
  ends_at                     TIMESTAMPTZ NOT NULL,
  -- pending_payment | in_review | approved | rejected | cancelled | failed
  status                      TEXT        NOT NULL DEFAULT 'pending_payment',
  stripe_checkout_session_id  TEXT UNIQUE,
  checkout_session_version    INTEGER     NOT NULL DEFAULT 0,
  paid_at                     TIMESTAMPTZ,
  reviewed_by                 TEXT,
  reviewed_at                 TIMESTAMPTZ,
  rejection_reason            TEXT,
  refund_id                   TEXT,
  refund_status               TEXT        NOT NULL DEFAULT 'none',
  refunded_at                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS featured_slots_window_idx ON featured_slots (placement, status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS featured_slots_seller_idx ON featured_slots (seller_id, created_at);

-- Audit trail of every admin decision on a boost or featured slot.
CREATE TABLE IF NOT EXISTS promotion_reviews (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         TEXT        NOT NULL,            -- 'boost' | 'featured_slot'
  target_id    UUID        NOT NULL,
  reviewer_id  TEXT        NOT NULL,
  decision     TEXT        NOT NULL,            -- 'approved' | 'rejected'
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS promotion_reviews_target_idx ON promotion_reviews (kind, target_id, created_at);
