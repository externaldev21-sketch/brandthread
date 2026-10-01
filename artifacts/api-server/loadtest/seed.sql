-- LOAD-TEST SEED. Synthetic rows only, every id prefixed `lt_`. Run against a throwaway DB.
-- Scale knobs (psql -v): users, sellers, posts, products, follows_per, convs, msgs_per
\set ON_ERROR_STOP on
\if :{?users} \else \set users 20000 \endif
\if :{?sellers} \else \set sellers 1000 \endif
\if :{?posts} \else \set posts 60000 \endif
\if :{?products} \else \set products 8000 \endif
\if :{?follows_per} \else \set follows_per 20 \endif
\if :{?convs} \else \set convs 10000 \endif
\if :{?msgs_per} \else \set msgs_per 50 \endif

-- sellers are users 1..sellers, buyers the rest
INSERT INTO users (clerk_id, email, name, display_name, brand_name, account_type, username, onboarding_complete, verified, verification_status, bio)
SELECT 'lt_user_'||g, 'lt_'||g||'@loadtest.invalid', 'Load User '||g, 'Load User '||g,
       CASE WHEN g <= :sellers THEN 'Brand '||g END,
       CASE WHEN g <= :sellers THEN 'seller' ELSE 'buyer' END,
       'lt_user_'||g, true, g % 7 = 0, CASE WHEN g % 7 = 0 THEN 'verified' ELSE 'none' END, 'synthetic load-test account'
FROM generate_series(1, :users) g ON CONFLICT DO NOTHING;

INSERT INTO posts (user_id, media_url, thumbnail_url, media_type, aspect_ratio, caption, hashtags, style_tags, created_at, published_at)
SELECT 'lt_user_'||(1 + (g % :sellers)), '/api/posts/media/uploads/lt-'||g||'.mp4', '/api/posts/media/uploads/lt-'||g||'.jpg',
       CASE WHEN g % 10 < 8 THEN 'video' ELSE 'photo' END, '9:16', 'lt post '||g||' streetwear drop',
       '["streetwear","drop"]'::json,
       (ARRAY['["streetwear"]','["minimal"]','["vintage"]','["techwear"]','["y2k"]'])[1 + g % 5]::jsonb,
       now() - (g % 20000) * interval '1 minute' - (random()*interval '10 minutes'), now()
FROM generate_series(1, :posts) g;

INSERT INTO products (owner_id, name, description, category, status, images, tags, style_tags, created_at)
SELECT 'lt_user_'||(1 + (g % :sellers)), 'LT Product '||g, 'synthetic product '||g, (ARRAY['tees','hoodies','pants','hats'])[1 + g % 4], 'active',
       ('["/api/posts/media/uploads/lt-p'||g||'.jpg"]')::json, '["lt"]'::json, '["streetwear"]'::jsonb, now() - (g % 9000) * interval '1 minute'
FROM generate_series(1, :products) g;

INSERT INTO product_variants (product_id, size, color, sku, price_cents, stock)
SELECT p.id, s, 'Black', 'LT-'||substr(p.id::text,1,8)||'-'||s, 2000 + (random()*8000)::int, 500
FROM products p, unnest(ARRAY['S','M','L']) s WHERE p.name LIKE 'LT Product %';

INSERT INTO post_tagged_products (post_id, product_id, position)
SELECT po.id, (SELECT id FROM products WHERE owner_id = po.user_id ORDER BY id LIMIT 1), 0
FROM posts po WHERE po.caption LIKE 'lt post %' AND po.user_id <> '' AND random() < 0.4
  AND EXISTS (SELECT 1 FROM products WHERE owner_id = po.user_id);

INSERT INTO follows (follower_id, following_id)
SELECT 'lt_user_'||b, 'lt_user_'||(1 + ((b * 7919 + k * 104729) % :sellers))
FROM generate_series(:sellers + 1, :users) b, generate_series(1, :follows_per) k ON CONFLICT DO NOTHING;

WITH ids AS (SELECT array_agg(id) a FROM posts)
INSERT INTO interactions (user_id, post_id, type, created_at)
SELECT 'lt_user_'||(:sellers + 1 + (random()*(:users - :sellers - 1))::int), ids.a[1 + (random()*(:posts-1))::int],
       (ARRAY['like','view','view','view','save'])[1 + (random()*4)::int], now() - random()*interval '3 days'
FROM generate_series(1, 200000), ids ON CONFLICT DO NOTHING;

-- DM threads: buyer <-> seller pairs
INSERT INTO conversations (type, last_message, last_message_at)
SELECT 'direct', 'hey', now() FROM generate_series(1, :convs);
WITH c AS (SELECT id, row_number() OVER (ORDER BY id) n FROM conversations WHERE last_message = 'hey')
INSERT INTO conversation_participants (conversation_id, user_id, name, handle, initials)
SELECT id, 'lt_user_'||u, 'LT '||u, 'lt_user_'||u, 'LT'
FROM c, LATERAL (VALUES (n), (:sellers + n)) v(u) WHERE :sellers + n <= :users;
INSERT INTO messages (conversation_id, sender_id, body, status, created_at)
SELECT c.id, 'lt_user_'||(CASE WHEN m % 2 = 0 THEN n ELSE :sellers + n END), 'message '||m, 'sent',
       now() - (:msgs_per - m) * interval '1 minute'
FROM (SELECT id, row_number() OVER (ORDER BY id) n FROM conversations WHERE last_message = 'hey') c, generate_series(1, :msgs_per) m
WHERE :sellers + n <= :users;
ANALYZE;
