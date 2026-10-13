# Close Friends for top buyers (Instagram 1:1)

## Summary

Item 84, "Close Friends for top buyers". Sellers now have their own Close Friends screen. Its first suggestions are the seller's top buyers by spend, and the seller can add a top buyer even when that buyer doesn't follow them.

**What already existed and was extended (not rebuilt)**
- `close_friends` table (`lib/db/src/schema/storyHighlights.ts`). No schema change and no migration.
- `routes/close-friends.ts`: `GET/PUT /api/social/close-friends`, capped at 500, members had to be in the follow graph. Extended with a paid-buyer rule for sellers and a new `/suggestions` endpoint.
- `lib/storyAccess.ts`: the Close Friends audience gate. Extended so a list member who doesn't follow the author can still reach that author's CF stories.
- `app/buyer-close-friends.tsx`: **not changed**, and its buyer look is unchanged. It can't serve the Instagram sectioned layout ("Your list (N)" / suggestions / Done) without restyling it, so the seller screen is a new file. The seller screen reuses the buyer screen's visual language: `ListRow` people rows, the same round star radio, and a sticky bottom CTA.
- Top-buyer ranking reuses the `GET /api/analytics/customers` logic: group orders by buyer, sum `total_cents`, exclude cancelled orders. This PR also requires `paid_at IS NOT NULL`, which is the same paid-order predicate `lib/discountLookups.ts` uses. A suggestion therefore always passes the server's add rule.

## Reference

Flow: Close Friends list. App: **Instagram (iOS)**.
- Close Friends list: https://mobbin.com/screens/e7a3f368-06ec-41dc-9239-58f4697897bb
- Suggested section pattern: https://mobbin.com/screens/8284105b-3d95-4cde-b8d6-a80ca938170f
- Close friend toggle (green star): https://mobbin.com/screens/5a8da308-55ba-403e-84fb-27ff7b96240f

Copied from Instagram:
- The "We don't send notifications…" line
- Search
- "N people" count with "Clear all" on the right, shown here as "Your list (N)"
- Suggestion rows: avatar, name and username, with a round toggle on the right
- Rows stay where they are while you toggle
- One full-width **Done** that saves

Reskinned to black/white/silver. The checked circle is the buyer screen's white star radio rather than Instagram's green star.

| Instagram | Brandthread |
|---|---|
| ![](reference/instagram-close-friends-list.jpg) | ![](ours/02-list-and-top-buyers.png) |
| ![](reference/instagram-suggested-section.jpg) | ![](ours/03-top-buyers-added.png) |
| ![](reference/instagram-close-friend-toggle.jpg) | ![](ours/04-search.png) |
| Entry point | ![](ours/01-seller-settings-entry.png) |
| Empty (new seller) | ![](ours/05-empty.png) |

The Mobbin full-resolution download was blocked by the sandbox proxy, so the reference images are Mobbin's preview images.

## What's new

### Server (`artifacts/api-server`)
- **`GET /api/social/close-friends/suggestions?limit=25`** (max 50). Sellers only (`accountType` is `seller` or `both`); everyone else gets 403 `SELLER_ONLY`.
  - Returns the seller's buyers ranked by spend, then by most recent order.
  - A buyer is included only if they have an account and a paid, non-cancelled order with this seller.
  - Excluded: guests, anyone blocked either way, deleted, deletion-requested or suspended accounts, anyone already on the list, and the seller themself.
  - Each item: `{ userId, name, handle, initials, avatarUrl, orderCount, totalCents, followsYou }`.
- **`PUT /api/social/close-friends`**:
  - A requested id is now allowed if it is in the follow graph **or** has a paid, non-cancelled order where the caller is the seller. This is checked server-side against `orders`, so a client can't add a stranger.
  - Self, blocked, deleted and suspended accounts are still refused and returned in `rejected`.
  - The rules live in a new pure module, `src/lib/closeFriendsRules.ts`.
- **Contract fix**: the router now also accepts `{ friendIds }` and adds `friendIds`, `ok` and `skipped` to its responses.
  - The mobile `api.closeFriends` client (used by `buyer-close-friends.tsx`) sends and reads `friendIds`, but `close-friends.ts` is mounted first and only understood `userIds`.
  - As a result the buyer screen's server save always returned 400 ("Couldn't save"), and its GET read `undefined`. This change fixes that without touching the buyer screen.
