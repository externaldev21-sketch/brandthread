-- 645: Create Ad — daily budget × days, payment record and pro-rata refunds.
-- budget_cents stays the TOTAL charged and paced (daily × days when the seller
-- set a daily budget). paid_amount_cents / stripe_payment_intent_id are
-- recorded on activation so an early stop can refund the undelivered
-- remainder through Stripe; refunded_cents accumulates what was returned.
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS daily_budget_cents INTEGER;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS payment_rail TEXT;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS paid_amount_cents INTEGER;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS refunded_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS refund_status TEXT;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS stripe_refund_id TEXT;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ad_campaigns_refund_sweep_idx
  ON ad_campaigns (status, refund_status)
  WHERE status = 'completed' AND payment_rail = 'stripe';
