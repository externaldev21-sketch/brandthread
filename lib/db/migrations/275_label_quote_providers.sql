-- 275: Discounted labels from more than one provider (Shippo, EasyPost).
-- A quote remembers which provider it came from, so the label is bought there,
-- and the provider's published retail price when it gives one (EasyPost
-- retail_rate / list_rate), so the app can show the real saving. Shippo quotes
-- carry no retail figure and keep NULL. shipping_labels.provider already exists.
ALTER TABLE shipping_label_quotes ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'shippo';
ALTER TABLE shipping_label_quotes ADD COLUMN IF NOT EXISTS retail_price_cents INTEGER;
