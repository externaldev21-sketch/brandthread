# Photo replies in comments (TikTok 1:1)

## Summary

Item 83: people can attach one photo to a comment or a reply on a post. A photo-only comment (no text) is allowed. Every photo goes through a moderated upload first, and a comment can only point at a photo our server stored and screened. A photo the screening holds keeps the whole comment "In review", the same way a held post works.

**Already existed and was extended, not rebuilt**
- `routes/post-comments.ts`: POST now takes an optional `media`. GET list and GET replies now return `media` on every comment (`null` when there is no photo).
- Image screening is the existing `lib/mediaModeration.ts` screening that posts and DMs use (`screenImageBuffer`), with rejected uploads recorded through `recordRejectedUpload` and held comments queued through `recordHeldMedia` (which already accepted `targetType: "comment"`).
- Mobile: the photo button sits in the existing comment composer (`components/ui/Composer` in `app/buyer-post-comments.tsx`). The picked photo goes in the Composer's existing `topSlot`. Tapping a photo opens the existing full-screen `components/chat/MediaViewer` (pinch to zoom, swipe down to close, save/share).
- The feed's comment sheet *is* `app/buyer-post-comments.tsx`: `feed.tsx` pushes `/buyer-post-comments` from `handleOpenComments` and has no inline comment composer of its own. That means one integration covers both the feed sheet and the comments screen, and `feed.tsx` is unchanged.

## Reference

The title says TikTok, but **the reference used is Threads.** TikTok's photo comments are not on Mobbin. The TikTok "Commenting on a video" flow there (https://mobbin.com/flows/13398e6b-f676-4101-8a9a-5ae4f0127e1e) predates the feature and has no image button. As the brief allowed, I used the Threads image reply instead (Threads iOS):

- Composer with the attach icon: https://mobbin.com/screens/cc503bb6-a3af-4358-8aac-93e5fd1dc8c7
- Picked photo with a round "x" in its top-right corner: https://mobbin.com/screens/3511218b-1ba5-44b0-b944-dbd3565c7280
- Reply composer: https://mobbin.com/screens/c6f17190-7b64-4143-b657-1b114fc25dbe

The reference images are Mobbin's low-res previews. The egress proxy blocks mobbin.com, so I couldn't download the high-res `image_url`.

| Reference (Threads) | Ours |
|---|---|
| ![](reference/threads-composer-attach.jpg) | ![](ours/01-comments-with-photos.png) |
| ![](reference/threads-photo-preview-remove.jpg) | ![](ours/04-draft-ready-with-remove.png) |
| ![](reference/threads-reply-composer.jpg) | ![](ours/05-posted-photo-comment.png) |
| — | ![](ours/02-photo-reply-expanded.png) |
| — | ![](ours/03-draft-uploading.png) |
| — | ![](ours/06-full-screen-viewer.png) |

How it maps to Threads:
- **Picked photo:** shown above the input, with rounded corners and a round dark "x" in its top-right corner that removes it before sending.
- **Photo in a comment:** sits under the comment's text, left-aligned, with rounded corners and sized to the photo's aspect ratio (max 200×240, or 160×200 for replies). Tapping it opens the full-screen viewer.
- **Button placement:** Threads puts its attach icon under the text field in a full-screen composer. Ours is an inline comment bar, so the image icon joins the existing tool icons inside the input (image, emoji, @). Moving it under the field would mean re-laying out the existing composer. That is also where TikTok's live app puts its photo button.

## What's new

**Server**
- `lib/db/src/schema/commentMedia.ts` + `lib/db/migrations/300_f6_comment-photos.sql` add a new table, `post_comment_media`, with columns `id`, `owner_id`, `comment_id` (nullable, unique, FK → `post_comments` ON DELETE CASCADE), `url`, `width`, `height`, `moderation_verdict`, `moderation_categories`, `unverified`, `created_at` and `attached_at`. It is exported once in `schema/index.ts`, right after `./comments`.
- `routes/comment-media.ts` adds `POST /api/comment-media/upload` (`requireAuth`, `rateLimit("upload")`), taking `{ data: base64 | data-URL, mimeType }`. It is mounted next to the comments router.
  - Accepts JPEG, PNG or WebP only, up to about 15 MB.
  - Checks the account isn't suspended or restricted (`publishingRestriction`).
  - Re-encodes the photo with sharp, which proves it is an image, strips EXIF/GPS and caps the long edge at 1600px.
  - Screens the original bytes with `screenImageBuffer`. A **reject** returns 422 `IMAGE_REJECTED`, nothing is stored, and `recordRejectedUpload(surface: "comment")` records it. A **hold** stores the photo and remembers the verdict on the row.
  - Stores the photo at `comment-media/<userId>/<uuid>.jpg` (public, immutable cache) and returns `{ media: { id, url, width, height } }`.
