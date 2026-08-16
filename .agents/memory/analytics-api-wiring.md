---
name: Analytics service API wiring
description: How analyticsService.ts calls real API endpoints with demo fallback.
---

## Pattern
Each function wraps its real API call in try/catch; on any error it falls through to the existing demo data block. The `serviceRequest()` helper from `lib/serviceConfig.ts` handles auth.

## Endpoints used
- `getOverview` → `GET /api/analytics/dashboard` — returns `{ revenue: { monthCents }, orders: { total }, customers: { total }, payouts: { preOrderHeldCents, preMadeAvailableCents } }`
- `getSalesAnalytics` → `GET /api/analytics/revenue?period=last30` — returns `{ totalCents, orderCount, daily: [{ day, total_cents }] }`
- `getProductAnalytics` → `GET /api/analytics/products` — returns array of `{ productId, name, revenueCents, unitsSold, inventoryStatus }`

## Remaining gaps
Only these three functions have real data. All other analytics (customers, content, store, marketing, inventory, production, profit, payout) still return demo data — no server-side aggregations exist for them yet.

## Migration 005
`push_tokens` and `seller_quote_requests` tables added via `lib/db/migrations/005_push_tokens_quote_requests.sql`. Note: `manufacturer_id` on `seller_quote_requests` is `UUID` (matches `manufacturers.id`), not TEXT.
