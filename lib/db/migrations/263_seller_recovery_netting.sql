-- ─── Migration 261: Seller recovery netting ──────────────────────────────────
-- Additive and idempotent (safe to re-run).
--
-- What a seller owes Brandthread (ledger account seller_recoverable: refund
-- costs fronted after the order's own money ran out, lost chargebacks,
-- Stripe's dispute fee) is netted from the seller's next order release or
-- order transfer (api-server lib/money/sellerRecovery.ts). How much was kept
-- back is decided once, before the Stripe transfer, and stored here so a
-- retried transfer always sends the same amount under the same idempotency
-- key. NULL = not decided yet.
--
-- The same columns are added by the seller-recovery migration of the lost
-- chargeback work (306); both use ADD COLUMN IF NOT EXISTS, so either order
-- of applying them is fine.
ALTER TABLE order_releases ADD COLUMN IF NOT EXISTS recovery_netted_cents INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recovery_netted_cents INTEGER;
