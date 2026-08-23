-- Migration 033: retain only the fingerprint of the current public preview link.
-- A raw preview token is a bearer credential and must never be stored.
ALTER TABLE storefronts
  ADD COLUMN IF NOT EXISTS share_preview_token_hash TEXT;