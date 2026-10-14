-- 277: Brand membership levels (Member -> Insider -> Inner Circle) from a
-- buyer's lifetime spend with a brand. One row per seller who changed the
-- defaults ($250 Insider, $1,000 Inner Circle, no early access); no row =
-- defaults. Spend itself is computed from orders, never stored.
CREATE TABLE IF NOT EXISTS brand_membership_settings (
  seller_id text PRIMARY KEY,
  insider_cents integer NOT NULL DEFAULT 25000,
  inner_circle_cents integer NOT NULL DEFAULT 100000,
  -- Minutes before a scheduled drop opens that Inner Circle may buy. 0 = off.
  inner_circle_early_access_minutes integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_membership_thresholds_ordered CHECK (insider_cents > 0 AND inner_circle_cents > insider_cents),
  CONSTRAINT brand_membership_early_access_range CHECK (inner_circle_early_access_minutes BETWEEN 0 AND 1440)
);
-- Lifetime spend reads orders through the existing orders_buyer_id_idx (migration 085).
