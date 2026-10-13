# Pin up to 3 posts to your profile (Instagram 1:1)

## Summary

Item 76, "pinned post". An author can pin up to 3 of their own published posts. Pinned posts show first on their profile grid, with the most recently pinned first, and each pinned tile shows Instagram's pushpin glyph in the top-right corner. Unpinning puts the post back in date order.

- **Nothing existed for this before.** Grid order on every profile was plain newest-first.
- **Where it applies:** pinned-first ordering covers every profile grid source:
  - The seller's own grid (`/api/posts/mine`)
  - Any profile seen by others (`/api/public/users/:id/videos`), which also feeds the per-seller Threads player (`profile-videos.tsx` creatorFeed). Pinned Threads therefore come first there too.
  - The buyer profile grid (`/api/social/profile/:id/posts`)
- **Pinning a 4th post:** the app asks "Replace pinned post? You can pin up to 3 posts. Pinning this one unpins your oldest pinned post." If the user confirms, the oldest pin is replaced; Cancel changes nothing. I could not confirm on Mobbin what Instagram does at the limit, so this is the "ask, then replace" option from the brief.

## Reference

**Instagram**, "Pinning to profile" flow: https://mobbin.com/flows/8a22dba9-66dd-4a8b-bac8-93a0d39755bc. The flow is: profile grid → post ••• sheet with **"Pin to your profile"** (pushpin icon, placed after Edit and before Delete) → the grid now lists the pinned post first, with a white pushpin top-right.
Also: NYT Cooking's Instagram profile, which shows the pinned-tile glyph: https://mobbin.com/screens/2ebf521b-8011-4472-9615-9778c546f0ef

| Reference (Instagram) | Ours |
|---|---|
| ![](reference/ig-grid-before.jpg) | — |
| (Instagram post header with •••) | ![](ours/02-post-viewer-more-button.png) |
| ![](reference/ig-post-menu-pin.jpg) | ![](ours/03-owner-sheet-pin.png) |
| ![](reference/ig-grid-pinned.jpg) | ![](ours/01-profile-grid-pinned-first.png) |
| — | ![](ours/04-post-viewer-pinned-toast.png) ![](ours/05-owner-sheet-unpin.png) |

## What's new

### Server
- `lib/db/src/schema/postPins.ts` and `lib/db/migrations/300_f6_pinned-posts.sql` add the `post_pins` table:
  - Columns: `post_id` (primary key, FK to posts, cascade delete), `user_id`, `pinned_at`.
  - Index on `(user_id, pinned_at)`. No columns were added to `posts`.
- New router `artifacts/api-server/src/routes/post-pins.ts`, mounted under `/posts` ahead of the posts router:
  - `POST /api/posts/:id/pin`
    - Owner only, otherwise `403 NOT_POST_OWNER`.
    - Published posts only, otherwise `400 POST_NOT_PUBLISHED`.
    - Pinning an already-pinned post is a no-op.
    - At 3 pins it returns `409 PIN_LIMIT` with the current pins, unless the body is `{ replaceOldest: true }`.
    - A per-author advisory lock inside a transaction stops two quick pins from both getting past the limit.
  - `DELETE /api/posts/:id/pin`: owner only.
  - `GET /api/posts/pins/mine`
- `artifacts/api-server/src/lib/postPins.ts`:
  - `planPin` holds the pure "insert / already / replace oldest / limit" rule.
  - SQL helpers `pinnedFirst` and `pinnedAtSql` for the profile queries.
  - A pin only counts while its post is published. Archiving or unpublishing a post takes it off the grid's pinned block and frees the slot.
- Profile endpoints now order pinned posts first (newest pin first, then the existing order) and return `pinnedAt`:
  - `routes/profile-media.ts` `GET /users/:userId/videos`: changed `orderBy`, plus `pinnedAt` added to each row.
  - `routes/social.ts` `buildBuyerPosts`, used by `GET /profile/:userId/posts`: one select field, `orderBy`, one output field.
  - `routes/posts.ts` `GET /mine`: changed `orderBy`, plus `pinnedAt` added to each row.

### Mobile
- `components/social/PostOwnerSheet.tsx`: the owner's post ••• sheet, built on `BottomSheet`, with an Instagram-style "Pin to your profile" / "Unpin from profile" row.
- `services/postPinService.ts`:
  - `pinPost`, `unpinPost`, `getMyPins`.
  - `pinPostWithReplacePrompt`, which asks to replace the oldest pin when at the limit. It uses `Alert` on native and `window.confirm` on web, because react-native-web's `Alert` does nothing.
- `components/profile/ProfileVideoGrid.tsx`:
  - New `pinned` flag on `ProfileGridItem`, mapped from `pinnedAt` in `gridItemFromThreadPost` and `gridItemFromBuyerPost`.
  - Pinned tiles show the MaterialCommunityIcons `pin` glyph, tilted 45° like Instagram's pushpin, in the top-right. The app already uses that icon set. As on Instagram, the pin replaces the carousel/photo badge on that tile.
  - The accessibility label includes "Pinned".
- `services/socialService.ts` and `services/socialTypes.ts`: `pinnedAt` added to `SellerThreadPost` (both mappers) and to `BuyerPost`.

## Touches existing UI

