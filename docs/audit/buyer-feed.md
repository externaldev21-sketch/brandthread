# Screen audit 1/10 — Buyer feed, Discover, Search

Branch `claude/audit-buyer-feed`, based on `origin/dev` @ `409ddcdc`.

How this was checked: each route was read in full, then rendered in the repo's
web harness (`scripts/store-screenshots/harness.mjs`: exported preview build,
`?bt_preview=buyer` with and without `&demo=1`, fake Clerk and demo API,
390×844). Failure states were forced by answering the relevant API calls with a
500. Before calling anything "missing", I searched for a route or handler
reaching it and checked for swipe or long-press handlers and `…` menus on the
same surface.

Verdicts: **fixed** means a fix is in this PR. **open** means a real defect left
for a follow-up, with the reason. **clean** means nothing worth filing. Each
screen lists at most 3 items.

---

## 1. Home / Threads feed: `app/(buyer)/index.tsx` → `app/(tabs)/feed.tsx`

- **fixed**: When the first feed load failed (offline or a 5xx), the screen
  showed "No posts yet — Check back soon for new drops", which looks like an
  empty platform and offers no way to retry. It now shows "Couldn't load your
  feed" with a Retry button. This uses the existing `creatorRetry` style, so it
  looks like the creator player's own error state. The forced-500 render was
  checked before and after.
- **fixed (round 2)**: The bundled `FASHION_PREVIEW_POSTS` and their
  first-frame poster were added whenever `__DEV__` was true. Both are now
  gated on `isPreviewDemoMode()` (`?bt_preview=…&demo=1`), latched at mount so
  in-app navigation, which drops the query, doesn't remove them mid-session.
  A fresh account in a dev build now sees the real feed, empty or not. The
  seller feed never received these posts, so it is unchanged. `app/+html.tsx`
  only holds a preload hint and is documented as dead under
  `web.output: "single"`. Verified in render: fresh preview shows only real API
  posts, and `&demo=1` still leads with the seeded posts.

## 2. Buyer feed alias: `app/(buyer)/feed.tsx`

- **clean**: A re-export with `buyerMode` (High Demand page first), kept for
  deep links (`href: null`).

## 3. Buyer tab group: `app/(buyer)/_layout.tsx`

- **clean**: Route registration order matches the bar, and Activity is
  in-navigator. I deliberately made no changes here, because the tab bar's
  look is out of scope.

## 4. Following: `app/(buyer)/following.tsx` → `app/(tabs)/following.tsx`

- **fixed**: The brand avatar chips were unlabelled buttons; VoiceOver only
  read the initials. They now have `accessibilityRole="button"` and an
  "Open drop from {brand}" label.
- **fixed (round 2)**: A failed `/api/public/drops` load now shows an error
  with Retry instead of "No drops yet". Verified: Retry re-fetches.
- **fixed (round 2, data fix)**: Drops are now filtered to followed owners
  (`/api/social/following` user ids against each drop's `ownerId`; both are
  Clerk ids). A viewer who follows nobody, or whose follow list can't be read,
  sees every public drop under "Latest drops", with a neutral empty state. The
  follow-prompt empty copy now appears only in the followed state. Verified in
  render: latest, followed, followed-but-empty and error.

## 5. Discover with filter tabs (For You / Fits / Brands / People / Drops): `app/(buyer)/discover.tsx`

- **fixed**: The bell next to the search bar is labelled "Notifications", but
  it pushed the DM Inbox. It now opens the in-navigator Activity screen
  (`/(buyer)/activity`), which is what the tab bar's own bell opens, so the
  floating tab bar stays mounted.
- **fixed**: The Drops filter's list had `paddingTop` on the whole content
  container, so the header (title, search bar and filter chips) dropped about
  16pt whenever Drops was selected. The spacer now sits below the header.
  Verified in render: the title and chips no longer move between filters.
- **fixed (round 2)**: For You and Fits now have pull-to-refresh (new
  `refreshing`/`onRefresh` props on `DiscoverGrid`). A load where every source
  failed (`composeDiscoverPosts({ throwWhenUnreachable })`) shows "Couldn't
  load posts" with Try again instead of "Nothing to show yet". The Drops filter
  got the same treatment.
- **fixed (round 2)**: Drops rows showed "Brand" with blank thumbnails because
  `composeDiscoverDrops` read `brandName`/`imageUri`, but `/api/public/drops`
  sends `seller.{brandName,displayName}` and `heroImageUrl`. It now maps the
  real fields and hides any row still missing a brand or an image. Verified:
  of three stubbed drops, only the complete one renders.

## 6. Discover full-screen pager: `app/(buyer)/discover-feed.tsx`

- **fixed (round 2)**: The owner approved deleting this orphaned route,
  which nothing navigated to. Its entry is also removed from the ScreenHeader
  migration allowlist, as that file's own rule requires.
  `components/discover/DiscoverPager.tsx` (and its test) is now unused but was
  left in place, because only the route's deletion was approved. A stale
  `'(buyer)/discover-feed'` entry in `components/layout/ScreenChrome.tsx` is
  harmless and was left for the same reason.

