-- 116: Store-specific gift cards. A card is bought for one seller's store and
-- only redeems against that store's group at checkout. The code is shown once
-- (email / share) and stored only as a SHA-256 hash + last 4 characters.
-- gift_card_transactions is an append-only ledger; balance_cents on gift_cards
-- is a cache that is only ever changed by a guarded atomic UPDATE in the same
-- transaction as the ledger row.
CREATE TABLE IF NOT EXISTS gift_cards (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id                TEXT NOT NULL,
  code_hash                TEXT UNIQUE,
  code_last4               TEXT,
  initial_cents            INTEGER NOT NULL CHECK (initial_cents > 0),
  balance_cents            INTEGER NOT NULL CHECK (balance_cents >= 0),
  currency                 TEXT NOT NULL DEFAULT 'usd',
  purchaser_id             TEXT,
  owner_id                 TEXT,
  recipient_email          TEXT,
  recipient_name           TEXT,
  message                  TEXT,
  -- 'pending_payment' | 'active' | 'void'
  status                   TEXT NOT NULL DEFAULT 'pending_payment',
  source                   TEXT NOT NULL DEFAULT 'purchase', -- 'purchase' | 'seller_issued'
  expires_at               TIMESTAMPTZ,
  stripe_payment_intent_id TEXT UNIQUE,
  delivered_at             TIMESTAMPTZ,
  voided_at                TIMESTAMPTZ,
  voided_by                TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS gift_cards_seller_idx ON gift_cards (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gift_cards_owner_idx ON gift_cards (owner_id);
CREATE INDEX IF NOT EXISTS gift_cards_purchaser_idx ON gift_cards (purchaser_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id         UUID NOT NULL REFERENCES gift_cards(id),
  -- 'issue' | 'redeem' (reserve at checkout) | 'settle' | 'release' | 'refund' | 'adjust' | 'void'
  type                 TEXT NOT NULL,
  -- Signed change to balance_cents (settle is 0: it only marks a redeem as final).
  amount_cents         INTEGER NOT NULL,
  balance_after_cents  INTEGER NOT NULL,
  checkout_session_id  UUID,
  order_id             UUID,
  actor_id             TEXT,
  note                 TEXT,
  idempotency_key      TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_transactions_idem_uniq ON gift_card_transactions (idempotency_key);
CREATE INDEX IF NOT EXISTS gift_card_transactions_card_idx ON gift_card_transactions (gift_card_id, created_at);
CREATE INDEX IF NOT EXISTS gift_card_transactions_checkout_idx ON gift_card_transactions (checkout_session_id);
CREATE INDEX IF NOT EXISTS gift_card_transactions_order_idx ON gift_card_transactions (order_id);

-- Append-only: ledger rows can never be changed (corrections are new rows).
-- DELETE stays possible only so the test-data purge can remove a test user's rows.
CREATE OR REPLACE FUNCTION gift_card_transactions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gift_card_transactions is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS gift_card_transactions_no_update ON gift_card_transactions;
CREATE TRIGGER gift_card_transactions_no_update
  BEFORE UPDATE ON gift_card_transactions
  FOR EACH ROW EXECUTE FUNCTION gift_card_transactions_immutable();

-- Per-store setting: whether the store sells gift cards and at which amounts.
CREATE TABLE IF NOT EXISTS gift_card_settings (
  seller_id      TEXT PRIMARY KEY,
  enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  denominations  INTEGER[] NOT NULL DEFAULT ARRAY[2500, 5000, 10000],
  allow_custom   BOOLEAN NOT NULL DEFAULT FALSE,
  expiry_months  INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
