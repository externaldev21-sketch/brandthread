-- 270: Server-side storage for Store Builder state that used to live only on
-- the seller's phone (collections, pages, navigation menu, store settings,
-- brand assets, setup checklist, onboarding goals). Additive only.
ALTER TABLE storefronts ADD COLUMN IF NOT EXISTS collections     JSON NOT NULL DEFAULT '[]'::json;
ALTER TABLE storefronts ADD COLUMN IF NOT EXISTS pages           JSON NOT NULL DEFAULT '[]'::json;
ALTER TABLE storefronts ADD COLUMN IF NOT EXISTS navigation      JSON NOT NULL DEFAULT '[]'::json;
ALTER TABLE storefronts ADD COLUMN IF NOT EXISTS store_settings  JSON NOT NULL DEFAULT '{}'::json;
ALTER TABLE storefronts ADD COLUMN IF NOT EXISTS brand_assets    JSON NOT NULL DEFAULT '{}'::json;
ALTER TABLE storefronts ADD COLUMN IF NOT EXISTS setup_checklist JSON NOT NULL DEFAULT '{}'::json;
ALTER TABLE storefronts ADD COLUMN IF NOT EXISTS onboarding      JSON NOT NULL DEFAULT '{}'::json;
