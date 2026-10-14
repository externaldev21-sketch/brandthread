-- 294: Rising brands this week — seller opt-in.
--
-- Discover > Brands shows a "Rising this week" leaderboard of sellers whose
-- paid orders grew week over week (GET /api/public/brands/rising). Only
-- sellers who switch on "Show in Rising brands" in Store Settings appear.
-- Off by default; idempotent; touches no existing data.

ALTER TABLE users ADD COLUMN IF NOT EXISTS rising_brands_opt_in BOOLEAN NOT NULL DEFAULT false;

-- Leaderboard scan: paid orders per seller over the last 14 days.
CREATE INDEX IF NOT EXISTS orders_owner_paid_at_idx
  ON orders (owner_id, paid_at) WHERE paid_at IS NOT NULL;
