# Fits: Stitch a fit (TikTok 1:1), buyer fit checks on products, brand reposts with permission

## Summary

Covers F6 items **80**, **81**, **82**.

- **80 Stitch / react with your own media.** A new TikTok-style Stitch flow: pick up to 5 s of the original, add your own photo/video, post with a pre-filled `#stitch with @user` caption. The stitch is a normal post (made through the existing publish pipeline). A new side table records the attribution and the clip used.
- **81 Buyer fit checks linked to a product.** A buyer can link one of their own profile posts to a product they actually bought. The purchase is checked against `orders` / `order_items` on the server. The link is stored in a new `post_fit_checks` table, and `post_tagged_products` stays seller-only. Product pages get a "Fit checks" strip.
- **82 Brands repost buyer fits only with permission.** A brand sends "Request to repost" from a buyer post's ••• menu. The buyer gets an Activity item that opens Review, with Approve or Decline. Approving creates the brand's normal repost, which still credits the buyer. Brands can no longer repost or quote a buyer post without an approved request. That rule is enforced on the plain repost, quote and stitch paths.

**Already existed and was extended, not rebuilt:**
- Quote reposts (`posts.quoted_post_id`, `app/quote-post.tsx`, `QuotedPostCard`). Stitch is its own flow next to Quote in the share sheet and reuses the quote rules for visibility, blocks and `allowReposts`.
- Plain reposts (`interactions.type='repost'`). Approved brand reposts and stitches write that same row, so repost counts, the "Reposts" surfaces and the notification pipeline all keep working unchanged.
- The Activity notification pipeline (`publishNotification`). It gains three new types: `stitch`, `repost_request` and `repost_request_approved`.
- The create-post publish pipeline (`lib/createPost/publish.ts`) is reused for uploading stitch media. The create-post camera and mode switcher are **not** touched.

## Reference

