-- 261: Affiliate commissions are funded by the seller (BT-310).
-- Before a creator is paid, the commission is taken back from the seller's
-- payout for that order (a Stripe transfer reversal) into Brandthread's
-- affiliate_commission_reserve ledger account, so Brandthread's own balance
-- never funds a creator payout. This column is how much of the commission the
-- seller has funded so far (net of any amount returned to them after a refund
-- reversed the commission). Existing rows start at 0 and are funded before
-- their next payout.
ALTER TABLE affiliate_commissions
  ADD COLUMN IF NOT EXISTS seller_funded_cents INTEGER NOT NULL DEFAULT 0;
