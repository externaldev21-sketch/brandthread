# Product mentions in captions + Behind-the-scenes posts

## Summary

Covers F6 items **86** (clickable product mentions in captions) and **78** (seller "Studio" behind-the-scenes posts).

- **86 Product mentions.** A seller can link product names in a caption to their own products. In the feed, the linked name is bold, and tapping it opens the existing Shop product sheet straight on that product.
- **78 Behind the scenes.** A seller can mark a Thread or post as "Behind the scenes", using one switch in the composer's More options. The feed then shows a text-only "Behind the scenes" line between the brand name and the caption. The composer also accepts `?bts=1` to open with the switch on, ready for a Studio entry point (see Suggestions for Dev). `GET /api/posts?label=bts&sellerId=…` lists a seller's BTS posts for a future profile filter. No profile screens were changed.

What already existed and was extended rather than rebuilt:
- `CaptionSpans` / `CaptionText` (#hashtag linking) can now also link product mentions. Without mentions the output is the same as before.
- The feed's `onShopTag` → `ShopProductSheet` is reused for mention taps. No new product surface was added.
- The composer's `SubPage` + search-list pattern (as in "Tag products") is reused for the picker. `getTaggableProducts()` supplies the seller's products.
- Post reads add the data in the same places `taggedProducts` and the quote data are attached. `attachPostExtras` chains right after `attachQuoteData`.

## Reference

One app for every flow here: **TikTok** (iOS). The feed is TikTok-style, and so is the composer ("# Hashtags / @ Mention" chips and option rows).

| Flow | TikTok (Mobbin) | Ours |
|---|---|---|
| Composer: option rows under the caption | [screen](https://mobbin.com/screens/1e479fc2-d7c7-4de3-bb14-938ca319937e) (flow: [Adding a location](https://mobbin.com/flows/e97b3da3-7c6f-4b70-af44-1369bf39cc68)) <br>![](reference/tiktok-composer-mention-chip.webp) | ![](ours/03-composer-mention-a-product-row.png) |
| Picker: full-page search list, tap to insert | [screen](https://mobbin.com/screens/577d78e6-e110-4d5d-bf04-02f440659bf3) <br>![](reference/tiktok-search-list-picker.webp) | ![](ours/04-composer-product-picker.png) ![](ours/05-composer-caption-with-mention.png) |
| Caption: linked tokens rendered bold inline | [screen](https://mobbin.com/screens/fabe6f09-2925-4afe-9d42-2ed0091e0f43) <br>![](reference/tiktok-caption-linked-tokens.webp) | ![](ours/01-feed-bts-label-and-product-mention.png) |
| Label line under the creator name ("Commission paid") | [screen](https://mobbin.com/screens/f33fee80-53e2-4935-9d77-872575f09037) <br>![](reference/tiktok-label-under-name.webp) | ![](ours/01-feed-bts-label-and-product-mention.png) |
| Tap mention → product | (TikTok Shop opens the product page) | ![](ours/02-feed-tap-mention-opens-product-sheet.png) |
| BTS switch | (no Mobbin counterpart; the switch sits with the existing More options toggles) | ![](ours/06-composer-behind-the-scenes-switch.png) |

The reference images are Mobbin's preview renders. The proxy blocked downloading the full-resolution `image_url`.

## What's new

### Server
- New schema file `lib/db/src/schema/postMentionsLabels.ts`, exported right after `./captions` in `schema/index.ts`.
  - `post_product_mentions(id, post_id → posts, product_id → products, label, position, created_at)`. It has a unique key on (post_id, product_id).
  - `post_labels(post_id → posts, label CHECK IN ('bts'), created_at)`. The primary key is (post_id, label).
- Migration `lib/db/migrations/300_f6_mentions-bts.sql` (idempotent `IF NOT EXISTS`, FKs `ON DELETE CASCADE`).
- `artifacts/api-server/src/lib/productMentions.ts` holds the pure input rules: at most 10 mentions, the label must appear verbatim in the caption, one mention per product, and order follows the caption.
- `artifacts/api-server/src/lib/postExtras.ts`: `attachPostExtras(items)` adds `productMentions[{productId,label,position,name,images,priceCents}]` and `labels[]`. It uses 3 queries per page. Mentions only show while the product is `active` and not deleted.
- `artifacts/api-server/src/routes/post-mentions-labels.ts` is mounted on `/posts` next to the captions router. It uses per-route team context, so no extra lookup is added to other `/posts` requests.
  - `PUT /api/posts/:id/product-mentions {mentions:[{productId,label}]}` is author only and replaces the set (an empty array clears it). Every product must be the author's own, `active` and not deleted. Otherwise the call returns 400 `PRODUCT_NOT_MENTIONABLE` with `rejected[]`. A label missing from the caption returns 400 `LABEL_NOT_IN_CAPTION`.
  - `PUT /api/posts/:id/labels {bts:boolean}` is author only and seller only (403 `SELLER_ONLY`). It is idempotent.
  - `GET /api/posts?label=bts&sellerId=…[&before=&limit=]` is public. It returns that seller's published BTS posts, using the same visibility, block and good-standing rules as other public reads.
- `productMentions` + `labels` are now added to these reads: `GET /api/feed/for-you`, `GET /api/posts/feed`, `GET /api/posts/:id`, `GET /api/posts/mine` (and every other `postDetails` response), and `GET /api/public/posts`.

### Mobile
- `lib/captionMentions.ts` (+ `captionMentions.test.ts`): `splitProductMentions`, `mentionsInCaption`, `insertMentionLabel`, `mapApiProductMentions`.
- `services/postExtrasService.ts`: `setPostProductMentions`, `setPostBehindTheScenes`, and `syncPostExtras`. The last one runs after the post saves, never throws, and does nothing when the composer didn't offer these fields (buyers).
- `components/create-post/PostScreen.tsx` (sellers only):
  - A new "Mention a product" row opens a search list of your products. Tapping one inserts its name at the cursor and returns to the composer, and the row shows "N in caption". Tapping a checked product removes the mention.
  - The caption mirror highlights mentioned names the way it highlights #/@ tokens.
  - A "Behind the scenes" switch was added at the end of More options.
- `app/create-post.tsx`:
  - `?bts=1` starts with the switch on.
  - Editing a post prefills its mentions and BTS state.
  - The edit-save path also syncs them.

## Touches existing UI

| File | Change |
|---|---|
| `components/social/CaptionText.tsx` | `CaptionSpans`/`CaptionText` accept optional `productMentions` + `onProductMention`, and linked names render in `FONT.bold`. Callers that don't pass them get identical output. |
| `components/buyer-feed/CaptionBlock.tsx` | Adds an optional `postLabel` line (12pt semibold, same colour and shadow as the caption) between the name row and the caption, shown only on BTS posts. Mention props are passed to `CaptionSpans`. |
| `app/(tabs)/feed.tsx` | Two optional fields were added to `SpotlightItem` and mapped from `SellerThreadPost`. Three props were added on `<CaptionBlock>`. A small `mentionShopTarget` helper reuses `onShopTag`. |
| `components/create-post/PostScreen.tsx` | Adds one `OptionRow` (sellers), one switch row in More options (sellers), and a new `ProductMentionPage` sub-page. The caption mirror now also highlights mention labels. |
| `app/create-post.tsx` | Reads the `bts` param, prefills on edit, and adds one `syncPostExtras` call on the edit-save path. |
| `lib/createPost/publish.ts`, `lib/createPost/types.ts` | Adds one `syncPostExtras` call after create/update, plus two optional `PostDetails` fields. |
| `services/socialService.ts` | Adds two optional `SellerThreadPost` fields, mapped in `mapOwnedApiPost` and `mapApiPostToSellerThreadPost`. |

## Feature flags / env keys

None. No third-party service, no key, and no paid API are involved. In the signed-out web preview the mention picker shows its empty state. In demo mode (`?demo=1`) it lists the local demo products. It never calls a protected API in preview.

## Tests

- API unit test: `src/lib/__tests__/productMentions.test.ts` (5 tests).
- API integration test: `src/routes/__tests__/post-mentions-labels.integration.test.ts` (7 tests). It covers:
  - non-author, signed-out and unknown-post rejections
  - other sellers' and draft products being rejected
  - labels that aren't in the caption
  - caption ordering and replacing the set
  - `GET /api/posts/:id` carrying `productMentions`/`labels`
  - archived products dropping out
  - BTS being seller-only and author-only, idempotent, and listed by `?label=bts`
  ```
  cd artifacts/api-server && TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/bt_test_mentions_bts pnpm exec vitest run src/lib/__tests__/productMentions.test.ts src/routes/__tests__/post-mentions-labels.integration.test.ts
  → 2 files, 12 tests passed
  ```
- I re-ran all 31 API test files that import the posts, feed or public routers on this branch and on `origin/dev`. **No new failures.** The 24 failures that remain also fail on dev: post-slide-validation needs `PRIVATE_OBJECT_DIR`, and post-quotes, media-moderation and profile-privacy fail for reasons outside these files. `connectivity-dm-routing` failed once on this branch, then passed twice in a row on re-run, so it is flaky and not touched here.
- Mobile: `lib/captionMentions.test.ts` (7 tests). `lib/createPost/__tests__/publish.test.ts` now mocks `postExtrasService` and asserts that `syncPostExtras('p1', details, {editing:false})` is called after create.
- Full mobile vitest, compared as FAIL lists: origin/dev has 119 failing entries and this branch has 118, with **0 new** (`tests/a11y-icon-only-lint.test.ts` now passes on this branch).
- `tsc --noEmit`: api-server 0 errors and mobile 0 errors (after `tsc --build` of the libs).
- Screenshots come from `node artifacts/mobile/scripts/f6-mentions-bts-screenshots.mjs` at 390x844 and are saved in `docs/pr-assets/mentions-bts/ours/`.

## Suggestions for Dev

- **Web gallery bug (pre-existing, not changed here):** `lib/createPost/useDeviceMedia.ts` `requestAccess()` sets `permission='denied'` on web, because `getMediaLibrary()` is null there. The web gallery therefore always shows "Allow access" and never shows the files picked through the hidden input. `create-flow-verify.mjs` likely hits this too. The screenshot script works around it with the fake camera. That area is owned by the create-flow session.
- A `$` typing trigger in the caption, like the `@` suggestions, would be a nice follow-up. I kept the composer change to one row because other sessions own the create flow.
- The BTS profile filter (`GET /api/posts?label=bts&sellerId=`) is ready, but nothing calls it yet. Profile screens were deliberately left alone.
- **Studio entry point (not added):** a "Behind the Scenes" tool card in the Studio grid that opens `/create-post?mode=thread&bts=1` was built and then pulled out of this PR. Appending it made the grid's last row a single card, and the Studio screen is owned by other sessions. If you want it, it is a ~15-line addition to `STUDIO_TOOLS` in `app/(tabs)/studio.tsx`; the composer already supports `?bts=1`.
- Other places where captions render (`buyer-post-viewer`, the quote and RFQ screens) don't pass mentions yet. They mostly show buyer posts, which can't carry mentions.
