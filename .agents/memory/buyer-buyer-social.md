---
name: Buyer-to-buyer social graph
description: Follow system, DM, and search for buyer-to-buyer connections — DB schema, API routes, mobile screens
---

## Follow model
One-way follows (Instagram-style). Mutual follows = "friends" in UI labels.
No approval required — all public accounts.
`follows` table: `follower_id TEXT, following_id TEXT, created_at TIMESTAMP` (PK on both columns).

**Why:** User explicitly asked for "follow" not "friend request". Existing "Add Friend" UI was purely local AsyncStorage.

## API routes (all require Clerk auth)
All mounted at `/api/social/*` in routes/index.ts.
- `POST   /api/social/follow`             — follow `{ userId }`; 409 if self-follow; 404 if user not found
- `DELETE /api/social/follow/:userId`     — unfollow
- `GET    /api/social/status/:userId`     — `{ isFollowing, isFollowedBy, isMutual }`
- `GET    /api/social/profile/:userId`    — profile + follower/following counts + relationship flags
- `GET    /api/social/following`          — list users I follow (with display metadata)
- `GET    /api/social/followers`          — list followers (with `isFollowingBack` flag)
- `GET    /api/social/search?q=&limit=`  — search buyers by name/username/displayName (requires `q.length >= 1`)

## Mobile API client
`api.social.follow/unfollow/status/profile/following/followers/search` — all in api.ts social namespace.

## Mobile screens wired
- `buyer-other-profile.tsx`: loads real profile on mount; Follow/Following/Follow Back/Friends button states; Message button ALWAYS visible (not gated on friendship); real follower/following counts.
- `friends.tsx`: calls `api.social.following()` on load; shows "Following" horizontal scroll row with real DB follows above Friend Activity feed; Message button on each.
- `buyer-friend-requests.tsx`: renamed "Connections"; Incoming tab = real followers where !isFollowingBack; Sent tab = real following where they don't follow back (cross-referenced); Suggested tab keeps local demo; Accept = api.social.follow; Cancel = api.social.unfollow.
- `search.tsx (buyer)`: people search added — fetches `api.social.search(q)` in parallel with brands API; shows PEOPLE section above BRANDS & DROPS; "Following" badge on already-followed users; taps navigate to buyer-other-profile.

## How to apply
- For new buyers: userId in route params must be a real Clerk ID for API calls to work. Demo user IDs (starting with `u_`) skip the API gracefully.
- DM is open to any buyer — `createOrGetConversation({ type: 'buyer_to_buyer', ... })` was already unrestricted in the conversations API.
- DB migration: 010_follows.sql (applied).
