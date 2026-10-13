-- 290: Read receipts privacy (polish #157).
-- Off = the people you message don't see "Seen" on what they sent you.
-- Defaults on for everyone, matching Instagram.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS read_receipts_enabled BOOLEAN NOT NULL DEFAULT TRUE;
