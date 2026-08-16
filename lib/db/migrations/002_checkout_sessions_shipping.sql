-- Migration 002: Add shipping_address to checkout_sessions
-- Idempotent: uses ADD COLUMN IF NOT EXISTS
-- Apply with: psql $DATABASE_URL -f migrations/002_checkout_sessions_shipping.sql

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS shipping_address JSON;
