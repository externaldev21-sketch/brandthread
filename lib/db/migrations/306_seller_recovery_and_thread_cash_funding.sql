-- ─── Migration 306: Seller chargeback recovery + Thread Cash funding ─────────
-- Additive and idempotent (safe to re-run).
--
-- A) A chargeback LOST after the seller was paid becomes a recovery the seller
--    owes Brandthread (seller_recoveries). Every movement against it — a
--    transfer reversal, netting from a later order release, a manual entry, a
--    write-off or a dispute reinstatement — is one seller_recovery_applications
--    row plus a balanced ledger transaction (accounts seller_recoverable /
--    platform_dispute_losses / stripe_dispute_fees, api-server
--    lib/money/ledger.ts). While any recovery is open, payouts are paused.
--
-- B) Thread Cash gets a funding dimension: 'promo' (platform rewards — check-in,
--    streaks, refunds of promo spend, admin credit) or 'paid' (money a buyer
--    really paid). Only paid funds a seller RECEIVES are ever withdrawable.
--    There is no Thread Cash purchase source today, so every existing row is
--    promo; a future purchase source just writes funding = 'paid'.

-- ── A) Seller recoveries ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seller_recoveries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id             TEXT NOT NULL,
  dispute_id            UUID,
  stripe_dispute_id     TEXT NOT NULL,
  order_id              UUID,
  payment_intent_id     TEXT,
  -- The seller's share of the lost chargeback that had already been paid out
  -- to them (what must be recovered), plus the share of Stripe's dispute fee.
  amount_cents          INTEGER NOT NULL DEFAULT 0,
  fee_cents             INTEGER NOT NULL DEFAULT 0,
  -- The seller's share that was still held by Brandthread and was simply
  -- never paid out (informational; not part of what is owed).
  held_cancelled_cents  INTEGER NOT NULL DEFAULT 0,
  recovered_cents       INTEGER NOT NULL DEFAULT 0,
  -- Released from the debt without collecting it (write-off, or the dispute
  -- was reinstated in the seller's favour).
  forgiven_cents        INTEGER NOT NULL DEFAULT 0,
  -- open | recovered | written_off | reinstated
  status                TEXT NOT NULL DEFAULT 'open',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recovered_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE seller_recoveries DROP CONSTRAINT IF EXISTS seller_recoveries_status_valid;
ALTER TABLE seller_recoveries ADD CONSTRAINT seller_recoveries_status_valid CHECK (
  status IN ('open', 'recovered', 'written_off', 'reinstated')
);
ALTER TABLE seller_recoveries DROP CONSTRAINT IF EXISTS seller_recoveries_amounts_valid;
ALTER TABLE seller_recoveries ADD CONSTRAINT seller_recoveries_amounts_valid CHECK (
  amount_cents >= 0 AND fee_cents >= 0 AND held_cancelled_cents >= 0
  AND recovered_cents >= 0 AND forgiven_cents >= 0
  AND recovered_cents + forgiven_cents <= amount_cents + fee_cents
);

-- One recovery per (dispute, order): a retried webhook can never open a second.
CREATE UNIQUE INDEX IF NOT EXISTS seller_recoveries_dispute_order_unique
  ON seller_recoveries (stripe_dispute_id, order_id);
CREATE INDEX IF NOT EXISTS seller_recoveries_seller_open_idx
  ON seller_recoveries (seller_id, created_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS seller_recoveries_seller_idx
  ON seller_recoveries (seller_id, created_at);

CREATE TABLE IF NOT EXISTS seller_recovery_applications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_id   UUID NOT NULL REFERENCES seller_recoveries(id) ON DELETE CASCADE,
  -- transfer_reversal | release_netting | payout_netting | manual | write_off | reinstated
  source        TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,
  -- Stripe transfer reversal id / order release id / transfer id.
  stripe_ref    TEXT,
  -- The order whose release was netted (release_netting), for display.
  order_id      UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS seller_recovery_applications_recovery_idx
  ON seller_recovery_applications (recovery_id, created_at);

-- How much of a release / order transfer was kept back to pay a recovery.
-- NULL = not decided yet; set once, before the Stripe transfer, so a retried
-- transfer always sends the same amount under the same idempotency key.
ALTER TABLE order_releases ADD COLUMN IF NOT EXISTS recovery_netted_cents INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recovery_netted_cents INTEGER;

-- ── B) Thread Cash funding ────────────────────────────────────────────────────
ALTER TABLE thread_cash_entries ADD COLUMN IF NOT EXISTS funding TEXT NOT NULL DEFAULT 'promo';
-- Backfill: no Thread Cash purchase source has ever existed, so every row
-- (rewards, refunds, sends, live gifts, cash-outs) is promo. The DEFAULT above
-- already filled them; this keeps a re-run explicit and harmless.
UPDATE thread_cash_entries SET funding = 'promo' WHERE funding IS NULL OR funding NOT IN ('promo', 'paid');
ALTER TABLE thread_cash_entries DROP CONSTRAINT IF EXISTS thread_cash_entries_funding_valid;
ALTER TABLE thread_cash_entries ADD CONSTRAINT thread_cash_entries_funding_valid CHECK (funding IN ('promo', 'paid'));
CREATE INDEX IF NOT EXISTS thread_cash_entries_buyer_funding_idx
  ON thread_cash_entries (buyer_id, funding);
