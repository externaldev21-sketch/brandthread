-- One-tap product import from the seller's existing Instagram (Meta) connection.
-- OFF by default: Instagram media URLs are signed CDN links that expire, so an
-- operator turns this on only once imported images are re-hosted (or accepted
-- as short-lived). Shopify store-link import needs no flag (public products.json).
INSERT INTO feature_flags (key, enabled, description)
VALUES ('instagramProductImport', false, 'Import Instagram posts into product drafts (needs an existing Meta connection)')
ON CONFLICT (key) DO NOTHING;
