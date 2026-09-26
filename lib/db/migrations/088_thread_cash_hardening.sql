-- ─── Migration 088: Thread Cash hardening (checkout redemption + send) ───────
-- Adds what's needed to safely enable checkout-discount redemption and turn
-- 'threadCashSend' on by default: idempotency keys with unique constraints
-- (so a double-tap or retried request can never double-spend/double-credit),
-- a positive-amount guard on transfers, per-buyer admin freeze, anti-farming
-- config, and the order-side column that lets a refund claw back the
-- platform-funded seller top-up transfer.

-- Required client idempotency key on the two ledger-mutating write paths that
-- did not already have a natural one (check-in has (buyer_id, local_date);
-- redemption already has a unique token; claim/cancel are state-machine
-- transitions guarded by conditional updates).
ALTER TABLE thread_cash_entries ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS thread_cash_entries_idempotency_key_unique
  ON thread_cash_entries(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE thread_cash_transfers ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS thread_cash_transfers_idempotency_key_unique
  ON thread_cash_transfers(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Optional note attached by the sender; cancellation and expiry bookkeeping.
ALTER TABLE thread_cash_transfers ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE thread_cash_transfers ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE thread_cash_transfers ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Even buggy application code can never insert a non-positive transfer.
DO $$ BEGIN
  ALTER TABLE thread_cash_transfers
    ADD CONSTRAINT thread_cash_transfers_amount_positive CHECK (amount_cents > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE thread_cash_transfers
    ADD CONSTRAINT thread_cash_transfers_not_self CHECK (sender_id <> recipient_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per-buyer admin freeze (moderation kill switch, independent of the global
-- feature flags) and a snapshot of today's send/receive totals used to
-- enforce the daily caps below without scanning the whole ledger each time.
ALTER TABLE thread_cash_streaks ADD COLUMN IF NOT EXISTS frozen BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE thread_cash_streaks ADD COLUMN IF NOT EXISTS frozen_reason TEXT;
ALTER TABLE thread_cash_streaks ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ;
ALTER TABLE thread_cash_streaks ADD COLUMN IF NOT EXISTS frozen_by TEXT;

-- Anti-farming config, edited the same way as the rest of thread_cash_config.
ALTER TABLE thread_cash_config ADD COLUMN IF NOT EXISTS daily_send_cap_cents INTEGER NOT NULL DEFAULT 2000;
ALTER TABLE thread_cash_config ADD COLUMN IF NOT EXISTS daily_receive_cap_cents INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE thread_cash_config ADD COLUMN IF NOT EXISTS min_account_age_hours_for_send INTEGER NOT NULL DEFAULT 24;
ALTER TABLE thread_cash_config ADD COLUMN IF NOT EXISTS max_check_ins_per_device_per_day INTEGER NOT NULL DEFAULT 3;

-- The platform-funded supplemental Stripe transfer that tops a seller up to
-- the full item price when a buyer paid partly with Thread Cash (destination
-- charges only). Recorded so a full refund/cancellation can reverse exactly
-- this transfer, not just the buyer's (already-discounted) card charge.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_thread_cash_transfer_id TEXT;

-- Turn Send Thread Cash on by default now that mutual-follow/block checks,
-- caps, freeze, and idempotency are in place. Still a server-side kill
-- switch — an operator can flip it back off at any time.
UPDATE feature_flags SET enabled = true, description = 'Send Thread Cash to a friend in chat (mutual-follow required)'
  WHERE key = 'threadCashSend';

-- Checkout-discount redemption is now wired end-to-end (routes/buyer.ts +
-- routes/webhooks.ts + lib/threadCash/checkoutTopup.ts): the platform-funded
-- seller top-up keeps seller payout unchanged. Left OFF here deliberately —
-- see the PR description's sign-off checklist (Stripe Connect payout
-- capability, accounting treatment) before an operator flips it on.
