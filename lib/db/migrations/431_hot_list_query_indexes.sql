-- Migration 431: composite indexes for hot list/feed queries that 085 did not
-- cover. Each one matches a real query's filter + ORDER BY so Postgres can
-- walk the index and stop at the page limit instead of sorting every row.
--
-- Plain CREATE INDEX (not CONCURRENTLY): scripts/migrate.mjs runs every file
-- inside BEGIN/COMMIT, and CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block. On a very large production table an operator can
-- pre-create any of these by hand with CONCURRENTLY (same name) before
-- deploying; the IF NOT EXISTS below then makes this file a no-op.

-- Buyer order history: routes/buyer.ts GET /orders
--   WHERE buyer_id = $1 ORDER BY created_at DESC, id DESC LIMIT n
-- (085's orders_buyer_id_idx only covers the filter, not the sort.)
CREATE INDEX IF NOT EXISTS orders_buyer_created_idx
  ON orders (buyer_id, created_at DESC)
  WHERE buyer_id IS NOT NULL;

-- Public product discovery: routes/public.ts GET /products (no owner/category
-- filter), /search/suggested "recent products", discovery feeds
--   WHERE status = 'active' AND deleted_at IS NULL ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS products_status_created_idx
  ON products (status, created_at DESC)
  WHERE deleted_at IS NULL;

-- Category browse + "Search by category" covers: routes/public.ts
-- GET /products?category= and GET /search/categories (DISTINCT ON category)
--   WHERE category = $1 AND status = 'active' AND deleted_at IS NULL
--   ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS products_category_status_created_idx
  ON products (category, status, created_at DESC)
  WHERE deleted_at IS NULL;

-- Follower list: routes/social.ts GET /followers
--   WHERE following_id = $1 ORDER BY created_at DESC LIMIT n
CREATE INDEX IF NOT EXISTS follows_following_created_idx
  ON follows (following_id, created_at DESC);

-- Following list: routes/social.ts GET /following (sort latest/earliest),
-- story-mentions suggestions
--   WHERE follower_id = $1 ORDER BY created_at DESC|ASC LIMIT n
-- (the (follower_id, following_id) primary key covers the filter only.)
CREATE INDEX IF NOT EXISTS follows_follower_created_idx
  ON follows (follower_id, created_at DESC);

-- Seller drop list: routes/drops.ts GET / — drops.owner_id had no index.
--   WHERE owner_id = $1 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS drops_owner_created_idx
  ON drops (owner_id, created_at DESC);
