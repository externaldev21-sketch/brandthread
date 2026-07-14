---
name: Inventory System Architecture
description: Brandthread Inventory system — file list, storage keys, single source of truth rules, critical patterns.
---

## Files
- `services/inventoryTypes.ts` — all typed models (17 types), ADJUSTMENT_TYPES, LOCATION_TYPES constants
- `services/inventoryService.ts` — AsyncStorage CRUD; keys: `inv:items:v1`, `inv:locations:v1`, `inv:adjustments:v1`, `inv:events:v1`, `inv:transfers:v1`, `inv:incoming:v1`, `inv:alerts:v1`, `inv:reservations:v1`, `inv:preorders:v1`, `inv:counts:v1`
- `app/inventory.tsx` — 7-tab hub: overview, products, alerts, transfers, incoming, counts, history (full rewrite)
- `app/inventory-detail.tsx` — per-variant detail with adjustments, events, thresholds, recommendations; param: id
- `app/inventory-adjust.tsx` — stock adjustment flow; param: itemId?
- `app/inventory-transfer.tsx` — create/view transfer; param: id?
- `app/inventory-incoming.tsx` — incoming stock management + receive flow; param: id?
- `app/inventory-count.tsx` — inventory count workflow; param: id?
- `app/inventory-location.tsx` — location CRUD (list/add/edit)

## Routes registered in _layout.tsx
inventory, inventory-detail, inventory-adjust, inventory-transfer, inventory-incoming, inventory-count, inventory-location

## Integrations
- `app/(tabs)/more.tsx` — Inventory menu item routes to `/inventory`
- `app/(tabs)/index.tsx` — imports `getInventoryStats`, shows outOfStock/lowStock/incoming counts
- `app/product-detail.tsx` — inventory tab uses `getItemsByProduct` for live stock data

## Single source of truth rules
- ALL inventory quantities live in `inventoryService.ts` (`_items` in-memory + AsyncStorage)
- Never compute available = onHand - reserved in UI code — use `item.available` from the service
- FulfillmentStatus 'ready_to_ship' does NOT exist in the type — use 'partially_fulfilled'
- adjustStock() computes all derived fields (available, status, inventoryValue) automatically
- Alerts are regenerated inside adjustStock() and receiveIncoming() — never compute separately

## Key rules
- No local const that duplicates @/lib/theme exports (Metro Babel crash rule — same as all other systems)
- computeStatus() is internal to service — screens read item.status directly
- History events are immutable — corrections always create new adjustment events
- Do not add incoming units to available until receiveIncoming() is confirmed

**Why:** Same Metro crash pattern as Manufacturer Hub and Orders systems.
