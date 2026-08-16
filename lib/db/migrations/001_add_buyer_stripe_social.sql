-- Migration 001: Add buyer profile, Stripe Connect, and social tables
-- Idempotent: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS
-- Apply with: psql $DATABASE_URL -f migrations/001_add_buyer_stripe_social.sql

-- ─── Users: buyer profile + Stripe Connect fields ─────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS display_name          TEXT,
  ADD COLUMN IF NOT EXISTS bio                   TEXT,
  ADD COLUMN IF NOT EXISTS profile_image_url     TEXT,
  ADD COLUMN IF NOT EXISTS account_type          TEXT,
  ADD COLUMN IF NOT EXISTS stripe_account_id     TEXT,
  ADD COLUMN IF NOT EXISTS stripe_account_status TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_account_id_key
  ON users (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

-- ─── Products: style tags ──────────────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS style_tags JSON NOT NULL DEFAULT '[]';

-- ─── Orders: buyer + Stripe payment references ────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS buyer_id                   TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id   TEXT,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;

-- Unique constraint ensures the webhook handler creates at most one order per
-- Stripe Checkout Session (idempotency at the database level).
CREATE UNIQUE INDEX IF NOT EXISTS orders_stripe_checkout_session_id_key
  ON orders (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- ─── Posts ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT        NOT NULL,
  media_url    TEXT        NOT NULL,
  media_type   TEXT        NOT NULL DEFAULT 'photo',
  caption      TEXT,
  style_tags   JSON        NOT NULL DEFAULT '[]',
  created_at   TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- ─── Interactions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interactions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL,
  post_id     UUID        REFERENCES posts (id) ON DELETE CASCADE,
  type        TEXT        NOT NULL,
  value       TEXT,
  created_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);

-- ─── Checkout Sessions (server-side cart; avoids Stripe 50-key metadata limit) ─
-- The buyer.ts route inserts a record before creating the Stripe session,
-- then updates stripe_session_id once Stripe responds.
-- The webhook reads items from here instead of from Stripe metadata.
CREATE TABLE IF NOT EXISTS checkout_sessions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id TEXT        UNIQUE,
  buyer_id          TEXT        NOT NULL,
  seller_id         TEXT        NOT NULL,
  items             JSON        NOT NULL,
  created_at        TIMESTAMP   NOT NULL DEFAULT NOW()
);
