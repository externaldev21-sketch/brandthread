---
name: Orders System Architecture
description: Brandthread Orders, Fulfillment, Returns, Refunds, Held Funds & Payouts system — file list, storage keys, critical rules.
---

## Files
- `services/orderTypes.ts` — all typed models (Order, BuyerOrderView, 27 types), DEMO_CARRIER_RATES, PAYOUT_MILESTONES, RETURN_REASONS, CANCELLATION_REASONS, DISPUTE_TYPES
- `services/orderService.ts` — AsyncStorage CRUD; keys: `orders:v1`, `buyer_orders:v1`; seeds 6 demo orders on first run
- `app/(tabs)/orders.tsx` — full seller orders hub (search, filter, sort, bulk actions)
- `app/order-detail.tsx` — 8-tab detail screen (overview, customer, payment, fulfillment, timeline, returns, disputes, notes)
- `app/shipping-label.tsx` — carrier rate selection + demo label purchase; params: orderId, groupId?
- `app/return-detail.tsx` — return lifecycle; params: orderId, returnId
- `app/refund-detail.tsx` — refund flow; params: orderId, returnId?
- `app/dispute-detail.tsx` — dispute evidence submission; params: orderId, disputeId
- `app/(buyer)/orders.tsx` — buyer order list (full rewrite)
- `app/buyer-order-detail.tsx` — buyer-facing order details; params: id

## Routes registered in _layout.tsx
order-detail, shipping-label, return-detail, refund-detail, dispute-detail, buyer-order-detail

## Seller home integration
`getOrderStats()` imported in `app/(tabs)/index.tsx` — shows newOrders, readyToShip, returnRequests, disputes counts.

## Key rules
- FulfillmentStatus values: unfulfilled | partially_fulfilled | fulfilled | manufacturer_pending | returned | cancelled — does NOT include 'ready_to_ship'
- All demo actions are labelled with "(demo)" in the UI — no real payment/shipping/refund claims
- No local const that duplicates @/lib/theme exports (Metro Babel crash rule)
- Buyer screens never show held funds, internal notes, or seller-only data

**Why:** Same Metro crash pattern as Manufacturer Hub — theme const redeclarations cause Babel "Duplicate declaration" at runtime even when TS compiles clean.
