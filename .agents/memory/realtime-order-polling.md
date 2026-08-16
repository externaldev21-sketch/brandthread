---
name: Real-time Order Status Polling
description: How live order status updates are delivered to buyers and sellers without WebSockets.
---

## Rule
Order status updates (paid→processing→shipped→delivered) are delivered via interval polling scoped to screen focus. No WebSockets or SSE needed — the REST stack is sufficient.

## Pattern
All three order screens use `useFocusEffect` (from expo-router) to:
1. Fetch immediately on focus
2. Set up a `setInterval` poll
3. Clear the interval on blur (cleanup function)

```typescript
useFocusEffect(useCallback(() => {
  load();
  const timer = setInterval(load, 15_000); // or 30_000
  return () => clearInterval(timer);
}, [load]));
```

## Intervals
- `buyer-order-detail.tsx` — 15 s (detail screen needs faster updates for tracking)
- `(buyer)/orders.tsx` — 30 s (list screen, lower priority)
- `(tabs)/orders.tsx` (seller) — 30 s

## Seller orders screen — API wiring (migration from mock)
The seller orders screen (`(tabs)/orders.tsx`) was previously backed by in-memory `orderService.getOrders()`.
It now calls `api.orders.list()` and adapts results via `apiRowToOrder()`.

### DB status → UI OrderStatus mapping
| DB value | UI OrderStatus |
|---|---|
| pending | new |
| processing | processing |
| fulfilled | ready_to_ship |
| shipped | shipped |
| cancelled | cancelled |
| refund_pending | refunded |

### Action handler wiring
- `handleMarkProcessing` → `api.orders.updateStatus(id, 'processing')`
- `handleMarkReady` → `api.orders.updateStatus(id, 'fulfilled')` (not 'ready_to_ship')
- Bulk variants follow the same pattern

### Why `fulfilled` not `ready_to_ship`
The API status enum uses 'fulfilled'; the UI OrderStatus uses 'ready_to_ship'. The adapter maps DB→UI. When writing back, always use the DB enum value.
