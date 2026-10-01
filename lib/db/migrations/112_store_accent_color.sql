-- 112: Store accent colour chosen in store identity setup (monochrome allowlist, validated server-side).
ALTER TABLE users ADD COLUMN IF NOT EXISTS store_accent_color TEXT;
