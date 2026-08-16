---
name: Messaging safety architecture
description: Content moderation, server-side blocks, and follow-based message requests added to Brandthread DMs
---

## Migration 012

```sql
blocks (blocker_id TEXT, blocked_id TEXT, created_at TIMESTAMP)  -- composite PK
conversations.is_request BOOLEAN DEFAULT FALSE
conversations.requested_by TEXT  -- Clerk userId who initiated the request
```

## Content moderation

`artifacts/api-server/src/lib/contentModerator.ts`

- `moderateMessage(text): { blocked, category?, reason? }`
- Categories: `harassment` | `spam_scam` | `explicit_sexual` | `hate_speech`
- Casual profanity is NOT blocked — only genuinely harmful content
- Applied in `POST /api/conversations/:id/messages` → returns HTTP 422 + `code: "MODERATED"`

## Blocks (DB-enforced)

API routes in `artifacts/api-server/src/routes/social.ts`:
- `POST /api/social/block` — insert blocks row; removes mutual follows
- `DELETE /api/social/block/:userId` — remove block
- `GET /api/social/blocks` — list my blocks (derives initials from display name; **users table has NO initials/color columns**)

Enforcement:
- `POST /api/conversations` — checks `blocks` before creating (403 BLOCKED)
- `POST /api/conversations/:id/messages` — checks if any recipient has blocked sender (403 BLOCKED)
- `POST /api/social/follow` — checks if target has blocked follower (403 BLOCKED)
- `GET /api/social/profile/:userId` — returns 404 if viewer is blocked by target; returns `iBlockedThem: boolean`

## Message requests (follow-based)

Logic in `POST /api/conversations`:
- For `buyer_to_buyer` type only: if recipient does NOT follow sender → `is_request = true`, `requested_by = sender`
- `buildConversationView` now uses `conv.isRequest` from DB (not derived from type)

New routes:
- `PATCH /api/conversations/:id/accept` — sets `is_request = false, requested_by = null`; only the non-requester can accept
- `DELETE /api/conversations/:id` — hard-delete (cascade removes participants + messages); used for decline

## Mobile API client additions (api.ts)

```typescript
api.conversations.accept(id)   // PATCH /:id/accept
api.conversations.decline(id)  // DELETE /:id
api.social.block(userId)       // POST /api/social/block
api.social.unblock(userId)     // DELETE /api/social/block/:userId
api.social.blocks()            // GET /api/social/blocks
api.social.profile() now returns iBlockedThem: boolean
```

## Mobile screens updated

- `(buyer)/inbox.tsx` — Requests tab shows Accept/Decline card (not openable until accepted); uses useApi()
- `buyer-blocked.tsx` — blocked list now loaded from API (not local AsyncStorage); unblock calls API
- `buyer-other-profile.tsx` — block/unblock toggle calls API; more sheet shows "Unblock" when iBlockedThem

## Key gotcha

`users` table has NO `initials` or `color` columns. These live on `conversation_participants`. Derive initials from display name in GET /blocks route.