## 7. Search with results tabs (For you / Accounts / Products / Tags / Brands): `app/buyer-search.tsx`

- **fixed**: Bundled fake posts and products (`PREVIEW_VIDEOS` and
  `PREVIEW_PRODUCTS`, built from `FASHION_PREVIEW_POSTS`) were mixed into
  results whenever the live API returned nothing for a query, with no
  preview gate at all. That includes production. They now appear only under
  `&demo=1` (`isPreviewDemoMode`). The fictional `PREVIEW_ACCOUNTS` were
  gated on preview only and are now also limited to `demo=1`.
- **fixed (round 2)**: Tapping a post tile opens the creator player on that
  video (`profileVideosHref({ source: 'creator', id: authorId, startPostId,
  exactPost: true })`). Mapping confirmed in the server code: a video result's
  `authorId` is `posts.userId`, the id `/api/public/users/:id/videos` loads,
  and the exact-post check compares against `/api/posts/:id`'s `userId`.
  Verified: the tap lands on `/profile-videos?source=creator&id=…&startPostId=…&exactPost=1`.

## 8. Recent searches: `app/buyer-search-history.tsx`

- **fixed**: The list had no bottom inset, so the last rows sat on the home
  indicator. It now uses `insets.bottom + SPACING.xl`, matching Trending.

## 9. Trending (products / brands): `app/buyer-trending.tsx`

- **fixed**: The error copy said "Could not load trending. Tap to retry." next
  to the inline Retry button (redundant wording). It now reads "Couldn't load
  trending right now."

## 10. Hashtag page: `app/hashtag/[tag].tsx`

- **clean**: The fresh and demo layouts render correctly. In code, the 404,
  error (with retry) and long-tag branches are sound. Follow sends signed-out
  users to sign-in, and demo data is gated on `demo=1`.

## 11. Hashtag share link: `app/tag/[tag].tsx`

- **clean**: Redirect only.

## 12. Location page: `app/location/[placeId].tsx`

- **clean**: Same structure as Hashtag (the fresh and demo layouts were
  rendered). Demo place and posts are gated on `demo=1`, and the error state
  has a retry.

## 13. Place share link: `app/place/[placeId].tsx`

- **clean**: Redirect only.

## 14. Public collection: `app/c/[collectionId].tsx`

- **fixed**: The network-error state's only action was "Open Brandthread",
  which left the page. It now has "Try again", which re-runs the fetch. The
  not-found state keeps "Open Brandthread".
- **fixed**: An empty `ownerName` rendered as "By  · 4 saved" (seen in
  render). The "By …" prefix is now dropped when there is no owner name. Also
  added: `accessibilityRole="button"` on both CTAs, and spacing above "Nothing
  saved here yet."
- **fixed (round 2)**: Tiles are now tappable by `item.type`: product opens
  the PDP (`/product-detail?id=`, the share-link target) and post opens the
  post player (`/buyer-post-viewer?postId=`). The payload has no post author,
  so the creator player can't be used here. Store, collection and unknown
  types stay plain tiles with no button role. Verified: two buttons for three
  tiles, and the product tile opens the PDP.

## 15. Public profile: `app/u/[username].tsx`

- **fixed**: The signed-out landing's `ScrollView` and the loading root both
  had `accessible`. On iOS that collapses every child into one VoiceOver
  element, so "Join Brandthread", "Sign in" and the loading screen's Back
  button could not be reached. I removed both container-level `accessible`
  props. The visible "Loading profile…" text still announces the loading
  state.

## 16. Post share link: `app/p/[postId].tsx`

- **clean**: Redirect only.

## 17. Post / slideshow viewer: `app/buyer-post-viewer.tsx`

- **fixed**: The Like and Comments buttons had no role or label, so VoiceOver
  read only the bare count. They now announce "Like, 12 likes" or "Unlike, …"
  and "Comments, N". "Edit caption" now has a button role.
- **fixed**: Save worked in one direction only. Tapping a saved bookmark did
  nothing (a dead tap). It now toggles, using the existing
  `removeSavedItem`, and the label and state follow it.
- **fixed (round 2)**: Likes on server posts persist through the real like
  API (`api.posts.interact(id, { type: 'like', value: 'add' | 'remove' })`,
  idempotent), with an optimistic update, the server's count applied on
  success, and a rollback on failure. On-device posts (non-UUID ids) keep the
  local store. Verified: a stubbed success shows the server count, and a
  forced 500 rolls back to the original.
  - Remaining limitation (backend): `GET /api/posts/:id` doesn't say whether
    the viewer already liked the post, so a post liked elsewhere opens with an
    empty heart. Tapping it re-adds the like idempotently and the count stays
    correct.
- **fixed (round 2)**: Removed the duplicate share. The header's send icon is
  gone and the action-bar `share-2` stays (TikTok convention).

---

Not covered by this audit, left to their owning shards: `buyer-post-comments`,
`buyer-story-viewer`, and the Inbox, Profile, Cart, Orders, Friends, Activity
and Edit-profile tabs.
