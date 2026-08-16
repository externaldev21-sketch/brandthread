---
name: Messaging / Cart / Search / Notifications Architecture
description: DB schema, API routes, and mobile wiring for DM conversations, server-side cart, saved items, notification feed, and real search — added in migration 007.
---

## Migration 007 (applied)
File: `lib/db/migrations/007_messaging_search_cart_notifications.sql`
Tables added: conversations, conversation_participants (composite PK), messages, saved_items, cart_items, notifications_feed

## Drizzle schema
`lib/db/src/schema/index.ts` — 6 new pgTable exports, `primaryKey` added to pg-core import.

## API routes

| Route file | Mount point | Auth |
|---|---|---|
| conversations.ts | /api/conversations | requireAuth |
| saved.ts | /api/buyer/saved | requireAuth |
| cart-db.ts | /api/buyer/cart | requireAuth |
| notifications-feed.ts | /api/buyer/notifications | requireAuth |
| public.ts (GET /search) | /api/public/search | public |

**Route order in index.ts matters**: /buyer/saved, /buyer/cart, /buyer/notifications are mounted BEFORE /buyer to avoid being swallowed by the catch-all buyerRouter.

## Conversation API design
- POST /api/conversations — dedupe by (participants × type × contextOrderId), creates or returns existing
- Participant display info (name, handle, initials, color) stored in conversation_participants at creation time (snapshot model)
- Unread counts incremented on message send via SQL `unread_count + 1`

## Cart sync model
Full-replace: POST /api/buyer/cart/sync deletes all user rows then re-inserts. item_data JSONB stores full CartItem object so no product join needed on load. AsyncStorage is primary source of truth; DB is best-effort durability.

## Search endpoint
GET /api/public/search?q=&limit=20 — queries products (ILIKE on name) + users (ILIKE on displayName/brandName, accountType='seller'). Returns { results: SearchResult[] } in same shape as searchData.ts (kind='brand'|'product'). hashColor derives deterministic palette color from clerkId. Returns brands first, then products.

## Mobile wiring
- socialService.ts: 13 serviceRequest calls for conversations, messages, notifications, saved. All wrapped in try/catch with DEMO_* fallback. sendMessage is optimistic (local status='sending', background API call).
- cartService.ts: syncToDb() fires-and-forgets after every AsyncStorage write. loadCart() attempts GET /api/buyer/cart on start and merges if DB has data.
- search.tsx: useEffect + 300ms debounce, plain fetch to /api/public/search, searchCatalogue fallback, handleResultPress navigates to seller-profile or buyer-product-detail, ActivityIndicator while fetching.

**Why:**
- serviceRequest takes (path, RequestInit) in cartService.ts (adapted from the (path, method, body) spec)
- The notifications-feed router default export is the buyerRouter; publishNotification is a named export for use by other routes
