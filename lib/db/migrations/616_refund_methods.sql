-- 616: Refund methods (items 113/114) — refund to original payment, to Thread Cash, or as store credit
--
-- order_refunds.method records how each refund was paid out. Every existing
-- row (and every caller that does not pass a method) is 'original': a Stripe
-- card refund, exactly as before.
--   thread_cash  — no card refund; the seller's share is clawed back with a
--                  transfer reversal and the buyer gets Thread Cash
--                  (thread_cash_entries source 'refund_credit').
--   store_credit — no card refund and no money movement; the seller issues a
--                  store gift card (gift_cards source 'seller_issued') for
--                  the refund amount and keeps the funds.
ALTER TABLE order_refunds ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'original';
ALTER TABLE order_refunds ADD COLUMN IF NOT EXISTS thread_cash_entry_id UUID;
ALTER TABLE order_refunds ADD COLUMN IF NOT EXISTS gift_card_id UUID;

DO $$ BEGIN
  ALTER TABLE order_refunds ADD CONSTRAINT order_refunds_method_check
    CHECK (method IN ('original', 'thread_cash', 'store_credit'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A store-credit refund issues exactly one gift card, ever.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS refund_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_refund_id_unique
  ON gift_cards (refund_id) WHERE refund_id IS NOT NULL;

-- returns.resolution_requested gains 'thread_cash' (text column, no enum to
-- change); nothing to migrate.
