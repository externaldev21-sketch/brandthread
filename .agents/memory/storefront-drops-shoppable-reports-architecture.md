---
name: Storefront, Drops, Shoppable Posts, Reports & Bio Link
description: Migration 008 — public seller storefront, buyer-facing drops, shoppable post tagging, content reports, bio/website link, CRM wiring, repost DB logging.
---

## Migration 008 columns/tables added
- `users.website TEXT` — bio link (PATCH /api/auth/profile persists it)
- `drops.release_at TIMESTAMPTZ` — countdown timer for buyer-facing drops
- `post_tagged_products` table — (post_id UUID FK→posts, product_id UUID FK→products, position INT)
- `reports` table — (reporter_id TEXT, target_type, target_id, target_label, reason, description, status TEXT DEFAULT 'pending')

## New API routes (all in api-server/src/routes/)

### public.ts additions
- `GET /api/public/sellers/:sellerId` → { profile, products, posts } — seller public storefront
- `GET /api/public/drops` → active drops with seller info, ordered by releaseAt
- `GET /api/public/drops/:id` → single active drop + seller info

### auth.ts addition
- `PATCH /api/auth/profile` (requireAuth) — update { displayName, bio, website, name } on users table

### posts.ts (new file, mounted at /api/posts)
- `POST /api/posts` (requireAuth) — create post + tag owned products; validates UUID product IDs belong to poster
- `GET /api/posts/:id` — single post + tagged products + likeCount + repostCount (public)
- `POST /api/posts/:id/interact` (requireAuth) — toggle like/repost; append watch_time; uses interactions table

### reports.ts (new file, mounted at /api/reports)
- `POST /api/reports` (requireAuth) — submit content report
- `GET /api/reports` (requireAuth) — list reports with ?status= filter (admin view)
- `PATCH /api/reports/:id/status` (requireAuth) — update report status

## Drizzle schema
- postTaggedProducts and reports tables exported from lib/db/src/schema/index.ts
- Import `{ postTaggedProducts, reports }` from "@workspace/db"

## Mobile wiring
- seller-profile.tsx: calls `api.publicSellers.get(sellerId)`; falls back to DEMO_SELLER_PROFILE on error; website is TouchableOpacity → Linking.openURL
- edit-profile.tsx: Save calls `api.seller.updateProfile()`; shows 'Saving…' state; Alert on error
- (buyer)/profile.tsx: website wrapped in TouchableOpacity → Linking.openURL
- socialService.ts createSellerPost(): fire-and-forgets to POST /api/posts after AsyncStorage save
- (tabs)/feed.tsx = buyer Thread feed (buyer/index.tsx re-exports it): Shop indicator when productTags.length > 0, routes to buyer-product-detail
- customers.tsx: GET /api/customers with ?search= param + loading state
- socialService.ts repostPost(): logs POST /api/posts/:id/interact for UUID post IDs (fire-and-forget)
- buyer-report.tsx: persists to POST /api/reports via serviceRequest

## Manufacturer portal
- New /reports page — lists reports by status filter, Action/Dismiss buttons call PATCH /:id/status

## Buyer/Seller separation audit result
- CLEAN: all buyer screens ((buyer)/_layout, profile, index, discover, friends) navigate only to buyer-prefixed routes
- No seller tools (add-product, analytics, inventory, etc.) accessible from buyer navigation
- Separation is layout-level via AuthGate (AsyncStorage user_role → routes to (buyer)/ or (tabs)/)

## Known gaps (not yet built)
- No mobile screen for buyer to browse drops listings (API exists, no UI screen)
- Customer detail screen wiring to GET /api/customers/:id (customer list is wired; tap-through may still show demo data)
- Drop products linkage: drops have no product catalog (orders link to drops, but no products.dropId FK)
