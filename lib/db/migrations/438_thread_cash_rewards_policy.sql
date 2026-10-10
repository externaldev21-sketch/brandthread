-- 261: Thread Cash rewards policy (revenue audit BT-105/106/111/112/121/123/125/131).
-- Additive and idempotent (safe to re-run).
--
-- A) Funding: every thread_cash_entries row is 'promo' (platform-funded
--    rewards — check-in, streaks, referral, refunds of promo spend, admin
--    credit, and anything relayed from them by a send or Live gift) or 'paid'
--    (money a person actually paid in). Only paid funds a seller RECEIVES as a
--    Live gift are ever withdrawable (api-server lib/threadCash/funding.ts).
--    No Thread Cash purchase source exists, so every existing row is promo.
--    Same column, default and constraint as the funding part of migration 306
--    (open PR "promo Thread Cash never withdrawable"), so either can run first.
ALTER TABLE thread_cash_entries ADD COLUMN IF NOT EXISTS funding TEXT NOT NULL DEFAULT 'promo';
UPDATE thread_cash_entries SET funding = 'promo' WHERE funding IS NULL OR funding NOT IN ('promo', 'paid');
ALTER TABLE thread_cash_entries DROP CONSTRAINT IF EXISTS thread_cash_entries_funding_valid;
ALTER TABLE thread_cash_entries ADD CONSTRAINT thread_cash_entries_funding_valid CHECK (funding IN ('promo', 'paid'));
CREATE INDEX IF NOT EXISTS thread_cash_entries_buyer_funding_idx
  ON thread_cash_entries (buyer_id, funding);

-- Monthly rewards budget: sums reward credit issued since the start of the
-- month across every buyer.
CREATE INDEX IF NOT EXISTS thread_cash_entries_source_created_idx
  ON thread_cash_entries (source, created_at);

-- B) Per-device reward cap: one row per (device, account, buyer-local day) a
--    daily/streak reward was paid. The device key is a SHA-256 of the app's
--    install id, never the raw id. Lets the server cap rewards per PHONE
--    across every account signed in on it, not just per account.
CREATE TABLE IF NOT EXISTS thread_cash_device_rewards (
  device_key  TEXT NOT NULL,
  buyer_id    TEXT NOT NULL,
  local_date  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_key, buyer_id, local_date)
);
CREATE INDEX IF NOT EXISTS thread_cash_device_rewards_device_created_idx
  ON thread_cash_device_rewards (device_key, created_at);

-- C) Peer send OFF until legal sign-off (BT-111). Migration 085 shipped it OFF
--    "until Dev confirms with a lawyer that peer-to-peer Thread Cash transfer
--    does not trigger money-transmitter / App Store rules"; 088 turned it on
--    citing only technical hardening. That sign-off has not been recorded, so
--    it goes back off. An operator turns it on in feature_flags once it is.
UPDATE feature_flags SET enabled = false,
  description = 'Send Thread Cash to a friend in chat (mutual-follow required). OFF until legal sign-off on peer-to-peer transfer.'
  WHERE key = 'threadCashSend';
