-- Migration 085: performance indexes for the hottest read paths (feed/discover,
-- product detail, checkout, seller dashboard/analytics). None of these change
-- data or behavior — they only give the planner an index to use instead of a
-- sequential scan on tables that grow without bound (orders, interactions,
-- products, manufacturers, seller_quote_requests).

-- orders.owner_id is the primary filter for every seller-dashboard analytics
-- query (revenue today/week/all-time, order counts, customer stats) and had
-- no index at all — every one of those was a full sequential scan of orders.
-- The composite also covers the date-range (created_at) queries directly.
CREATE INDEX IF NOT EXISTS orders_owner_created_idx ON orders (owner_id, created_at DESC);

-- Buyer-facing order history / guest checkout verification look up by buyer_id.
CREATE INDEX IF NOT EXISTS orders_buyer_id_idx ON orders (buyer_id) WHERE buyer_id IS NOT NULL;

-- Post-purchase attribution (posts.ts /:id/analytics "conversions" query)
-- filters on source_post_id; previously unindexed.
CREATE INDEX IF NOT EXISTS orders_source_post_id_idx ON orders (source_post_id) WHERE source_post_id IS NOT NULL;

-- customers.owner_id backs the seller dashboard's customer count/list queries.
CREATE INDEX IF NOT EXISTS customers_owner_id_idx ON customers (owner_id);

-- products.owner_id had no index at all despite being the seller's own
-- product-list filter (products.ts GET /), the public storefront filter
-- (public.ts GET /products?ownerId=), and post-tag validation. The composite
-- covers the common "active, not deleted, newest first" shape directly.
CREATE INDEX IF NOT EXISTS products_owner_status_created_idx
  ON products (owner_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

-- interactions (post_id, type) composite: every feed/discover/post-detail
-- response counts likes and reposts with
--   WHERE post_id IN (...) AND type = 'like'/'repost' GROUP BY post_id
-- (posts.ts postDetails/feed, public.ts /posts, social.ts buildBuyerPosts).
-- Only a single-column post_id index existed (040_fk_indexes.sql), so
-- Postgres still had to filter every matching post_id row by type in memory.
-- This composite lets it seek straight to the matching (post_id, type) rows.
CREATE INDEX IF NOT EXISTS interactions_post_type_idx ON interactions (post_id, type) WHERE post_id IS NOT NULL;

-- seller_quote_requests: the existing seller_id-only index forced a sort for
-- "my quote requests, newest first" (seller-hub.ts). Composite avoids the sort.
CREATE INDEX IF NOT EXISTS seller_quote_requests_seller_created_idx
  ON seller_quote_requests (seller_id, created_at DESC);

-- manufacturers public directory listing (manufacturer-public.ts GET /) filters
-- on (is_public_directory, status) and orders by (verified_at DESC NULLS LAST,
-- created_at DESC). A partial index matching that exact filter avoids scanning
-- every manufacturer row (including pending/inactive ones) on every request.
CREATE INDEX IF NOT EXISTS manufacturers_public_directory_idx
  ON manufacturers (verified_at DESC NULLS LAST, created_at DESC)
  WHERE is_public_directory = true AND status = 'active';
