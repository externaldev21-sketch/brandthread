# Hashtags

Hashtag pages, trending tags, tag search and tag follows.

## Data model

| Table | Purpose |
| --- | --- |
| `posts.hashtags` (json `string[]`) | Source of truth written by clients. Now stored **normalised** and merged with `#tags` found in the caption. |
| `post_hashtags (post_id, tag, created_at)` | Index of the tags on posts. PK `(post_id, tag)`, FK to `posts` with `ON DELETE CASCADE`, index `(tag, created_at desc)` and a `text_pattern_ops` index for prefix search. `created_at` copies the post's `created_at`. |
| `hashtag_follows (user_id, tag, created_at)` | Tags a user follows. PK `(user_id, tag)`. |

Migration `121_hashtags.sql` creates both tables and idempotently backfills `post_hashtags` from the legacy `posts.hashtags` json (strip `#`, NFKC, lowercase, `\w` only, 30 chars, 30 tags per post). Tags that only appear inside old captions are not backfilled; they are indexed the next time the post is edited.

Post status is **not** mirrored into the index. Every read joins `posts` and applies `publicPostCondition()` (published or due-scheduled, public, moderation `visible`, author not suspended/deleted), so archiving, deleting, holding or removing a post takes it off tag pages immediately.

## Normalisation (`api-server/src/lib/hashtags.ts`)

* strip leading `#`, NFKC, lowercase;
* keep unicode letters/marks, digits and `_`; everything else is dropped;
* max 30 characters per tag, max 30 distinct tags per post, first occurrence wins;
* `extractHashtagsFromCaption` finds `#tag` tokens in captions (not mid-word, not after `&`, `#` or `/`, never purely numeric such as `#1`).

`POST /api/posts` and `PATCH /api/posts/:id` (additive, no payload change): the stored `hashtags` array is `normalise(hashtags) + tags in caption`. On PATCH it is recomputed whenever `caption` or `hashtags` is sent, using the existing value for the one that is not. The index is re-synced in the same transaction (PATCH) or right after the insert (POST; a sync failure is logged and does not fail the post).

## Moderation

Tags for which `evaluateContent(tag, "public")` does not return `allow` are treated as nonexistent: `GET/POST /:tag…` returns 404, and they never appear in trending, search or following. Posts whose caption or tags are rejected/held are already blocked/hidden by the existing post pipeline.

## Endpoints (`/api/hashtags`)

Public endpoints identify the viewer with `optionalViewerId`; posts by authors the viewer has a block with (either direction) are excluded, and viewer muted words hide matching posts/tags.

### `GET /api/hashtags/:tag?sort=top|recent&limit=`
```json
{ "tag": "ootd", "postCount": 128, "followerCount": 9, "isFollowing": false, "sort": "top",
  "posts": { "items": [ /* post tile, see below */ ], "nextCursor": "…" | null } }
```
`:tag` is normalised (`#OOTD` works). A valid tag with no posts returns `postCount: 0` and empty items.

### `GET /api/hashtags/:tag/posts?sort=top|recent&cursor=&limit=`
`{ "tag", "sort", "items": [...], "nextCursor" }`. `limit` default 30, max 50. `recent` uses a keyset cursor, `top` an offset cursor (ordered by likes + 2·reposts + 2·visible comments, then recency).

Post tile:
```json
{ "id": "uuid", "mediaType": "photo|video|slideshow", "mediaUrl": "", "mediaUrls": [], "thumbnailUrl": null,
  "aspectRatio": "9:16", "caption": "", "hashtags": [], "createdAt": "",
  "likesCount": 12 /* null when the author hides like counts */, "commentsCount": 3,
  "author": { "userId": "", "name": "", "handle": "@x", "avatarUrl": null, "accountType": "buyer|seller" } }
```

### `GET /api/hashtags/trending?limit=` (default 10, max 20)
`{ "tags": [{ "tag", "rank", "postCount", "recentPostCount", "score" }] }`

Score = `(3 × posts in the last 72h + engagement on those posts) × velocity`, where engagement = likes + 2·reposts + 2·comments and velocity = `(recent+1)/(previous 72h+1)` mapped to a factor clamped to 0.5–1.5. A tag needs at least 3 recent posts from at least 2 distinct authors. Moderated tags are excluded. The global list is cached in process for 5 minutes (per-viewer muted words are applied after the cache); `Cache-Control: public, max-age=60`. Trending is aggregate and is not block-filtered per viewer; tag pages are.

### `GET /api/hashtags/search?q=&limit=`
Prefix search over tags that have at least one public post, most used first. `{ "tags": [{ "tag", "postCount" }] }`.

### Follows (auth required)
* `POST /api/hashtags/:tag/follow` → `{ tag, isFollowing: true }` (idempotent, max 500 per user, 409 `HASHTAG_FOLLOW_LIMIT`)
* `DELETE /api/hashtags/:tag/follow` → `{ tag, isFollowing: false }`
* `GET /api/hashtags/following` → `{ tags: [{ tag, postCount, followedAt }] }`

## Mobile

* `app/hashtag/[tag].tsx` — hashtag page: `#tag` title, post count, Follow, Top/Recent tabs, 3-column `ProfileVideoTile` grid. Tiles open `buyer-post-viewer` (which now falls back to the public `GET /api/posts/:id` for posts by people the viewer is not friends with).
* `components/social/CaptionText.tsx` — `CaptionSpans` (drop inside an existing `<Text>`) and `CaptionText`; `#tags` become links to `/hashtag/<tag>`. Used in `buyer-post-viewer` and `components/buyer-feed/CaptionBlock.tsx`. Captions without a tag render exactly as before.
* `components/search/TrendingTags.tsx` — "Trending" chip row at the top of the search screen's focused empty state. Search's Tags tab now merges server tag search with caption-derived tags, and its rows open the hashtag page.
* `lib/api.ts` — `api.hashtags.{trending, search, page, posts, follow, unfollow, following}`.
* Preview: no network calls; fresh preview shows the empty state, `&demo=1` fills the grid from the bundled demo posts and shows sample trending chips.

## Not done / limits

* Follows are stored and exposed, but following a tag does not yet feed For You or send notifications.
* `posts.hashtags` for posts created before this change is only normalised the next time the post is edited (the index itself is backfilled).
* Trending is computed in-process per API instance (5 minute cache); fine for one instance, each instance recomputes otherwise.
