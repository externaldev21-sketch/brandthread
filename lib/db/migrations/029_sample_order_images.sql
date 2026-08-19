-- ─── Migration 029: Sample order images ──────────────────────────────────────
-- Adds image_urls JSONB column to sample_orders for persisting GCS object paths.
-- Idempotent: uses IF NOT EXISTS / DO $$ EXCEPTION pattern.

ALTER TABLE sample_orders ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
