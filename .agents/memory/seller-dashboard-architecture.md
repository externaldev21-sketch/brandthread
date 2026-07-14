---
name: Seller Dashboard Architecture
description: Seller-side screen inventory, color system, service layer, and navigation patterns for Brandthread mobile app.
---

## Seller design tokens
- BG `#0A0B0A`, CARD `#111311`, BORDER `#1E221E`, FG `#EAF2ED`, MUTED `#5A6B5C`
- GREEN `#39FF88` (primary seller accent), PURPLE `#8B5CF6`, BLUE `#3B82F6`, ORANGE `#F97316`, CYAN `#06B6D4`
- Note: seller screens use GREEN as primary, NOT purple (purple is buyer/onboarding)

## Tab layout (seller)
`(tabs)/` group: Home (index) · Studio · Products · Orders · More
- Profile tab is `(tabs)/profile.tsx` — "My Brand" dashboard (not public profile)
- Public brand profile is a separate route: `app/seller-profile.tsx`

## Services layer (`artifacts/mobile/services/`)
- `types.ts` — All entity interfaces: Product, Order, SellerProfile, SellerPost, Sound, PostAnalytics, PostOverlay, PostProductTag, PostHashtag, PostVisibility, SlideshowEdit, VideoEdit, VideoClip, PostMedia, BeatMarker, SoundSelection, etc.
- `data.ts` — DEMO_PRODUCTS, DEMO_ORDERS, DEMO_CONTENT, DEMO_ANALYTICS, etc.
- `sellerContent.ts` — DEMO_SELLER_PROFILE, DEMO_SELLER_POSTS, DEMO_SOUNDS, DEMO_PRODUCTS_FOR_TAG, SUGGESTED_HASHTAGS, getSellerPosts(), getPostById(), getPostAnalytics(), getThreadEligiblePosts()

## Screen inventory (seller-specific)
- `(tabs)/index.tsx` — Seller home/dashboard
- `(tabs)/profile.tsx` — "My Brand" dashboard (avatar, stats, quick actions, content grid)
- `(tabs)/studio.tsx` — Design studio
- `(tabs)/products.tsx` — Product list
- `(tabs)/orders.tsx` — Orders
- `(tabs)/more.tsx` — More menu
- `seller-profile.tsx` — PUBLIC brand profile (buyers see this; sellers see with isOwner=true param)
- `create-post.tsx` — Full content creation flow (10 steps: type-select → video/slide flow → post details → publishing → done)
- `post-analytics.tsx` — Per-post analytics with animated charts
- `content.tsx` — Content management hub (routes to create-post for creation)
- `edit-profile.tsx` — Edit seller brand profile
- `brand.tsx` — AI Brand Creation tool (name generator, logo AI, checklist) — NOT the public profile

## Navigation entry points
- Seller Quick Actions bar in `(tabs)/profile.tsx`: "Create Post" → `/create-post`, "My Profile" → `/seller-profile?isOwner=true`
- Content hub "Create" button and type cards → `/create-post?type=xxx`
- Thread feed: tapping creator avatar or name → `/seller-profile?id=xxx`
- Action sheet in seller-profile: "View analytics" → `/post-analytics?id=xxx`, "Edit" → `/create-post?editId=xxx`

## Thread eligibility rule
`getThreadEligiblePosts()` in sellerContent.ts filters: status=published + isSellerContent=true + scheduled date ≤ now.
Buyer posts must NEVER appear in Thread. Only SellerPost entities with `isSellerContent: true` are eligible.

## Navigation gotchas
- `router.back()` triggers GO_BACK warning in dev when no stack history exists — dev-only, not a crash.
- `SpotlightPage` in feed.tsx is a function component; needs its own `useRouter()` call (does not inherit from parent).
- Route groups: `/(tabs)/` for seller, `/(buyer)/` for buyer — do not mix them.
- `_layout.tsx` Stack.Screen entries: seller-profile (slide_from_right), create-post (fullScreenModal from bottom), post-analytics (slide_from_right).

## Key type notes
- `SellerPost.isSellerContent: true` — literal type, always true, enforces Thread eligibility at type level.
- `PostStatus` includes 'failed' and 'archived' (beyond old ContentStatus 'draft'|'scheduled'|'published').
- Video always `aspectRatio: '9:16'` — never prompt seller to choose video ratio.
- Slideshows: 9:16 | 3:4 | 1:1 — user selects in slide-ratio step.
- Video max durations: 10 | 15 | 30 | 60 seconds (MaxVideoDuration union).

**Why:** Seller content system added July 2026. Keeping these patterns consistent prevents route mismatches and Thread contamination bugs.
