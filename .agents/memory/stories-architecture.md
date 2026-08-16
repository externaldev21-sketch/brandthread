---
name: Stories Architecture
description: Full Instagram/TikTok-style stories — what existed vs. what was built, overlay types, multi-slide reel, seller access
---

## What Already Existed Before This Session

### Backend (social.ts lines 248-410)
- `stories`, `story_likes`, `story_views` DB tables (schema/index.ts lines 472-506)
- 5 endpoints: POST /stories (create, 24h expiry), GET /stories/me, GET /stories/user/:userId (ALL auth viewers — non-follower visible), POST /stories/:id/like (toggle), POST /stories/:id/view
- `buildStoryView()` helper returns likesCount, viewsCount, likedByMe

### Mobile — What Was Already Working
- `buyer-story-viewer.tsx` — full viewer: progress bars per slide, timed auto-advance, multi-slide support, like (optimistic + server), reply input, viewer modal, swipe-down dismiss, product tags
- `friends.tsx`, `inbox.tsx` — story row with create/view navigation and viewed rings
- `buyer profile.tsx` — active story ring on avatar, myStories fetch
- `buyer-other-profile.tsx`, `seller-profile.tsx` — already wired to storiesForUser (non-followers can view)
- `story-creator.tsx` — advanced editor: photo picker, draggable text, Giphy GIF search, music catalog
- `story-picker.tsx` — camera roll browser routes to story-creator
- `api.ts` — 5 story methods: createStory, myStories, storiesForUser, likeStory, viewStory
- socialService.ts — local AsyncStorage story CRUD + demo seeds
- socialTypes.ts — Story/StoryMedia/StoryPrivacySettings types

## What Was Built (Gaps Filled)

### 1. StoryMedia overlay type (socialTypes.ts)
- Added `StoryOverlay` interface: type ('link'|'gif'|'text'), x/y position, linkUrl/linkText, gifUrl/gifW/gifH, text/color/size
- Added `overlays?: StoryOverlay[]` to StoryMedia
- Added `imageUri?: string` to StoryMedia for local photo/video URIs

### 2. buyer-story-create.tsx — Real media picking (was "Coming soon")
- Photo: ImagePicker multi-select (up to 10) → each photo = one slide in a story reel
- Video: ImagePicker with `videoMaxDuration: 15` cap, shows duration in preview
- Shows actual Image component preview for photos
- Multi-photo strip below canvas when multiple selected
- "Open advanced editor" button routes to story-creator with chosen media
- Now calls server (api.social.createStory) + local store

### 3. story-creator.tsx — Link overlay panel + server save
- Added 4th toolbar button: link icon → 'link' panel
- Link panel: URL input (auto-prefixes https://), button label input
- Draggable link sticker on canvas (purple pill), long-press to remove
- `handlePost()` now builds full StoryMedia with overlays array, calls createStory + api.social.createStory (fire-and-forget)
- `params.accountType` passed through to mark buyer/seller on the story

### 4. buyer-story-viewer.tsx — Overlay rendering
- Photo stories: renders actual Image from imageUri (if present)
- Link overlays: tappable purple pills, calls Linking.openURL
- GIF overlays: positioned Image components
- Text overlays: positioned View with text

### 5. Seller story creation — (tabs)/profile.tsx
- Loads myStories() on mount; detects active (non-expired) stories
- Avatar shows purple gradient ring when seller has active stories
- Tap avatar → if has stories, go to viewer; if not, go to story-picker
- "+" badge (bottom-left of avatar) always navigates to /story-picker?accountType=seller

### 6. story-picker.tsx — Passes accountType
- Reads `accountType` param, passes to story-creator params
- So seller-created stories are tagged `authorAccountType: 'seller'`

## Architecture Rules
- Non-follower visibility: already enforced in backend (GET /stories/user/:userId has no follow check)
- 24h expiry: enforced at DB insert (`expiresAt = now + 24h`)
- Multi-slide: `media` is a JSON array; each element is one timed slide; viewer progress bars per element
- 15s video cap: `videoMaxDuration: 15` in ImagePicker options
- Photo/video imageUri is device-local; for cross-device sharing, would need object storage upload step
- Local store (socialService AsyncStorage) is primary source of truth; server sync is fire-and-forget

## Story Overlay Render Order (viewer)
1. Base: backgroundColor fill or imageUri image
2. Overlays array: link pills (tappable, purple), GIF images (positioned), text overlays (positioned)
3. All overlays z-index 8 (below progress bars at z-index 10, above base at z-index default)
