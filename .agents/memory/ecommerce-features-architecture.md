---
name: Ecommerce features architecture
description: 8 seller-side ecommerce features added in migration 014 — discount codes, returns, shipping rates, CSV import, low-stock alerts, post-click analytics, fulfillment timestamps, multi-brand confirmation.
---

## Migration 014 — tables and columns added

**New tables:**
- `discount_codes`: seller_id, code (stored UPPER-CASE), type (percentage|fixed|free_shipping), value, min_order_cents, max_uses, uses_count, expires_at, active
- `returns`: order_id (UUID FK to orders.id), buyer_id, seller_id, reason, resolution_requested, status (pending|approved|denied|refunded), stripe_refund_id, refund_amount_cents, seller_response
- `shipping_rates`: seller_id, name, flat_rate_cents (0 = free), free_above_cents (NULL = never auto-free), active

**New columns on `orders`:**
- `packed_at`, `shipped_at` (TIMESTAMPTZ — fulfillment timestamps)
- `discount_code`, `discount_amount_cents` (denormalized applied discount)
- `source_post_id` (post that triggered the Shop tap — attribution)

## Drizzle schema (lib/db/src/schema/index.ts)
- `discountCodes`, `returns`, `shippingRates` exported tables
- `returns.orderId` is `uuid()` type (FK to orders.id which is UUID)
- `discountCodes.value` uses `numeric()` type (10,2 precision)
- Orders table has all 5 new columns added via `IF NOT EXISTS` in SQL migration

## API routes (all registered in artifacts/api-server/src/routes/index.ts)
- `GET|POST|PATCH|DELETE /api/discount-codes` — seller CRUD
- `GET /api/discount-codes/validate?code=&sellerId=&subtotalCents=` — buyer validates; returns {appliedAmountCents, type, value, description}
- `POST /api/returns` — buyer creates return (order must be in shipped|fulfilled|delivered status; checks for existing non-denied return → 409)
- `GET /api/returns/buyer` — buyer lists their returns
- `GET|PATCH/:id/status /api/returns` — seller lists/approves/denies; approve → Stripe refund via stripe.refunds.create
- `GET|POST|PATCH|DELETE /api/shipping-rates` — seller CRUD
- `GET /api/shipping-rates/calculate?sellerId=&subtotalCents=` — public endpoint (no auth); returns {shippingCents, isFree, rateName}
- `POST /api/products/import` — bulk CSV import (max 100 rows); body: {rows:[{name,price,category,description,sku,images,tags}]}; returns {successCount, failCount, results}

## Low-stock notifications (webhooks.ts)
After Step 6 stock decrement in the Stripe webhook, queries each decremented variant's new stock and inserts a `notifications_feed` row to the seller when `stock <= low_stock_threshold`. Wrapped in try/catch — non-fatal.

## Order ship notification (orders.ts)
`PATCH /api/orders/:id/tracking` now also sets `shipped_at: new Date()` and inserts a buyer push notification into `notifications_feed` with the tracking info. Wrapped in try/catch.

## Shop click tracking (feed.tsx + analytics.ts)
- `handleShop()` in feed.tsx fires `api.posts.interact(item.id, { type: 'shop_click' })` before navigation (fire-and-forget)
- `GET /api/analytics/post-clicks` aggregates interactions table WHERE type = 'shop_click', grouped by post, top 20 by click count

## Mobile service wiring (previously mock → real API)
- `applyDiscount()` in cartService.ts → calls `api.discountCodes.validate()` with AsyncStorage fallback
- `createReturnRequest()` in cartService.ts → calls `api.returns.create()` with AsyncStorage fallback
- `addTracking()` in orderService.ts → calls `api.orders.addTracking()` with AsyncStorage fallback
- `product-import.tsx` → calls `api.products.import()` (manual bulk entry; parses "name | price | category" per line)
- `shipping.tsx` → loads returns from `api.returns.listSeller()`; loads + creates shipping rates via `api.shippingRates.*`
- `api.ts` extended with: `api.discountCodes`, `api.returns`, `api.shippingRates`

## Multi-brand model — confirmed as intended
One seller account = one brand. `owner_id` on all tables scopes everything. No multi-tenant support by design. Each new brand needs a new Clerk account.

**Why:** Brandthread's trust model is brand-to-buyer identity. Multi-brand = separate login.

## Known pre-existing TS errors (not from this work)
`posts.ts` lines 128, 136, 144, 151 — `No overload matches` for interactions insert/eq. Pre-existing before migration 014; posts.ts not modified in this session. Server uses esbuild (not tsc) so these don't block runtime.
