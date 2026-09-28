-- 102: A photo of the seller's own size chart on a product — distinct from
-- the existing structured `size_chart` JSON table added earlier. Optional
-- and additive: every existing row keeps working (no chart photo → no
-- "Size guide" link on the buyer product page), and nothing else reads or
-- writes the column.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS size_chart_image_url TEXT;
