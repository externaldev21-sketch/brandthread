---
name: Seller Dashboard Architecture
description: Full structure of the seller tab system, services layer, and navigation decisions from the Phase 1-3 build.
---

## Tab structure (Home · Studio · Products · Orders · More)

`app/(tabs)/_layout.tsx` defines 5 tabs: `index` (Home), `studio`, `products`, `orders`, `more`.
Hidden (href: null): `feed`, `profile`, `following`, `analytics`, `marketing`, `wishlist`.

- Profile is accessible via More screen → `/(tabs)/profile`.
- Analytics and Marketing are hidden tabs, accessible via More with routes `/(tabs)/analytics` and `/(tabs)/marketing`.
- `app/orders.tsx` (root level) is a redirect shim → `/(tabs)/orders`.

## Services layer

`artifacts/mobile/services/types.ts` — all TypeScript interfaces.
`artifacts/mobile/services/data.ts` — all demo data + helper types (SetupTask, Priority, ActivityItem).

Import pattern: `import { DEMO_PRODUCTS } from '@/services/data'`
Import pattern: `import type { Product } from '@/services/types'`

**Why separate services layer:** UI components stay clean; real API calls slot in without changing screen code.

## Screen inventory built this session

| Screen | Path | Note |
|--------|------|------|
| Studio tab | `(tabs)/studio.tsx` | Creation options 3×3, recent projects, templates |
| Orders tab | `(tabs)/orders.tsx` | Summary strip, filter chips, order cards |
| Dashboard | `(tabs)/index.tsx` | Setup checklist, stat grid, priorities, snapshots, quick actions |
| Products | `(tabs)/products.tsx` | Summary cards, enhanced product cards with metrics |
| More | `(tabs)/more.tsx` | Grouped menu with pro banner and logout |
| Order Detail | `app/order-detail.tsx` | Customer, items, payments, timeline, actions, inline shipping label |
| Add Product | `app/add-product.tsx` | 9-step flow: Basic Info → Media → Pricing → Variants → Inventory → Fulfillment → Sales Model → Visibility → Review |
| Inventory | `app/inventory.tsx` | Summary cards, low-stock alerts, adjustment, history |
| Store Builder | `app/store-builder.tsx` | Overview/Theme/Sections tabs |
| Content | `app/content.tsx` | Create types, library, scheduling, inline create view |
| Product Detail | `app/product-detail.tsx` | 6 tabs: Overview / Variants / Inventory / Orders / Analytics / Content |

## Root layout screen registrations

`app/_layout.tsx` — manually registered (no auto-discovery needed):
`order-detail`, `add-product`, `product-detail`, `inventory`, `store-builder`, `content`,
`notifications-settings`, `help`, `bg-removal`, `tech-pack-generator`

Already registered before: `manufacturer`, `customers`, `payments`, `plans`, `settings`, `shipping`, `team`, `ai-studio`, `design-canvas`, `edit-profile`, `integrations/klaviyo`, `finance`, `community`, `automation`, `website`, `brand`, `ai-assistant`.

## Color system (Seller app)

Primary: `#39FF88` (neon green) — CTA buttons, active states, profit metrics
Accents: `#8B5CF6` (purple), `#3B82F6` (blue), `#06B6D4` (cyan), `#F97316` (orange), `#EF4444` (red), `#FBBF24` (gold)
Dark BG: `#0A0B0A` / Card: `#111311` / Border: `#1E221E` / FG: `#EAF2ED` / Muted: `#5A6B5C`

**Why:** Keep consistent with existing seller app green theme (NOT purple — purple is the buyer app primary).

## Navigation gotchas

- Hidden tab screens (`analytics`, `marketing`) must be navigated to via `/(tabs)/analytics`, NOT `/analytics`.
- `(tabs)/studio` replaces the old `feed` center pill tab slot.
- All new seller push screens open with `animation: 'slide_from_right'`.
- Store Builder uses modal presentation; Add Product is a full push screen.
