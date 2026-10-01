# Create flow (capture → gallery → edit → post)

Rebuilt on TikTok's post-creation flow (THREAD) and Instagram's "Creating a post" flow (POST).
Route: `/create-post` (Seller Studio "Create post", the seller create FAB, profile empty states and the
Story camera's POST tab all land here). Source: `app/create-post.tsx` (controller) and
`components/create-post/*`.

## Modes (the swipeable bar at the bottom of capture)

| Mode | Who | What it is | Slides | Ratio |
| --- | --- | --- | --- | --- |
| STORY | everyone | hands off to the existing story flow (`/buyer-story-create`) | – | 9:16 |
| THREAD | sellers only | product videos / photo slideshows for the Threads feed (`posts.surface = 'thread'`) | up to **30** photos (or one video up to 10 min) | 1:1 · 3:4 · 9:16, chosen per post |
| POST | sellers + buyers | Instagram-style carousel on the author's profile grid (`posts.surface = 'profile'`) | up to **14**, photos *and* videos mixed | fixed **3:4** |
| LIVE | sellers (last item) | hands off to the existing Go Live (`/seller-go-live`) | – | – |

Buyers see STORY · POST. A buyer can never create a Thread: the UI has no THREAD mode **and** the server answers
`403 BUYER_NO_THREADS` (`POST /api/posts`, `PATCH /api/posts/:id`).

**Caps are in one file per side** (one-line change): `artifacts/mobile/constants/postLimits.ts`
(`MAX_SLIDES_BY_MODE`) and `artifacts/api-server/src/lib/postLimits.ts` (`MAX_SLIDES_BY_SURFACE`, what the
server actually enforces). There is no 10-slide cap anywhere.

## Screens

1. **Capture** (native; web opens the picker directly, `?capture=1` opts a browser with a camera in): full-bleed
   camera, X, flip / flash / timer rail, duration pills 10s · 15s · 30s · 1m · 10m · Photo, record button, "Upload"
   thumbnail, mode bar.
2. **Picker** – THREAD: TikTok grid (All / Videos / Photos, numbered circles, tray with hold-drag reorder and ×,
   Clear / Next). POST: Instagram picker (3:4 preview you can pan/pinch right there, Recents, select-multiple toggle,
   numbered picks, camera tile). Over the cap the extra pick is blocked with a message.
3. **Edit** – THREAD photos: frame with corner marks + thirds grid, per-slide drag/pinch crop, filmstrip (tap to jump,
   hold-drag to reorder), aspect row, Delete / Next. THREAD video: trim handles. POST: carousel editor (slides with
   neighbours peeking, dots, Reset), per-slide pinch/drag crop with a grid while dragging, **Filter** (8 looks),
   **Edit** (Brightness, Contrast, Structure, Warmth, Saturation, Fade, Vignette) with **Apply to all slides**, **Trim**
   for video slides, "+" to add more.
4. **Post** – caption with #hashtags / @mentions (existing mention search), cover picker (THREAD), Tag products
   (existing product tagging, sellers), audience, more options (comments / reposts / like count), schedule (sellers),
   Drafts / Post (THREAD) or Share (POST, with a Save-draft prompt on back).

## Uploads

- Photos: `POST /api/posts/photo-slides` (cropped on-device, orientation-safe).
- Videos: **chunked + resumable** — `POST /api/posts/uploads` → `PUT …/chunks/:n` (8 MB, 2 in flight, retried with
  backoff) → `GET …/uploads/:id` (resume) → `POST …/complete`. Progress is bytes actually sent. Up to 1 GB / 10 min.
- POST carousels: `POST /api/posts/compose-carousel` crops, trims, applies the look and scales every slide to
  1080×1440 (photos → JPEG, videos → H.264) with a poster each; `POST /api/posts` then stores `slides` (kind, stable
  URLs) with `surface: 'profile'`.
- Migration `114_post_surface.sql` adds `posts.surface` (existing seller posts stay `thread`, buyer posts → `profile`)
  and `posts.slides`.

## Where things show

- Threads feed / For You / trending only read `surface = 'thread'`.
- Profile grids render at **3:4** with a carousel badge; tapping a POST opens `buyer-post-viewer`, which renders the
  3:4 carousel with dots, swipe (arrows on web) and muted autoplay video. Threads still open the feed player.
- A buyer's POST is readable by the buyer and mutual friends only (`GET /api/posts/:id` gates it).

## Verifying

```
# unit + integration (needs TEST_DATABASE_URL)
pnpm --filter @workspace/mobile exec vitest run lib/createPost
pnpm --filter @workspace/api-server exec vitest run src/routes/__tests__/post-carousel src/lib/__tests__/carouselAdjust

# screens at 393x852 + TEXT-FIT & ALIGNMENT pass
node scripts/store-screenshots/create-flow-verify.mjs <mediaDir> <outDir> [--role buyer] [--skip-build]
node scripts/store-screenshots/post-carousel-profile-verify.mjs <mediaDir> <outDir> --role buyer
BASE_URL=http://127.0.0.1:8081 pnpm exec playwright test -c e2e/playwright.config.ts e2e/create-flow.spec.ts
```

`scripts/store-screenshots/text-fit.mjs` flags truncated/ellipsised text, text overflowing its box, labels cut by the
screen edge, <12px button padding, off-centre button text and unequal buttons in a row. Screenshots, zoomed
button-group crops and Mobbin side-by-sides: `docs/polish/screenshots/create-flow/`.
