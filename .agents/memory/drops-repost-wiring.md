---
name: Drops & Repost wiring
description: What was already in the DB vs built for drops countdown, drop product catalog, and repost interactions.
---

## Schema state (no migration needed)
- `drops.release_at` — already in DB as `timestamp with time zone` (nullable)
- `products.drop_id` — FK to drops.id already in DB with `ON DELETE SET NULL`
- `interactions.type` — free-text column; 'repost' was already a valid value in posts.ts route

## Backend changes
- `GET /api/public/drops/:id` — updated to also return `products` array (active products where `drop_id = drop.id`, up to 50)
- `GET /api/public/drops` — unchanged; already returns `releaseAt` per drop

## Mobile changes

### following.tsx (rewritten)
- Loads real drops via `api.publicDrops.list()` (`GET /api/public/drops`)
- Countdown hook (`useCountdown`) ticks every 1s using `releaseAt`
- Cards show "Upcoming" vs "Live" vs "Live Now" badge based on `releaseAt` vs `Date.now()`
- Falls back to MOCK_BRANDS array if API returns no drops (new sellers, dev environment)
- "View Drop" / "Shop Drop" buttons push to `/buyer-drop-detail?dropId=...`

### buyer-drop-detail.tsx (new screen)
- Route: `/buyer-drop-detail?dropId=&dropName=` (registered in _layout.tsx)
- Fetches drop via `api.publicDrops.get(dropId)` — includes products in same response
- `CountdownBlock` component: full days/hours/minutes/seconds countdown to releaseAt; switches to "Live Now" badge when past releaseAt; shows nothing if no releaseAt
- Product grid: `ProductCard` components, tap → `/buyer-product-detail?productId=`
- Empty state if no products linked to drop yet

### feed.tsx — interactions wired
- `handleLike` → `api.posts.interact(id, { type: 'like' })` fire-and-forget
- `handleDoubleTapLike` → same
- `handleRepost` → `api.posts.interact(id, { type: 'repost' })` fire-and-forget
- `handleSave` → reads current `saved` state from `setEngagements` prev, calls `api.saved.add` or `api.saved.remove` accordingly; demo post IDs silently ignored server-side

## Key decisions
- Fire-and-forget with `.catch(() => {})` everywhere in feed — feed responsiveness > network consistency; server just ignores unknown demo IDs
- `useCountdown` interval cleanup is in useEffect cleanup to avoid memory leaks across multiple card instances
- `products` are fetched in same `GET /api/public/drops/:id` call (one round-trip) rather than separate endpoint
