---
name: Buyer Social Architecture
description: socialTypes.ts + socialService.ts service layer and 11 new screens for buyer social features
---

# Buyer Social Architecture

## Rule
`BuyerSocialProfile` and all model types must be imported from `@/services/socialTypes`, not from `@/services/socialService`. The service only exports functions.

**Why:** TypeScript raises TS2459 ("declares locally, but is not exported") if you try to import types from the service file via `type` imports — they were declared in socialTypes and re-exported from socialService implicitly in some older patterns but not here.

**How to apply:** Always `import type { ... } from '@/services/socialTypes'` for models. Use `import { fn } from '@/services/socialService'` for functions.

## Key Patterns

- `ensureSeeded()` runs before every service read — idempotent, AsyncStorage key `bt:social:seeded:v1`
- All keys: `bt:social:{profile|posts|friendships|requests|conversations|messages|stories|notifications|notif-prefs|blocks|mutes|reports|saved|privacy}:v1`
- `feedEligibility` is ALWAYS `'profile_only'` on buyer posts — enforced at write time in `createPost()`
- Conversations are segmented: buyer_to_buyer | buyer_to_seller | buyer_to_seller_product | buyer_to_seller_order
- `isFriendshipActive: false` on a buyer_to_buyer conversation disables new messages

## Screen Inventory

New screens registered in `app/_layout.tsx`:
- `buyer-conversation` — full chat with reactions, reply, delete-for-me, auto-reply simulation
- `buyer-friend-requests` — incoming/sent/suggested tabs
- `buyer-post-create` — photo/slideshow/video, color picker, hashtags, visibility toggle
- `buyer-story-viewer` — progress segments, tap zones, hold-to-pause (PanResponder), reply
- `buyer-story-create` — photo/video/text types, bg color picker, privacy, reply toggle
- `buyer-notifications` — category filter pills, mark-read, delete, clear-read, long-press menu
- `buyer-privacy-settings` — audience pickers, toggles for activity/receipts/search/contact-discovery
- `buyer-saved` — Posts/Products/Collections/Stores tabs, long-press to unsave
- `buyer-blocked` — blocked + muted lists with unblock/unmute
- `buyer-report` — target type grid + reason pills + description + block-after toggle
- `buyer-other-profile` — privacy gate for private accounts, friend request + message actions

## Rebuilt Screens

- `app/(buyer)/profile.tsx` — tabs Posts/Tagged/Reposts/Saved, social stats from service, avatar story ring
- `app/(buyer)/friends.tsx` — live posts from getFriendsPosts(), story row from service, share/like/repost
- `app/(buyer)/inbox.tsx` — segmented (Friends/Sellers/Orders/Requests/Archived), story row, unread badges

## Navigation Entry Points

- Profile bell icon → `/buyer-notifications`
- Profile menu → privacy, notifications, blocked
- Profile avatar → story viewer/creator  
- Profile friends count → `/buyer-friend-requests`
- Inbox bell → `/buyer-notifications`
- More menu on posts → `/buyer-report`
- Other profile Message btn → `buyer-conversation` (friendship check enforced)
