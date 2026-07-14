---
name: Content Publishing Architecture
description: End-to-end seller post creation → Thread delivery flow; storage keys, type expansion, feed integration.
---

## Core flow
Seller creates post in `create-post.tsx` → calls `createSellerPost()` in `socialService.ts` → saves to `bt:social:seller-posts:v1` → Buyer Thread (`feed.tsx`) loads via `getThreadPosts()` + `subscribeSocial()` → shows at top of feed → buyer taps SHOP → `/buyer-product-detail?productId=...`

## SellerThreadPost (socialService.ts)
Expanded from a thin 14-field type to a full 30+ field type including:
- `authorAccountType: 'seller'`, `sellerId`, `brandId`, `feedEligibility: 'thread_eligible'`
- `mediaUris: string[]`, `thumbnailUri?`, `aspectRatio: '9:16'|'3:4'|'1:1'`
- `postStatus: 'draft'|'scheduled'|'published'|'archived'|'deleted'`
- `isDraft`, `isArchived`, `isDeleted` (all three kept for backwards compat with profile.tsx filters)
- `sound?: SellerPostSound`, `productTags: SellerPostProductTag[]`, `visibility`
- `publishedAt?`, `likesCount`, `commentsCount`, `repostsCount`, `savedCount`, `likedByMe`, `savedByMe`, `repostedByMe`

## Storage keys
- `bt:social:seller-posts:v1` — all seller posts (drafts + published + archived)
- `bt:social:seller-posts:seeded:v1` — boolean, marks seed data applied (one-time)

## Seed data (3 demo published posts)
Drop Society, FORM Studio, Midnight Thread — seeded on first `getSellerPosts()` call if store empty.

## CRUD API
- `createSellerPost(params)` — full params: contentType, caption, hashtags, mediaUris, aspectRatio, productTags, sound, visibility, isDraft, scheduledAt
- `updateSellerPost(id, patch)` — update any subset of mutable fields
- `archiveSellerPost(id)` / `deleteSellerPost(id)` — soft-delete pattern via updateSellerPost
- `likeSellerPost(id)` / `saveSellerPost(id)` — toggle + count
- `getSellerPosts()` — all posts (for seller profile, filtered locally by tab)
- `getThreadPosts()` — only `postStatus === 'published' && !isDraft && !isArchived && !isDeleted && schedule passed`

## feed.tsx (Buyer Thread)
- `mapSellerPost(post: SellerThreadPost): SpotlightItem` — converts service post to feed display format
- Loads from `getThreadPosts()` in useEffect; subscribes to `subscribeSocial()` for live updates
- `allItems = useMemo(() => [...sellerFeedPosts, ...SPOTLIGHT_ITEMS.filter(s => !sellerFeedPosts.some(sp => sp.id === s.id))])`
- Real seller posts appear first; SPOTLIGHT_ITEMS fill remainder (IDs don't collide)
- `handleShop(item)` reads `(item as any).productId ?? item.id` — works for both demo and real posts

## create-post.tsx changes
- Design tokens updated: removed `GREEN`, `PURPLE = '#7C3AED'` is now primary, `BG/CARD/BORDER/MUTED` match Brandthread theme
- Gradient buttons: `[PURPLE, '#6D28D9']` instead of `[GREEN, '#20C060']`
- Button text/icons: `'#FFFFFF'` on purple backgrounds (was `'#0A0B0A'`)
- `createSellerPost()` calls now pass: `mediaUris`, `aspectRatio`, `productTags` (full objects), `sound`, `visibility`

## profile.tsx (Seller Profile)
- Still filters by `isDraft` / `isArchived` fields (kept in new type) — no changes needed
- "Posts" tab: `!isDraft && !isArchived`; "Drafts": `isDraft && !isArchived`; "Scheduled": `!isDraft && !isArchived && !!scheduledAt`

## What's NOT built yet
- Draft update pattern (createSellerPost always creates new; no draftId state)
- Variant picker in product tag modal (only productId/name/price stored)
- Video duration validation before publish
- Archive/delete UI on seller profile post grid
- Scheduled posts time-gating (stored correctly but no scheduler)
- Seller profile navigation from Thread (tapping seller avatar navigates but uses wrong id format)
