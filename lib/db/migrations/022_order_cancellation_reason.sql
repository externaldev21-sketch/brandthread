-- Migration 022: add cancellation_reason and cancellation_notes to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_notes  TEXT;
