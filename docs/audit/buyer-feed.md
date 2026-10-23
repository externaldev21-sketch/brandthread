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
- **open**: The bundled `FASHION_PREVIEW_POSTS` are added whenever `__DEV__`
  is true (`feed.tsx` ~2456 and ~2600), not only under `&demo=1`. Dev builds
  therefore show seeded videos to a "fresh" account. This is left open because
  the gate is shared with the seller feed and the first-frame poster in
  `app/+html.tsx`, so changing it is more than a one-line change.

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
- **open**: A failed `/api/public/drops` load is swallowed (`.catch(() => {})`)
  and shows as "No drops yet". It needs an error state with a retry.
- **open**: The screen says it shows drops from sellers you follow, and the
  empty copy says "Follow sellers to see their latest drops here". It actually
  loads all public drops, with no follow filter. Either the data or the copy
  needs to change, and that is a product decision.

## 5. Discover with filter tabs (For You / Fits / Brands / People / Drops): `app/(buyer)/discover.tsx`

- **fixed**: The bell next to the search bar is labelled "Notifications", but
  it pushed the DM Inbox. It now opens the in-navigator Activity screen
  (`/(buyer)/activity`), which is what the tab bar's own bell opens, so the
  floating tab bar stays mounted.
- **fixed**: The Drops filter's list had `paddingTop` on the whole content
  container, so the header (title, search bar and filter chips) dropped about
  16pt whenever Drops was selected. The spacer now sits below the header.
  Verified in render: the title and chips no longer move between filters.
- **open**: The For You and Fits grids have no pull-to-refresh
  (`DiscoverGrid` takes no refresh props), while Brands, People and Drops do.
  `composeDiscoverPosts` also swallows network errors, so a failed load shows
  "Nothing to show yet" instead of an error. Fixing this means adding props to
  `components/discover/DiscoverGrid.tsx`, which is outside these routes.
  - Related: Drops rows show the placeholder subtitle "Brand" and blank
    thumbnails when the API omits `brandName` or an image
    (`lib/discoverFeed.ts:293`, `'Brand'` fallback). This shows up in the demo
    render.

## 6. Discover full-screen pager: `app/(buyer)/discover-feed.tsx`

- **open**: This route is orphaned. Its header comment says Discover pushes
  `/(buyer)/discover-feed` from a "For You" full-screen entry point, but
  nothing in `app/`, `components/` or `lib/` navigates there. I checked for
  string routes, `useThreadPull().push`, swipe handlers and the safety `…`
  menu. It is also not registered in `(buyer)/_layout.tsx`. Either wire up the
  entry point or delete the route.

## 7. Search with results tabs (For you / Accounts / Products / Tags / Brands): `app/buyer-search.tsx`

- **fixed**: Bundled fake posts and products (`PREVIEW_VIDEOS` and
  `PREVIEW_PRODUCTS`, built from `FASHION_PREVIEW_POSTS`) were mixed into
  results whenever the live API returned nothing for a query, with no
  preview gate at all. That includes production. They now appear only under
  `&demo=1` (`isPreviewDemoMode`). The fictional `PREVIEW_ACCOUNTS` were
  gated on preview only and are now also limited to `demo=1`.
- **open**: A post tile in results is labelled "Play video by X", but tapping
  it opens the author's profile (`/buyer-other-profile?userId=…&postId=…`),
  and that screen ignores `postId`. The tapped post never opens. The right
  target is the creator player (`profileVideosHref({ source: 'creator', id,
  startPostId, exactPost: true })`, as in `buyer-recently-watched.tsx`). That
  needs confirmation that a search result's `authorId` is the id the creator
  player expects, so it is left open.

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
- **open**: The item tiles are not tappable (plain `View`s with no long-press
  either). A visitor can't open a saved product from a shared collection.
  Routing depends on `item.type`, so this is left open.

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
- **open**: Liking someone else's post isn't persisted. `likePost` only flips
  posts in the viewer's own local list, so the heart and count reset when the
  viewer reopens. A second open item: there are two share buttons, the
  header's send icon and `share-2` in the action bar.

---

Not covered by this audit, left to their owning shards: `buyer-post-comments`,
`buyer-story-viewer`, and the Inbox, Profile, Cart, Orders, Friends, Activity
and Edit-profile tabs.
