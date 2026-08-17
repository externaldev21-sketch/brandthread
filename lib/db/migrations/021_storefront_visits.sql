-- ─── Migration 021: Storefront Visit Tracking ─────────────────────────────────
-- Tracks cumulative buyer visits to each seller's public storefront page.
-- Used to compute the real conversion rate (completed orders / storefront visits)
-- on the seller dashboard stat chips.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS storefront_visit_count integer NOT NULL DEFAULT 0;