| Flow | App | Mobbin |
|---|---|---|
| 80 Stitch | TikTok: Share sheet → **Stitch** → trim (≤5 s) → record / Upload → post screen with `#stitch with @user` and preview on the right → Post | [Recording a stitch](https://mobbin.com/flows/0d9613b1-f931-403c-bcb6-a52add11b51c), [Share options](https://mobbin.com/flows/d3004b4e-3f6f-4e21-b550-e7d278bb0ef1) |
| 81 Fit check → product | Instagram "Tag people" picker: search field over a result list, tap a row to tag | [Tagging a user](https://mobbin.com/flows/954211c6-e4e2-4a4d-9bf3-a21c3fac9e57) |
| 82 Repost permission | Instagram collab invite: notification → post with request → **Review** → Accept / Decline | [Invite collaborators](https://mobbin.com/flows/17008d63-c214-4ec9-8364-03da44a00807). Mobbin has no invitee-side screen, so the Review → Accept/Decline step follows [Instagram Help: accept a collab invite](https://help.instagram.com/iphone-app/5861247717337470) |

| Reference | Ours |
|---|---|
| ![](reference/tiktok-share-sheet-stitch.jpg) | ![](ours/01-share-sheet-stitch.png) |
| ![](reference/tiktok-stitch-post.jpg) | ![](ours/05-stitch-4-post.png) |
| ![](reference/instagram-tag-search.jpg) | ![](ours/06-fit-check-tag-product.png) |
| ![](reference/instagram-collab-invite.jpg) | ![](ours/11-repost-request.png) |

All screenshots of our screens are in `docs/pr-assets/fits/ours/`.

## What's new

### Server
- `lib/db/src/schema/fits.ts` and `lib/db/migrations/300_f6_fits.sql` add three tables:
  - `post_stitches` (post_id PK, source_post_id ON DELETE SET NULL, source_author_id, clip_start_ms, clip_end_ms)
  - `post_fit_checks` (post_id PK, product_id, buyer_id, created_at)
  - `repost_requests` (id, post_id, requester_seller_id, owner_user_id, status pending|approved|declined|cancelled, created_at, responded_at, plus a unique open-request index)
- `routes/fits.ts` is mounted at `/api/fits`, plus a public `GET /api/products/:id/fit-checks`:
  - Stitch:
    - `GET /stitch-source/:postId` checks whether the caller can stitch the post and returns a preview of the original.
    - `POST /stitches` links a post to its original. The post must belong to the caller and be under 15 min old. The original must be visible to the caller, not blocked, and allow reposts. Brands also need permission for buyer posts. The clip must be 5 s or less. The stitch also records a repost interaction and notifies the original's author.
    - `GET /stitches/:postId` returns the attribution. If the original is gone it returns `{unavailable:true}`.
  - Fit checks:
    - `GET /purchased-products` lists the products the caller can link.
    - `GET/PUT/DELETE /fit-checks/:postId`. Linking requires a buyer, the post's owner, a profile post, and a qualifying purchase: paid, order not pending/cancelled/refunded, line not refunded.
    - `GET /api/products/:id/fit-checks` returns published posts only. It respects blocks in both directions and private accounts (followers only), and hides authors who are suspended or deleted.
  - Repost requests:
    - `POST /repost-requests` is brands only and for visible buyer posts only. Repeat taps are idempotent. A declined request can't be re-sent.
    - `GET /repost-requests/:id` (owner or requester), `GET /repost-requests/status?postId=`.
    - `POST /:id/respond` (owner: approve or decline) and `POST /:id/cancel` (requester). Both use a conditional update, so a request is answered at most once.
    - Approving writes the brand's `interactions` repost row and notifies the brand.
- `lib/fitsRules.ts` holds the pure rules (clip window, qualifying purchase, request state machine, brand-permission predicate). `lib/fits.ts` holds the DB helpers.

### Mobile
- `app/stitch-post.tsx`: the TikTok Stitch flow (Trim → Your part → Post). It uses the system camera or library through `expo-image-picker` and the shared `publishCreatePost`. If linking fails after the post was created, the post is deleted so it can't exist without attribution.
- `app/fit-check-product.tsx`: the "Tag product" picker, listing verified purchases with search.
- `app/repost-request.tsx`: Review → Approve / Decline sheet.
- `components/products/FitChecksStrip.tsx`: the "Fit checks" row on the product page. It renders nothing when there are none.
- `components/social/PostFits.tsx`: the post viewer's ••• menu (Stitch / Tag product / Change / Remove product / Request to repost / Withdraw) plus the "Stitch with @user" attribution and the "Fit check · product" chip.
- `services/fitsService.ts` (via `serviceRequest`) and `lib/fits.ts` (pure helpers).

## Touches existing UI

| File | Change |
|---|---|
| `components/ThreadShareSheet.tsx` | Adds a **Stitch** action after Quote in the bottom action row. That row changes from `View` to a horizontal `ScrollView`, the same pattern as the friends row above it, so five actions on a video post don't overflow at 390 px. Before: the row was static. After: it scrolls horizontally, like TikTok's. |
| `app/buyer-post-viewer.tsx` | Adds one header action (`more-horizontal`, "More options") next to Share, and one render slot (`{fits.info}`) under the quoted-post card. The slot renders nothing for posts that aren't stitches or fit checks. |
| `app/buyer-product-detail.tsx` | Adds one `<FitChecksStrip>` line between "Worn in these videos" and "Complete the fit", where those sections already stack. No other layout changes. Product detail is not on the checkout-owned list. |
| `lib/activity.ts` | Adds one `case 'repost_request'` that opens `/repost-request?id=`. |
| `app/_layout.tsx` | Adds three `Stack.Screen` registrations. |
| `artifacts/api-server/src/routes/posts.ts` | (a) `GET /:id` lets non-friends open a buyer profile post only when it is a linked fit check. (b) The quote path and (c) `/:id/interact` repost return `403 REPOST_PERMISSION_REQUIRED` when a brand reposts a buyer's post without an approved request. |

## Feature flags / env keys

None. No new keys and no paid APIs. The signed-out web preview makes only public GETs (product fit checks); every write needs auth.

## Tests

- `cd artifacts/api-server && TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/bt_test_fits2 pnpm exec vitest run src/lib/fitsRules.test.ts src/routes/__tests__/fits.integration.test.ts` gives **24/24 passed**. The integration tests cover:
  - Purchase verification: bought, not bought, refunded, cancelled.
  - Ownership: link, unlink, buyers only.
  - Visibility: blocks both ways, private account vs follower, drafts hidden, friends-only buyer posts stay hidden.
  - Stitch: allowReposts, clip, link window, double link, attribution after the original is deleted.
  - Permission flow: brand repost and quote blocked before approval; request → notification → approve → repost row; per-brand approval; approval works with `allowReposts=false`; decline, cancel and re-request rules; only the owner can answer; answered requests are final; blocked brands get 404.
- Every existing API suite that imports `routes/posts.ts` (19 files) passes except 23 tests in 3 files: `post-slide-validation`, `post-quotes` (3 "quote payloads on reads" tests) and `media-moderation` (1 test). The same 23 fail on `origin/dev` with `posts.ts` reverted, so these failures predate this PR.
- `pnpm exec tsc -p tsconfig.json --noEmit` reports 0 errors in both api-server and mobile (after `pnpm exec tsc --build` for the libs).
- Mobile: `pnpm exec vitest run tests/fits.test.ts` passes 7/7. Full mobile vitest: see below.

## Suggestions for Dev

- **Stitch is a linked post, not one merged video.** The original's clip plays in the trim step, and the stitch post carries the attribution and the clip range. The two videos are not concatenated server-side into one file. Doing that would need the compose pipeline, which belongs to the create-post owner.
- Stitch uses the system camera (`expo-image-picker`) rather than the in-app camera, because the create-post camera and mode switcher belong to another session. Once that work lands, "Record" could open the in-app camera with the original as a picture-in-picture.
- There is no "Drafts" button on the stitch post step (TikTok has one). A draft would have to keep its stitch link, which needs a draft-to-link migration.
- `buyer-post-viewer`'s `loadPublicPost` marks every public post `authorAccountType: 'buyer'`. That is existing code and was left alone. As a result, a brand viewing a seller post through that path also sees "Request to repost", and the server answers with a clear `NOT_A_BUYER_POST` message.
- There is no list of "Stitches of this post" yet. `post_stitches_source_idx` is in place for one.
