# Locations

Location tags on posts, location pages and a reusable picker.

## Data model

| Table / column | Purpose |
| --- | --- |
| `places` | `id`, `name`, `normalized_name`, `city/region/country` (nullable), `lat/lng` (nullable numeric), `dedupe_key`, `provider` + `provider_place_id` (Google), `created_by`, `created_at`. |
| `posts.place_id` | Nullable uuid FK to `places(id)`, `ON DELETE SET NULL`. Partial index `(place_id, created_at desc)`. |

Post counts are never cached; they are computed from `posts.place_id` with `publicPostCondition()`.

**Duplicate merging.** `dedupe_key` is unique: normalised name (NFKC, lowercase, punctuation/whitespace collapsed) plus coordinates rounded to 2 decimals (about 1 km) when known, otherwise name + region + country. `provider_place_id` is also unique when present. `POST /api/places` and the `location` field on posts find-or-create, so "Union Square" at nearly the same coordinates always resolves to one place; the same name in another city stays separate.

Migration: `122_places.sql` (idempotent). Drizzle: `lib/db/src/schema/places.ts`, plus `posts.placeId` in `schema/index.ts`.

## Env key

`GOOGLE_PLACES_API_KEY` (server only, optional). Create it in Google Cloud Console: enable **Places API (New)** for a project, then APIs & Services > Credentials > Create API key, restricted to the Places API and to the server's IP. Without the key the feature is feature-flagged off: `/search` returns existing places only (`providerEnabled: false`), nothing crashes, and manual "Add <name>" still works. With the key, `/search` also returns Places Autocomplete suggestions (`source: "google"`, no `id`), and saving one calls Place Details server-side to fill coordinates, city, region and country. Provider calls have a 4 second timeout and failures are swallowed.

## Endpoints (`/api/places`)

### `GET /api/places/search?q=&lat=&lng=`
Public. `{ "places": [Result], "providerEnabled": boolean }`, up to 15 results.
```json
{ "id": "uuid", "name": "Café de Flore", "city": "Paris", "region": null, "country": "France",
  "lat": 48.854, "lng": 2.333, "source": "local", "postCount": 128 }
{ "name": "Zeta Gallery", "source": "google", "postCount": 0, "providerPlaceId": "ChIJ...", "secondary": "Paris, France" }
```
Local matches are prefix or word-prefix matches on the normalised name, most used first, then nearest if `lat/lng` are sent. Provider suggestions that already exist locally are dropped. A suggestion without `id` must be saved with `POST /api/places` (send its `providerPlaceId` and `name`) before use.

### `GET /api/places/:id?sort=top|recent&limit=`
Public. `{ "place": {id,name,city,region,country,lat,lng}, "postCount": 12, "sort": "top", "posts": { "items": [tile], "nextCursor": null } }`. 404 for unknown ids.

### `GET /api/places/:id/posts?sort=top|recent&cursor=&limit=`
Public. `{ placeId, sort, items, nextCursor }`, limit default 30, max 50. Only public-visibility posts (published/due, public, moderation `visible`, author in good standing), blocks in either direction hidden, viewer muted words applied. `recent` uses a keyset cursor, `top` an offset cursor (likes + 2 reposts + 2 comments). Tile shape is the same as `/api/hashtags/:tag/posts`.

### `POST /api/places` (auth)
Body `{ name, lat?, lng?, city?, region?, country?, providerPlaceId? }`. `lat`/`lng` come together and in range; name 1-100 characters, `evaluateContent(name, "public")` must allow it (422 `CONTENT_REJECTED` otherwise). Returns `201 { place, created: true }` or `200 { place, created: false }` when merged into an existing place.

## Posts

`POST /api/posts` and `PATCH /api/posts/:id` accept, additively and optionally:

```jsonc
{ "placeId": "uuid" }            // existing place
{ "placeId": null }              // PATCH only: clear
{ "location": { "placeId": "uuid" } }
{ "location": { "name": "Café de Flore", "lat": 48.854, "lng": 2.333, "city": "Paris", "country": "France", "providerPlaceId": "ChIJ..." } }  // find-or-create
{ "location": null }             // PATCH only: clear
```
Unknown `placeId` is a 400 `PLACE_NOT_FOUND`; a rejected name is a 422. Omit both fields to leave the location unchanged.

Post payloads now include `placeId` and `location: { id, name } | null`, resolved with one batched query per page, on: `POST /api/posts`, `PATCH /api/posts/:id`, `GET /api/posts/:id`, `/api/posts/mine`-style lists, `GET /api/posts/feed`, `GET /api/public/posts`, and the buyer `BuyerPost` shape from `/api/social/...` (so `buyer-post-viewer` can show it).

### For the create-flow session
`create-post.tsx` (not edited here) has an unwired `location` string state. To wire it:
1. Render `<LocationPicker value={selected} onSelect={setSelected} onClear={() => setSelected(null)} />` (see below).
2. Send `placeId: selected.id` in the create/patch body (or `location: { name, lat, lng }` if you collected raw coordinates).

## Mobile

* `app/location/[placeId].tsx` — location page: pin badge, name, city/region/country, post count, Top/Recent tabs, 3-column `ProfileVideoTile` grid; tiles open `buyer-post-viewer`. Layout reference: Instagram's location page (Mobbin), reskinned monochrome and without a map.
* `components/social/LocationTag.tsx` — pin + name line, tappable, opens the location page. Shown by `buyer-post-viewer` under the caption when `post.location` exists. `locationHref(placeId)` is exported.
* `components/social/LocationPicker.tsx` — props `{ value?, onSelect(place), onClear?, coords?, placeholder?, autoFocus?, style? }`. Debounced search against `/api/places/search`; picking a provider suggestion or the "Add <name>" row saves it first, so `onSelect` always receives a place with an `id`. Drop it into any screen or sheet.
* `lib/api.ts` — `api.places.{search, page, posts, save}` and the `PlaceInfo`, `PlaceSearchResult`, `PlacePage`, `PlacePostsPage` types.
* `_layout.tsx` — `location` is guest-allowed (public data).
* Preview: no network calls; fresh preview shows the empty state, `&demo=1` shows demo data.

## Not done

* Story location sticker: stickers only carry a free-text `locationLabel` ("Add location") and `buyer-story-viewer` does not render them yet, so there is nothing to make tappable without touching the story editor/viewer owned by another session. `StoryOverlay.locationPlaceId` (optional) is added to the type so the story flow can store a resolved place later.
* No map (location page is deliberately map-less) and no "nearby places" browsing.
