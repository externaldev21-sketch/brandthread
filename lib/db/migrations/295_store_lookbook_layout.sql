-- 295: Store page Lookbook mode — users.store_layout.
--
-- 'grid' (the existing store page, default) or 'lookbook' (full-screen
-- editorial swipe through the seller's products). Lives on users because the
-- buyer store page reads GET /api/public/sellers/:id, which only reads users.
-- Idempotent; touches no existing data beyond the default.

ALTER TABLE users ADD COLUMN IF NOT EXISTS store_layout TEXT NOT NULL DEFAULT 'grid';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_store_layout_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_store_layout_check CHECK (store_layout IN ('grid', 'lookbook'));
  END IF;
END $$;