- **Story access (`lib/storyAccess.ts` + `routes/social.ts`)**:
  - New `followGateAllows` and `closeFriendOfAuthorIds`.
  - `GET /stories/user/:id` and the `GET /stories/following` tray now let a Close Friends list member who doesn't follow the author see that author's **Close Friends stories only**. That author's follower-only public stories stay hidden from them.
  - Without this, a top buyer added without following would never see the seller's CF stories, because those endpoints required a follow first.
  - Removing the buyer from the list removes the access. The `audienceAllows` behaviour is unchanged.

### Mobile (`artifacts/mobile`)
- `app/seller-close-friends.tsx` (new screen):
  - Standard `ScreenHeader` (back arrow + title), the Instagram note line, `SearchBar`.
  - Sections: **Your list (N)** with *Clear all*, **Suggested: your top buyers**, **Followers**.
  - `StickyBottomCTA` **Done**. If the server refuses anyone, Done shows an alert and keeps the screen open.
  - Done sits above the floating seller tab bar through the existing scene clearance in `_layout.tsx`.
- `services/closeFriendsService.ts` (new): uses `serviceRequest`.
  - The signed-out seller preview never calls the API: `?demo=1` returns fixtures and the fresh preview returns empty lists.
  - Unit tests in `services/closeFriendsService.test.ts`.
- `scripts/f6-close-friends-screenshots.mjs`: verification screenshots at 390x844.

## Touches existing UI
- `artifacts/mobile/services/settingsCatalog.ts`: **one row added** to seller Settings › Privacy & safety: "Close Friends" (star icon), which opens `/seller-close-friends`. Nothing else moved. See `ours/01-seller-settings-entry.png`.
- `artifacts/mobile/app/_layout.tsx`: one `Stack.Screen name="seller-close-friends"` line next to `buyer-close-friends`. No visual change.
- `artifacts/mobile/scripts/audit/route-ownership.json`: one ownership entry.
- `app/buyer-close-friends.tsx`: unchanged.

## Feature flags / env keys
None. No new keys and no third-party services.

## Tests
- API, `cd artifacts/api-server && TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/bt_test_close_friends pnpm exec vitest run <files>`:
  - New `src/lib/closeFriendsRules.test.ts` (unit).
  - New `src/routes/__tests__/close-friends-top-buyers.integration.test.ts` (10 tests) covers:
    - seller-only 403
    - ranking, plus exclusion of unpaid, cancelled, blocked, deleted and guest orders
    - `limit`, and per-seller isolation
    - PUT accepts a non-following paid buyer and rejects strangers, unpaid, cancelled, blocked and deleted ids
    - listed buyers drop out of suggestions
    - the `{friendIds}` contract
    - an added non-following buyer gets the CF story through `/stories/user/:id` and the tray, but not the seller's public stories
    - removing the buyer revokes access
  - Re-run and passing: `close-friends-highlights`, `social-stories`, `story-stickers`, `ugc-safety`, `analyticsCustomers`. 74 tests passed.
  - Two failures in other suites that this PR doesn't touch: `follow-requests.test.ts` > "replaces the whole list" (its mocked `close_friends` insert expects `ownerId` where drizzle now uses `userId`) and `media-moderation.integration.test.ts` > "rejects clear violations" (a priority assertion). Neither suite touches code changed here; I couldn't re-run them against untouched `origin/dev` in this sandbox.
- `pnpm exec tsc -p tsconfig.json --noEmit`: 0 errors in both api-server and mobile, after `pnpm run typecheck:libs`.
- Mobile full vitest compared with `origin/dev`: identical FAIL lists. Baseline: 72 files / 88 tests failing. This branch: 72 files / 88 tests failing, plus 5 new passing tests. Zero new failures.

## Suggestions for Dev
- `routes/follow-requests.ts` also defines `GET/PUT /social/close-friends` with a `{friendIds}` contract, but `close-friends.ts` is mounted first, so that handler is never reached. Consider deleting the duplicate and moving `lib/api.ts`'s `closeFriends` client to `{userIds}`. This PR only made the live router accept both shapes.
- `GET /stories/:id` (single-story deep link) still requires following. A non-following close friend opens CF stories from the tray or the profile ring, not from a shared deep link. It is left unchanged to keep the access change small.
- If a buyer's paid order is later refunded or cancelled, they stay on the list, as on Instagram, where nobody is removed automatically. They just can't be re-added unless they follow.
- Not added: a "Close Friends" header action on `analytics-customers.tsx`. The single settings row was the smallest change; a header action there is a one-liner if wanted.
