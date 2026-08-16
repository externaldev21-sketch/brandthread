---
name: Trust Signals Architecture
description: Reviews system, verified seller badge, and seller return/cancellation policy — DB schema, API routes, and mobile UI integration
---

## Schema (migration 006)
- `users` table gained 3 columns: `verified BOOLEAN DEFAULT false`, `return_policy TEXT`, `cancellation_policy TEXT`
- `reviews` table: id (UUID), buyer_id (TEXT/Clerk), seller_id (TEXT/Clerk), order_id (UUID FK → orders, nullable), product_id (UUID FK → products, nullable), rating (1–5), body TEXT, created_at, updated_at
- Unique constraint: `(buyer_id, order_id)` — but only enforced when order_id IS NOT NULL (Postgres NULL-not-equal behavior). Handled with try-catch + update on 23505 error.

## API Routes
- `GET  /api/reviews/product/:productId` — public, returns { reviews[], avgRating, totalCount }. UUID-validates productId (returns empty if invalid).
- `GET  /api/reviews/seller/:sellerId`  — public, same shape
- `POST /api/reviews`                   — requireAuth, body: { orderId?, sellerId, productId?, rating, body? }
- `GET  /api/seller/profile`            — requireAuth, returns verified status + policies + other profile fields
- `PATCH /api/seller/policy`            — requireAuth, body: { returnPolicy?, cancellationPolicy? }
Mounted: `/reviews` → reviewsRouter, `/seller` → sellerProfileRouter (in addition to existing `/seller/connect`, `/seller/subscription`)

## Mobile API (lib/api.ts)
- `api.reviews.forProduct(productId)` — public (uses auth token but not required by server)
- `api.reviews.forSeller(sellerId)`
- `api.reviews.create({ orderId?, sellerId, productId?, rating, body? })`
- `api.seller.getProfile()` — GET /api/seller/profile
- `api.seller.updatePolicy({ returnPolicy?, cancellationPolicy? })` — PATCH /api/seller/policy

## Mobile UI
- `buyer-product-detail.tsx`: reviews section appended after Policies, shows avg rating + star display + first 5 reviews. Real reviews load via useEffect when product.id is set.
- `buyer-order-detail.tsx`: "Leave a Review" CTA card shown when order.status === 'delivered'. Modal with star picker (5 stars, tap to select) + optional text input + submit.
- `seller-profile.tsx`: useEffect loads reviews.forSeller → apiRating state → rating stat appended in statsRow.

## Design Service AI Auth Fix
`callGenerateAPI` in designService.ts now uses `serviceRequest` from `@/lib/serviceConfig` (which attaches Clerk Bearer token). Falls back to unauthenticated fetch only if services aren't configured yet (e.g. during onboarding).

**Why:** All /api/logo, /api/mockup, /api/photography etc. routes use requireAuth, so raw fetch without auth was 401-ing silently (design generation appeared to work but fell back to mock URIs).
