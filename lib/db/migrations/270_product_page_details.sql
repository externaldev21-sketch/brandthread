-- 270: Product page details the seller sets per product (polish 87, 88, 93, 94).
--   model_height_cm / model_size_worn → "Model is 6'1", wearing L"
--   fabric / care / origin            → collapsible rows on the product page
--   color_images                      → one photo per colour: {"Ember": "https://…"}
ALTER TABLE products ADD COLUMN IF NOT EXISTS model_height_cm INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS model_size_worn TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS fabric TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS care TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS color_images JSONB NOT NULL DEFAULT '{}'::jsonb;
