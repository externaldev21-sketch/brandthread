-- Buyer address books and guest checkout identity support.
-- Safe on databases where drizzle has already created the current schema.

CREATE TABLE IF NOT EXISTS buyer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'Shipping',
  recipient_name TEXT NOT NULL,
  street TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  phone TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS buyer_addresses_buyer_list_idx
  ON buyer_addresses (buyer_id, is_default, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS buyer_addresses_one_default_per_buyer_uidx
  ON buyer_addresses (buyer_id) WHERE is_default;

ALTER TABLE checkout_sessions
  ALTER COLUMN buyer_id DROP NOT NULL;
ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS guest_email TEXT,
  ADD COLUMN IF NOT EXISTS guest_access_token_hash TEXT;
CREATE INDEX IF NOT EXISTS checkout_sessions_guest_access_token_hash_idx
  ON checkout_sessions (guest_access_token_hash);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS guest_email TEXT;