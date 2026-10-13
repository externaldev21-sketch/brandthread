# Save posts to collections (Instagram 1:1)

## Summary

Item 89: a saved post can be filed into a collection, the way Instagram does it.
1. Save a post in the feed, or in the post viewer.
2. A bar slides up with the post's thumbnail, **Saved**, and **Save to collection**.
3. That action opens the existing "Save to…" sheet: All Saved, your collections, and New collection.
4. Picking a board shows **Saved to <board> · View**. View opens that collection.

Posts in a collection now show their photo, and a board that holds posts gets one as its auto cover.

**Already existed and was extended, not rebuilt**
- `components/SaveToCollectionSheet.tsx` was already generic over `SavedItemType`, but it was only wired for products through `SaveHeartHost`. It is now also opened for posts. The only change to the sheet is that `onSaved` also passes the board's name.
- `components/SaveHeartHost.tsx` and `lib/saved/saveHeartBus.ts` (the app-root Snackbar plus the sheet) gained two toast actions: `save-to-collection` (any item) and `view-collection`. The bar is the existing `components/ui/Snackbar`, which already had a thumbnail slot.
- Server: `PATCH /api/buyer/saved/:targetId` (move into or out of a board) and `POST /api/buyer/saved` with `collectionId` already existed. Both are now covered by tests and hardened (see below).
- `app/buyer-saved.tsx` already rendered post items (image icon, opens the post viewer) and needed no change. `app/buyer-collection.tsx` already opened posts. It only needed the right placeholder icon and the creator line. Thumbnails come from the server now.

## Reference

App: **Instagram iOS**.
- After saving, the post's sheet with **Saved / Private**: https://mobbin.com/screens/a157555b-eb3d-4389-a0f7-1fdecee7899d
- "Saved to art · View" bar after filing into a collection: https://mobbin.com/screens/3317d04e-2aee-4a7a-8011-c91bff870c4c
- Saved collections grid: https://mobbin.com/screens/35d00237-5c0d-4322-afa7-be8472726706
- New collection: https://mobbin.com/screens/b0701508-b538-424d-9c29-0b7d0f60be2f

The reference images are Mobbin's low-res previews. The egress proxy blocks mobbin.com, so I couldn't download the high-res `image_url`.

| Reference (Instagram) | Ours |
|---|---|
| ![](reference/instagram-save-sheet.jpg) | ![](ours/01-feed-saved-bar.png) |
| ![](reference/instagram-new-collection.jpg) | ![](ours/02-save-to-sheet.png) |
| ![](reference/instagram-saved-to-view-bar.jpg) | ![](ours/03-saved-to-collection-view.png) |
| — | ![](ours/04-collection-with-post.png) |
| ![](reference/instagram-saved-collections-grid.jpg) | ![](ours/06-saved-collections-cover.png) |
| — | ![](ours/05-saved-all-with-post.png) |

**Where this differs from Instagram, and why.** Today's Instagram opens a sheet on every save tap. The step that leads into it ("Saved" + "Save to collection") is the bar from Instagram's earlier and current Reels flow, and it is also what the brief asked for. I kept the tap-to-save behaviour and added the bar instead of turning every save tap into a sheet. The existing "Save to…" sheet keeps its list layout rather than Instagram's grid. It is shared with the product save flow, and re-laying it out would restyle that flow too, which the additive-only rule rules out.

## What's new

**Server**
- `lib/savedPostThumbnails.ts` (new): the thumbnail for saved posts, using the same "best still" logic as activity notifications (`postThumbnail`). Only **public, published** posts return one, because the public collection share view uses the same adapter. A post that went private never leaks its image through someone's board.
- `lib/savedItemAdapter.ts`: saved post rows now get `image`. Before this, a post tile was always blank.
- `routes/collections.ts`: a board's auto cover can now come from a saved post, not only from products.
- `routes/saved.ts`: `collectionId` on POST and PATCH must be one of **the caller's own** collections, or the request gets a 404. Before this, any id was written as-is, including another person's board id or a non-uuid. Their board's listing filtered those rows out, so nothing leaked, but it left orphaned filing.

**Mobile**
- `lib/saved/savedPostToast.ts` (new, pure): builds the bar (thumbnail, "Saved", "Save to collection", and the post as a sheet item).
- Saved posts get the bar, the sheet, and then "Saved to <board> · View".
- Products keep exactly the old messages.

## Touches existing UI

- `app/(tabs)/feed.tsx`: 2 imports and 2 lines in `handleSave`. After a successful post save, the bar is emitted on the save-heart bus. Unsave and failures are unchanged.
- `app/buyer-post-viewer.tsx`: 2 imports. The existing `onRemoteSaved` callback of the save button also emits the bar.
- `app/buyer-collection.tsx`: a post tile without a photo shows the `image` glyph instead of `shopping-bag`. A post's creator (`subtitle`) shows in the small label above the title, where the brand goes for products.
- `components/SaveHeartHost.tsx`: the sheet can take a non-product item, and the Snackbar gets `thumbnailUri`. Product messages are unchanged.
- `components/SaveToCollectionSheet.tsx`: `onSaved(collectionId, collectionName?)` now also passes the name. There is no visual change.
- `lib/saved/saveHeartBus.ts`: two new toast action kinds and an optional `thumbnailUri`.

## Feature flags / env keys

None.

## Tests

API (`cd artifacts/api-server && TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/bt_test_save_collections pnpm exec vitest run …`):
- `src/routes/__tests__/saved-posts-collections.integration.test.ts` (new, 6 tests):
  - A saved post gets its thumbnail.
  - PATCH moves the post into your own board; the items, count and auto cover all come from the post.
  - Saving straight into a board works, and so does un-filing back to All.
  - Filing into someone else's board or a non-uuid id is refused, and nothing changes.
  - A non-public post shows no thumbnail.
  - Sign-in is required.
- Re-run unchanged: `collections.integration.test.ts`, `connectivity-commerce-social`, `social-audit-foryou`, `well-known-deep-links`.
- Result: **5 files, 33 tests passed** (6 of them new).

Mobile:
- `pnpm exec vitest run lib/saved/__tests__/savedPostToast.test.ts` covers the bar contents, title fallback, and the thumbnail rule (video poster only, never a local asset). Result: **3 passed**.
- Related existing suites re-run: `components/SaveToCollectionSheet.test.tsx`, `tests/saved-products-store.test.ts`, `tests/quote-post.test.ts`, `tests/captions.test.ts`, `lib/shareLinks.test.ts`, `lib/notificationNavigation.test.ts`, `lib/activity.test.ts` and `tests/social-messaging-routes.test.ts` all pass.
- `tests/a11y-icon-only-lint.test.ts` (1 test) and `tests/no-hardcoded-theme-color-lint.test.ts` (2 tests) fail **on origin/dev too**. None of the files they flag are touched here.

Typecheck: `tsc --noEmit` gives 0 errors in api-server and 0 in mobile.

## Suggestions for Dev

- Long-pressing a post in **Saved → All** still removes it (existing behaviour). The product tiles have an actions sheet with "Move to collection". Giving post tiles the same entry point would let people file posts saved before this PR. I didn't change it, to keep existing gestures as they are.
- The feed's own save in demo or preview posts (non-UUID ids) is local-only and doesn't show the bar, because there is nothing on a server to file.
- Auto covers pick a board's first item in arbitrary order (existing behaviour). Instagram uses the most recently saved one. Ordering the cover query by `created_at DESC` would match it.
