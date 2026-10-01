-- Plan-based commission: the rate (basis points) fixed when a checkout is
-- created, so the webhook settles the order at the rate the buyer was quoted.
-- NULL on older sessions means the standard 500 bps (5%).
ALTER TABLE checkout_sessions ADD COLUMN IF NOT EXISTS platform_fee_bps INTEGER;
