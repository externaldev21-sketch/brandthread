-- Migration 026: add share_preview_revoked_at to storefronts
-- Tracks when the seller last revoked their shareable preview link.
-- Tokens issued before this timestamp are treated as expired.
ALTER TABLE storefronts
  ADD COLUMN IF NOT EXISTS share_preview_revoked_at TIMESTAMPTZ;
