---
name: Social System Architecture
description: Buyer social, messaging, stories, notifications, privacy, and saved content system built in the mobile app.
---

# Buyer Social System Architecture

## Service Layer
- `services/socialTypes.ts` — all typed models (BuyerSocialProfile, BuyerPost, Friendship, FriendRequest, FriendSuggestion, Conversation, Message, Story, Notification, NotificationPreference, BlockRecord, MuteRecord, Report, SavedItem, PrivacySettings, ProfileSearchResult)
- `services/socialService.ts` — all CRUD functions with AsyncStorage persistence

**AsyncStorage key prefix:** `bt:social:*:v1`

**Seeded demo data:** 5 friends (Maya/Jordan/Amir/Sofia/Kai), 2 incoming requests, 4 suggestions, 5 conversations, 3 stories, 15 notifications, 4 saved items, 3 own posts. Seeded once via `bt:social:seeded:v1` flag.

**Critical rules:**
- `feedEligibility: 'profile_only'` enforced at write time in `createPost()` — buyer posts NEVER enter Thread
- Buyer-to-buyer messaging gated behind accepted friendship (`canMessage()`)
- Stories expire after 24h (`expiresAt = createdAt + 24*3600*1000`), filtered in `loadStories()`
- `subscribeSocial()` returns unsubscribe fn — use in `useEffect` cleanup across all screens

**Why:** Centralized service layer ensures feedEligibility is always enforced at write time, not at read/display time.

## Screen Inventory (all in `artifacts/mobile/app/`)

### Rebuilt tabs (buyer)
- `(buyer)/profile.tsx` — own profile with Posts/Tagged/Reposts/Saved tabs, privacy badge, real stats
- `(buyer)/friends.tsx` — stories row + friend activity feed (DEMO_FRIEND_POSTS) + friend list horizontal scroll
- `(buyer)/inbox.tsx` — messaging hub: All/Friends/Sellers/Orders/Requests/Archived segments, stories row at top

### New screens (registered in `app/_layout.tsx`)
- `buyer-conversation.tsx` — full chat thread; params: id OR participantId+type+context
- `buyer-other-profile.tsx` — other buyer profile; params: userId, name, handle, initials, color
- `buyer-post-create.tsx` — post creation modal; enforces feedEligibility='profile_only'
- `buyer-friend-requests.tsx` — Incoming/Sent/Suggested tabs
- `buyer-story-viewer.tsx` — full-screen story viewer; params: storyId, allStoryIds (comma-sep)
- `buyer-story-create.tsx` — story creation modal
- `buyer-notifications.tsx` — notifications hub with category filter pills
- `buyer-privacy-settings.tsx` — all PrivacySettings fields
- `buyer-saved.tsx` — Posts/Products/Collections/Stores tabs; params: none
- `buyer-blocked.tsx` — Blocked/Muted tabs; params: tab? ('blocked'|'muted')
- `buyer-report.tsx` — report flow; params: targetType, targetId, targetLabel, targetUserId?

## Route Registration
All new social routes registered in `app/_layout.tsx` under "Buyer social screens" comment block (after "Buyer commerce screens").

## Key Demo User IDs
- My user: `MY_USER_ID = 'me'`, `MY_COLOR = '#8B5CF6'`
- Friends: u_maya, u_jordan, u_amir, u_sofia, u_kai
- Sellers: u_vault (Vault Studio), u_meridian (Meridian Co.), u_nxgen (NxGen Drops)
- Demo conversations: conv_maya, conv_kai, conv_vault, conv_order, conv_seller_req