- `components/profile/ProfileVideoGrid.tsx` (grid tile): a pushpin badge top-right on pinned tiles only. Unpinned tiles are unchanged.
- `app/content.tsx` (the seller's own-post "Manage post" menu): one new item, **"Pin to your profile"** / **"Unpin from profile"**.
  - It only appears for published posts and sits just before Delete, which is Instagram's order.
  - Shows a Snackbar toast: "Post pinned to your profile" or "Post unpinned".
  - The content library list is now pinned-first, because it reads `/api/posts/mine`.
- `app/buyer-post-viewer.tsx` (the owner's post viewer), following Instagram's post ••• sheet:
  - The owner gets one extra header icon button: ••• (Feather `more-horizontal`, accessibilityLabel "More options"). It goes next to the existing Share button through ScreenHeader's existing `actions` prop, so it has the same size and style.
  - Before: header actions were `[Share]`. After: `[Share, •••]` for the owner; unchanged for everyone else.
  - ••• opens the new `components/social/PostOwnerSheet.tsx`. It is built on the existing `components/ui/BottomSheet` and has one grouped row with a pushpin line icon (MaterialCommunityIcons `pin-outline` / `pin-off-outline`) and "Pin to your profile" / "Unpin from profile", Instagram's row style.
  - A Snackbar toast confirms the change. Nothing else on the screen changes.
- Profile screens (`(tabs)/profile.tsx`, `(buyer)/profile.tsx`, `seller-profile.tsx`, `buyer-other-profile.tsx`): **no code changes.** They show the new order because the server returns it, and the badge comes from the tile component.

## Feature flags / env keys

None.

## Tests

- `cd artifacts/api-server && pnpm exec vitest run src/lib/postPins.test.ts`: **6 passed**. Covers the 3-pin limit, insert/already/limit/replace, a stable tie-break, and `pinnedAtIso`.
- `cd artifacts/api-server && TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/bt_test_pinned_posts pnpm exec vitest run src/routes/__tests__/post-pins.integration.test.ts`: **9 passed**. Covers:
  - Ownership (403), published-only (draft and archived get 400), sign-in (401), unknown posts (404).
  - Pinning is idempotent; pins list newest first.
  - The 4th pin gets 409, then `replaceOldest` replaces the oldest; concurrent pins never pass 3.
  - Pinned-first order and `pinnedAt` on `/api/public/users/:id/videos` (as visitor and as owner), including pages that cross the pinned block with no duplicates.
  - The same on `/api/posts/mine` and `/api/social/profile/:id/posts` (owner and friend).
  - Unpinning restores date order; archiving retires the pin; deleting a post removes its pin.
- No regressions in `profile-media`, `posts-management` and `post-scheduling`.
  - `profile-privacy.integration.test.ts` has 1 failure ("GET /api/social/profile/:buyer returns identity + counts only", unexpected keys `isPrivate`/`followRequested`/`contentHidden`). It **fails identically on origin/dev** (checked by running it with dev's `social.ts`), so this PR didn't cause it.
- `cd artifacts/mobile && pnpm exec vitest run tests/pinned-posts.test.ts`: **6 passed**.
- Typecheck: api-server 0 errors. Mobile: no new errors; the only ones left are the TS6305 errors for the unbuilt `lib/api-client-react/dist`, which exist without this change.
- `tests/no-hardcoded-theme-color-lint.test.ts` fails the same way on dev: 16 untracked files plus 1 stale allowlist entry, none of them touched here.
- **Full mobile vitest** (`cd artifacts/mobile && pnpm exec vitest run`):
  - This branch: 72 failed / 416 passed files (88 failed / 4817 passed tests).
  - origin/dev: 72 failed / 415 passed files (88 failed / 4811 passed tests).
  - The sorted FAIL/× lists from the two runs are **identical**, so there are zero new failures. The extra passing file and 6 extra passing tests are this PR's own.
- `tests/a11y-icon-only-lint.test.ts` run alone: "keeps the screens fixed in the accessibility PR at zero" passes. The baseline test fails on dev too, and on the same 4 files (design-canvas, product-variants, PostScreen, ColorPicker). `buyer-post-viewer` and `PostOwnerSheet` are not flagged: the ••• button is labelled "More options" and the sheet row has a text label.
- Screenshots: `node artifacts/mobile/scripts/f6-pinned-posts-screenshots.mjs` at 390x844, output in `docs/pr-assets/pinned-posts/ours/`.

## Suggestions for Dev

- **Owner tools in `buyer-post-viewer.tsx` don't show for real posts.** `isOwner` compares `post.authorId` with `MY_USER_ID` (`'me'`), but real API posts carry the Clerk id, so "Edit caption" and "Delete post" only appear in the preview.
  - I didn't change `isOwner` (that would change existing UI).
  - The new pin button uses its own check, `isOwner || post.authorId === useAuth().userId`, so it works for real owners.
- **The `app/content.tsx` "Manage post" menu doesn't work on web.** It is an `Alert.alert` with many buttons, and react-native-web's `Alert` does nothing. So the seller pin action can't be screenshotted on web (it works on iOS/Android), and the same is true for every other item in that menu.
- Instagram has a "Pin to your profile" item in the ••• sheet of the full-screen post. Our seller full-screen player (`profile-videos.tsx` → feed `ThreadShareSheet`) has no owner menu, so the seller entry point is the existing Content library menu. If an owner ••• sheet is added to the player later, the pin item should go there too.
- `components/social/PostGrid.tsx` isn't used anywhere in the app, so it got no badge.
