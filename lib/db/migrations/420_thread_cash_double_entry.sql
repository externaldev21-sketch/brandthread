-- ─── Migration 420: Thread Cash double-entry journal, no negative wallets,
--     per-device daily reward cap ────────────────────────────────────────────
-- Additive and idempotent (safe to re-run).
--
-- A) Double-entry journal. Every thread_cash_entries row (the per-user wallet
--    ledger, balance = SUM(amount_cents)) is mirrored by exactly two postings
--    that sum to zero: the user's `wallet` account and the counter-account its
--    source draws from (rewards issued, a transfer clearing account, checkout
--    redemptions, cash-outs, expiry…). A trigger writes them in the same
--    statement as the entry, so every write path — today's and future ones —
--    is covered without touching application code. Transfers post to shared
--    clearing accounts (`transfer_clearing`, `live_gift_clearing`) whose
--    balance per reference is zero once both sides exist, which makes a
--    half-written transfer visible.
--
-- B) A wallet can never be overdrawn: a deferred constraint trigger re-sums
--    the wallet at COMMIT whenever a debit is inserted and rejects the whole
--    transaction if it went below zero. It serialises on a per-user advisory
--    lock so two concurrent debits can't both pass. Credits are never blocked
--    (a wallet that is somehow already negative can still be topped up).
--
-- C) Daily reward cap per device (not just per account): one row per
--    (device, buyer-local date, account) that was paid a daily reward.

-- ── A) Journal ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS thread_cash_journal (
  id            BIGSERIAL PRIMARY KEY,
  entry_id      UUID NOT NULL REFERENCES thread_cash_entries (id) ON DELETE CASCADE,
  account       TEXT NOT NULL,
  party_id      TEXT,
  amount_cents  BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT thread_cash_journal_amount_nonzero CHECK (amount_cents <> 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS thread_cash_journal_entry_account_unique
  ON thread_cash_journal (entry_id, account);
CREATE INDEX IF NOT EXISTS thread_cash_journal_account_party_idx
  ON thread_cash_journal (account, party_id);

-- The counter-account a source's movement is posted against.
CREATE OR REPLACE FUNCTION thread_cash_contra_account(source TEXT) RETURNS TEXT AS $$
  SELECT CASE
    WHEN source IN ('daily_checkin', 'streak_bonus', 'referral', 'signup', 'bonus', 'admin_adjustment', 'order_earn')
      THEN 'rewards_issued'
    WHEN source IN ('send_sent', 'send_received', 'send_cancelled', 'send_expired')
      THEN 'transfer_clearing'
    WHEN source IN ('live_gift_sent', 'live_gift')
      THEN 'live_gift_clearing'
    WHEN source IN ('redemption', 'checkout_spend', 'refund_credit', 'refund')
      THEN 'checkout_redemptions'
    WHEN source = 'cash_out' THEN 'cashed_out'
    WHEN source = 'expiry' THEN 'expired'
    ELSE 'other:' || source
  END
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION thread_cash_journal_post() RETURNS trigger AS $$
BEGIN
  IF NEW.amount_cents = 0 THEN
    RETURN NULL;
  END IF;
  INSERT INTO thread_cash_journal (entry_id, account, party_id, amount_cents)
  VALUES
    (NEW.id, 'wallet', NEW.buyer_id, NEW.amount_cents),
    (NEW.id, thread_cash_contra_account(NEW.source), NEW.reference_id, -NEW.amount_cents)
  ON CONFLICT (entry_id, account) DO NOTHING;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'thread_cash_entries_journal') THEN
    CREATE TRIGGER thread_cash_entries_journal
      AFTER INSERT ON thread_cash_entries
      FOR EACH ROW EXECUTE FUNCTION thread_cash_journal_post();
  END IF;
END $$;

-- Entry amounts are immutable (application code only ever updates the
-- redemption bookkeeping columns). Correct a wrong amount with a new entry.
CREATE OR REPLACE FUNCTION thread_cash_entries_reject_amount_change() RETURNS trigger AS $$
BEGIN
  IF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id
     OR NEW.source IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION 'thread cash entry % amount/owner/source are immutable; post a new entry instead', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'thread_cash_entries_amount_immutable') THEN
    CREATE TRIGGER thread_cash_entries_amount_immutable
      BEFORE UPDATE ON thread_cash_entries
      FOR EACH ROW EXECUTE FUNCTION thread_cash_entries_reject_amount_change();
  END IF;
END $$;

-- Backfill postings for entries written before this migration.
INSERT INTO thread_cash_journal (entry_id, account, party_id, amount_cents, created_at)
SELECT e.id, 'wallet', e.buyer_id, e.amount_cents, e.created_at
FROM thread_cash_entries e
WHERE e.amount_cents <> 0
ON CONFLICT (entry_id, account) DO NOTHING;
INSERT INTO thread_cash_journal (entry_id, account, party_id, amount_cents, created_at)
SELECT e.id, thread_cash_contra_account(e.source), e.reference_id, -e.amount_cents, e.created_at
FROM thread_cash_entries e
WHERE e.amount_cents <> 0
ON CONFLICT (entry_id, account) DO NOTHING;

-- Entries whose two postings don't sum to zero (always empty unless a
-- posting was deleted by hand). Used by tests and the integrity check.
CREATE OR REPLACE VIEW thread_cash_journal_unbalanced AS
SELECT e.id AS entry_id, e.amount_cents, COALESCE(SUM(j.amount_cents), 0) AS journal_sum, COUNT(j.id) AS postings
FROM thread_cash_entries e
LEFT JOIN thread_cash_journal j ON j.entry_id = e.id
WHERE e.amount_cents <> 0
GROUP BY e.id, e.amount_cents
HAVING COALESCE(SUM(j.amount_cents), 0) <> 0 OR COUNT(j.id) <> 2;

-- ── B) No negative wallets ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION thread_cash_assert_wallet_not_overdrawn() RETURNS trigger AS $$
DECLARE
  balance BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('thread-cash-wallet-guard:' || NEW.buyer_id));
  SELECT COALESCE(SUM(amount_cents), 0) INTO balance
  FROM thread_cash_entries WHERE buyer_id = NEW.buyer_id;
  IF balance < 0 THEN
    RAISE EXCEPTION 'Thread Cash wallet % would be overdrawn (balance % cents)', NEW.buyer_id, balance
      USING ERRCODE = 'check_violation', CONSTRAINT = 'thread_cash_wallet_not_overdrawn';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'thread_cash_wallet_not_overdrawn') THEN
    CREATE CONSTRAINT TRIGGER thread_cash_wallet_not_overdrawn
      AFTER INSERT ON thread_cash_entries
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW
      WHEN (NEW.amount_cents < 0)
      EXECUTE FUNCTION thread_cash_assert_wallet_not_overdrawn();
  END IF;
END $$;

-- ── C) Per-device daily reward cap ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS thread_cash_device_claims (
  device_id   TEXT NOT NULL,
  local_date  TEXT NOT NULL,
  buyer_id    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, local_date, buyer_id)
);
CREATE INDEX IF NOT EXISTS thread_cash_device_claims_buyer_idx
  ON thread_cash_device_claims (buyer_id, local_date);

-- The daily reward is one per person/device: tighten the shipped default of
-- 3 accounts per device per day to 1. A value a moderator already changed
-- from the default is left alone.
ALTER TABLE thread_cash_config ALTER COLUMN max_check_ins_per_device_per_day SET DEFAULT 1;
UPDATE thread_cash_config SET max_check_ins_per_device_per_day = 1
WHERE max_check_ins_per_device_per_day = 3;
