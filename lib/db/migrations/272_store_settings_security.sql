-- 272: Store Settings persistence fixes.
--  * store_password_hash: scrypt hash (salted) of the optional storefront
--    access password. The plaintext password is never stored.
--  * policies: store policies (shipping/returns/...) saved by
--    PUT /api/seller/settings/policies. The route already read/wrote this
--    column, but it never existed, so every save failed server-side.
-- Additive only.
ALTER TABLE storefronts ADD COLUMN IF NOT EXISTS store_password_hash TEXT;
ALTER TABLE storefronts ADD COLUMN IF NOT EXISTS policies JSON NOT NULL DEFAULT '[]'::json;
