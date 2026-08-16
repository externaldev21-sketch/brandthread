---
name: Live Shopping Architecture
description: Agora-powered live streaming for sellers — broadcaster, viewer, feed mixing, replay.
---

# Live Shopping Architecture

## Service: Agora Interactive Live Streaming
- Package (mobile): `react-native-agora` (native-only, needs EAS Build)
- Package (api-server): `agora-access-token` for token generation
- Web shim: `artifacts/mobile/shims/react-native-agora.js` → null; Metro aliases it for web platform via `metro.config.js` `resolveRequest` hook

## Database
Two new tables (applied via psql):
- `live_streams` — id, seller_id, channel_name (unique), title, status (pending|live|ended), viewer_count, peak_viewer_count, product_tags (JSONB), started_at, ended_at, replay_url, replay_post_id, agora_uid
- `live_comments` — id, stream_id FK, user_id, display_name, message (max 500 chars), created_at

## API Routes
File: `artifacts/api-server/src/routes/live.ts`, mounted at `/api/live`
- POST `/start` — creates stream, generates Agora host token, returns agoraAppId + token
- GET `/active` — lists live streams for feed mixing
- GET `/:id` — stream details
- POST `/:id/join` — viewer token + increment count
- POST `/:id/leave` — decrement count  
- POST `/:id/end` — marks ended, creates replay post (replay_url may be empty until cloud recording added)
- PATCH `/:id/products` — update tagged products JSONB mid-stream
- POST `/:id/comment` — add comment
- GET `/:id/comments?since=<ts>` — poll latest comments

## Mobile Screens (3 new)
- `artifacts/mobile/app/seller-go-live.tsx` — pre-live setup (title, pick products)
- `artifacts/mobile/app/seller-live.tsx` — broadcast screen (Agora host, comments, product tags, end button)
- `artifacts/mobile/app/buyer-live.tsx` — viewer screen (Agora audience, comments, shop chips)

All screens: try-catch the `require('react-native-agora')` at top; show placeholder on web/Expo Go.

## Feed Integration
`artifacts/mobile/app/(tabs)/feed.tsx`:
- `LiveStreamFeedItem` type with `_isLive: true` discriminant
- `LiveStreamPage` component — full-screen dark card, pulsing LIVE badge, viewer count, seller avatar, join button
- `activeLiveStreams` state — polls `/api/live/active` every 30s
- Mixed into `allItems` at index 4, then every 10 (max 3 live items, regular posts dominant)
- `renderItem` branches on `_isLive` flag → tapping navigates to `/buyer-live?streamId=...`

## Seller Entry Point
`artifacts/mobile/app/(tabs)/studio.tsx` — "Go Live" tool card added before "Create Content"

## Environment Secrets Needed
- `AGORA_APP_ID` — required for any live streaming (from console.agora.io)
- `AGORA_APP_CERTIFICATE` — for secure token generation (from same console)
- For Cloud Recording (replay saves): `AGORA_CUSTOMER_ID` + `AGORA_CUSTOMER_SECRET`

**Why:** Without AGORA_APP_ID, POST /api/live/start returns 503. Token = "" means Agora console must have "No authentication" mode enabled (dev only).

## Incomplete: Cloud Recording
The `replay_url` field exists and the replay post is created on stream end, but the actual recording URL is empty until Agora Cloud Recording REST API is wired in (needs customer ID/secret). Proposed as follow-up task.
