-- ─── Migration 017: Manufacturer full system ─────────────────────────────────
-- Covers: public directory, invite tokens, Stripe Connect for manufacturers,
--         sample/bulk order 6-stage tracker, drop wallet ledger.

-- 1. Manufacturer table extensions
ALTER TABLE manufacturers ALTER COLUMN clerk_id DROP NOT NULL;
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS years_in_business INTEGER NOT NULL DEFAULT 0;
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS is_public_directory BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS city TEXT;
-- Stripe Connect Express for manufacturer payouts
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;
ALTER TABLE manufacturers ADD COLUMN IF NOT EXISTS stripe_account_status TEXT;

-- 2. Manufacturer invite tokens (seller → private manufacturer onboarding)
CREATE TABLE IF NOT EXISTS manufacturer_invite_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     TEXT NOT NULL,
  token         TEXT NOT NULL UNIQUE,
  company_name  TEXT,
  contact_name  TEXT,
  contact_email TEXT,
  notes         TEXT,
  used_at       TIMESTAMP,
  manufacturer_id UUID REFERENCES manufacturers(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mfg_invite_tokens_seller_idx ON manufacturer_invite_tokens(seller_id);
CREATE INDEX IF NOT EXISTS mfg_invite_tokens_token_idx  ON manufacturer_invite_tokens(token);

-- 3. Sample orders (covers both sample and bulk orders, 6-stage tracker)
CREATE TABLE IF NOT EXISTS sample_orders (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer_id           UUID NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
  seller_id                 TEXT NOT NULL,
  thread_id                 UUID REFERENCES manufacturer_threads(id) ON DELETE SET NULL,
  order_type                TEXT NOT NULL DEFAULT 'sample',  -- 'sample' | 'bulk'
  title                     TEXT NOT NULL,
  description               TEXT,
  quantity                  INTEGER NOT NULL DEFAULT 1,
  price_cents               INTEGER NOT NULL DEFAULT 0,
  -- 6-stage tracker
  status                    TEXT NOT NULL DEFAULT 'payment_received',
  -- 'payment_received' | 'processing' | 'cut_and_sew' | 'packing' | 'shipped' | 'delivered'
  stripe_payment_intent_id  TEXT,
  platform_fee_cents        INTEGER NOT NULL DEFAULT 0,
  payout_released           BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_transfer_id        TEXT,
  tracking_number           TEXT,
  carrier                   TEXT,
  shipped_at                TIMESTAMP,
  delivered_at              TIMESTAMP,
  wallet_id                 UUID,   -- FK added after drop_wallets table
  notes                     TEXT,
  created_at                TIMESTAMP NOT NULL DEFAULT now(),
  updated_at                TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sample_orders_seller_idx ON sample_orders(seller_id);
CREATE INDEX IF NOT EXISTS sample_orders_mfg_idx    ON sample_orders(manufacturer_id);
CREATE INDEX IF NOT EXISTS sample_orders_thread_idx ON sample_orders(thread_id);

-- 4. Drop wallets (per-seller, per-drop held balance ledger)
CREATE TABLE IF NOT EXISTS drop_wallets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id             UUID NOT NULL UNIQUE REFERENCES drops(id) ON DELETE CASCADE,
  seller_id           TEXT NOT NULL,
  balance_cents       INTEGER NOT NULL DEFAULT 0,   -- total deposited (from buyer orders)
  released_cents      INTEGER NOT NULL DEFAULT 0,   -- total paid out to seller bank
  reserved_cents      INTEGER NOT NULL DEFAULT 0,   -- reserved for pending bulk/shipping payments
  stripe_transfer_group TEXT,                        -- e.g. 'drop_{id}' for Stripe grouping
  created_at          TIMESTAMP NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drop_wallets_seller_idx ON drop_wallets(seller_id);

-- 5. Drop wallet transactions (immutable ledger)
CREATE TABLE IF NOT EXISTS drop_wallet_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id         UUID NOT NULL REFERENCES drop_wallets(id) ON DELETE CASCADE,
  -- 'deposit' | 'release' | 'bulk_payment' | 'shipping_payment'
  type              TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL,   -- always positive; type determines debit/credit
  order_id          UUID REFERENCES orders(id) ON DELETE SET NULL,
  sample_order_id   UUID REFERENCES sample_orders(id) ON DELETE SET NULL,
  description       TEXT,
  stripe_transfer_id TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dwt_wallet_idx ON drop_wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS dwt_order_idx  ON drop_wallet_transactions(order_id);

-- 6. Add wallet FK to sample_orders now that drop_wallets exists
DO $$ BEGIN
  ALTER TABLE sample_orders ADD CONSTRAINT sample_orders_wallet_fk
    FOREIGN KEY (wallet_id) REFERENCES drop_wallets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 7. Add media column to manufacturer_messages for photo sharing
ALTER TABLE manufacturer_messages ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]';
ALTER TABLE manufacturer_messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text';
-- message_type: 'text' | 'image' | 'sample_card' | 'bulk_card' | 'system'
ALTER TABLE manufacturer_messages ADD COLUMN IF NOT EXISTS card_data JSONB;
-- card_data for sample_card: { title, description, quantity, priceCents, orderType }
-- card_data for bulk_card: { title, quantity, priceCents, walletBalance }