- `routes/post-comments.ts` POST takes optional `media: { id }` or `{ url }`.
  - The photo must be an **unattached upload owned by the commenter**. An arbitrary URL, another bucket or prefix, someone else's upload, or an upload already used all return 400.
  - Attaching happens in the same transaction as the comment insert, guarded by `comment_id IS NULL`, so one upload can't be attached twice.
  - `body` may be empty when a photo is attached.
  - A held photo makes the comment `held` (`moderation_reason: media:<categories>`) and queues it for moderators with `recordHeldMedia(targetType: "comment")`. Text holds keep their existing report path.
  - A photo-only comment's notification preview reads "Photo".
- `lib/commentMedia.ts` holds the input parsing and URL-prefix check (pure, unit-tested), the media lookup for lists, and a store test seam.

**Mobile**
- `components/comments/CommentPhoto.tsx` holds:
  - `useCommentPhotoDraft`: pick → upload → ready, or an error state with retry.
  - `CommentPhotoButton`, `CommentPhotoDraft` (preview with the "x") and `CommentPhotoView` (photo in a row, tap for full screen).
- `services/commentMediaService.ts` uses `serviceRequest` to call upload and create-with-media.
- `lib/commentPhoto.ts` has the pure sizing and MIME helpers, unit-tested.
- `lib/safetyTypes.ts` adds `ThreadComment.media?` and the `CommentMedia` type.
- `lib/guestApiPolicy.ts` adds `comment-media` to the signed-in-only prefixes, so a signed-out preview never calls the upload.
- `scripts/f6-comment-photos-screenshots.mjs` is the screenshot script.

## Touches existing UI

- `app/buyer-post-comments.tsx`, all small insertions:
  - An image button is added before the emoji icon in the composer's right-side tools.
  - The Composer's `topSlot` shows the picked photo.
  - `canSend` also allows a photo with no text, and blocks while the photo uploads.
  - `CommentRow` renders `CommentPhotoView` under the comment content. It is a sibling, not nested, so there is no `<button>` inside a `<button>` on web.
  - `MentionText` is skipped when the body is empty (photo-only comment).
  - `handleSend` sends `mediaId`. The optimistic row includes the photo, and the photo goes back into the composer if posting fails.
  - Nothing is restyled or moved.
- `app/(tabs)/feed.tsx`: no change. Its comment sheet is the screen above.

## Feature flags / env keys

No new keys.
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID` (existing): without it the upload answers 503 "Photo upload isn't available right now." and the app shows that message under the picked photo. Nothing crashes.
- Screening uses the existing `AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY` and the `MEDIA_MODERATION_ENABLED` kill switch, the same as posts and DMs. Without them screening is skipped (verdict `skipped`) and uploads go through. With them, rejects are refused and holds put the comment in review.

## Tests

API (`cd artifacts/api-server && TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/bt_test_comment_photos pnpm exec vitest run …`):
- `src/routes/__tests__/comment-photos.integration.test.ts` covers:
  - Upload: auth, MIME and base64 checks, not-an-image, re-encode and size cap, reject (nothing stored, rejection recorded), 503 without storage.
  - Comments: photo-only comment, `media` in the list for signed-out readers, `media: null` on text comments, photo replies inline and on the replies page, reference by URL.
  - Refusals: empty without a photo; external URL, other prefix, someone else's upload and a reused upload are all refused.
  - A held photo puts the comment in review: only the author sees it and it is in the moderation queue.
  - Deleting the comment cascades to the photo row.
- `src/lib/__tests__/commentMedia.test.ts`: URL prefix and input parsing.
- Re-run unchanged: `post-comments-pin-mentions`, `ugc-safety`, `activity-events`, `connectivity-commerce-social`, `social-audit-foryou`, `drops-role-gate`.
- Result: **8 files, 73 tests passed** (16 of them new: 11 integration + 5 unit).

Mobile:
- `pnpm exec vitest run lib/__tests__/commentPhoto.test.ts` covers sizing, MIME and the guest guard. **6 passed**.
- Related existing suites re-run. `components/inline-feedback.test.ts` (2 tests) and `tests/screen-header-migration-lint.test.ts` (2 tests) fail **on origin/dev too**. Their regexes and allowlists don't match dev's current files, and none of the flagged files are ones I added.

Typecheck: `tsc --noEmit` in api-server gives 0 errors. Mobile gives 0 errors.

## Suggestions for Dev

- Only one photo per comment, and no GIFs or video. TikTok and Threads also allow a single photo in comments.
- `post_comment_media` rows that are uploaded but never attached (picked, then removed or abandoned) are kept. A daily sweep deleting unattached rows and objects older than 24h would tidy storage. I didn't add a cron.
- The moderation queue shows a held comment's photo URL in `contentExcerpt` and `mediaRefs`. The admin comment view doesn't render the image inline yet.
