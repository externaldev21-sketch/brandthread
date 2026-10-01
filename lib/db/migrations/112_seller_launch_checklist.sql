-- 112: Seller launch checklist — accent colour, first buyer-preview, card dismissal.
ALTER TABLE users ADD COLUMN IF NOT EXISTS store_accent_color TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS store_previewed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS launch_checklist_dismissed_at TIMESTAMPTZ;
