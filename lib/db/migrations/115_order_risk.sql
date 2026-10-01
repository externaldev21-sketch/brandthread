-- 115: Stripe Radar risk signals on orders (seller-only; never exposed to buyers).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS risk_level    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS risk_score    INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS risk_flags    JSONB DEFAULT '[]'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS risk_reviewed BOOLEAN;
