-- ─── Migration 034: Seller profile avatar ────────────────────────────────────
-- Stores the normalized private object path for a seller-selected brand image.
-- Clerk's avatar_url remains untouched as the non-upload fallback.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_image_url TEXT;