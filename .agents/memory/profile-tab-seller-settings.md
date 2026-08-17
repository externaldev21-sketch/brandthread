---
name: Profile Tab + Seller Settings
description: Profile is now the 5th tab (replaced More); all settings/tools live in a stack screen; dashboard has hero card + trend chart + real orders.
---

## Tab bar change
- `app/(tabs)/_layout.tsx` TABS array: `more` → `profile` (icon: `user`)
- `<Tabs.Screen name="profile">` is now visible; `<Tabs.Screen name="more" options={{ href: null }}>` is hidden
- `more.tsx` still exists and is accessible at `/(tabs)/more` if navigated to programmatically

## Seller Settings screen
- `app/seller-settings.tsx` — new stack screen (expo-router auto-routes it at `/seller-settings`)
- Contains all 6 section groups from old More tab (Store, Design Studio, Operations, Growth, Money, Account) + sign-out
- Profile gear icon (`profile.tsx` headerIcons) now navigates to `/seller-settings` instead of `/settings`
- `app/(tabs)/profile.tsx` — openSettings handler navigates to `/seller-settings`

## Dashboard hero card
- `api.finance.balance()` → `{ available: { formatted }, pending, nextPayout: { formatted, estimatedArrival, estimated_arrival }, connected }`
- Hero card uses `LinearGradient` with colors `['#1E0A3C', '#5B21B6', '#0C4A6E']`
- Handles null (loading), no Stripe (connected: false), and real balance states
- `payoutInfo` state is `null` while loading; shows `'· · ·'` balance during load

## 7-day trend chart
- `api.analytics.revenue('last7')` → `{ daily: [{ day: string, total_cents: number }] }`
- View-based bar chart (no external library); MAX_BAR = 50px; today's bar highlighted in CYAN
- `salesTrend` state: `null` = loading (skeleton), `[]` = no data, populated = renders bars

## Recent orders (real data)
- `api.orders.list()` → array, sliced to 3
- Handles both camelCase (`totalCents`, `customerName`) and snake_case (`total_cents`) formats
- `recentOrders` null = loading, [] = no orders yet (shows empty state card)

## COMMAND_ITEMS routes fixed
- Inventory → `/inventory`
- Store Builder → `/store-builder`
- Settings → `/seller-settings` (was `/(tabs)/more`)

**Why:** More tab became redundant once Profile became the primary identity surface. Settings moved to stack nav for proper back-button UX.
