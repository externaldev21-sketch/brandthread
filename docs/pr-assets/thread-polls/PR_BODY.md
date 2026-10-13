# Threads polls (Meta Threads 1:1): add a poll to a Thread, vote in the feed

## Summary

Item 77, "polls in Threads". A seller can add a poll (2 to 4 choices, with a poll length) to a Thread from the Thread composer. Buyers vote in the Threads feed and in the post viewer.

- **What already existed:** story poll stickers (`story_poll_votes`, `routes/story-stickers.ts`). The new vote endpoint follows the same rules they use: one vote per person, the author can't vote, and a duplicate vote returns `409 ALREADY_VOTED` along with the current state. Polls on posts did not exist before this PR.
- **Rules (copied from the reference):**
  - 2 to 4 choices, each up to 25 characters.
  - Poll length from 5 minutes to 7 days. The default is 1 day, which matches Threads' 24-hour polls.
  - One vote per person, and you can't change it.
  - The author can't vote, but always sees the results.
  - Everyone else sees results only after voting or after the poll ends. The total vote count and the time left are visible to everyone.
  - A poll can't be edited once anyone has voted.
  - Blocked users can't see or vote on the poll, in either direction.
  - Nobody can vote after the poll ends or before the post is live (drafts, or scheduled posts that aren't due yet).

## Reference

The Meta Threads app is not on Mobbin, so this follows the brief's fallback: **X (Twitter)**, used for both flows. Threads and X use the same poll model: 2–4 choices, a length that defaults to 1 day, results after you vote, "N votes · time left". The composer step is copied from X's poll editor, reskinned for our black create canvas.

- X, "Publishing a poll" flow: https://mobbin.com/flows/ce62c2af-8db5-4ece-b918-144a00851c5e
- X, poll post (results with "0 votes · 1 day 23 hours left"): https://mobbin.com/screens/dbe7816f-7f0d-4e7f-a321-08a8a6c1ea26
- Also checked: Instagram's post poll composer (Meta), https://mobbin.com/screens/f50c8c89-9579-4bf8-9d87-a1b26974fa0e. It uses the same layout: rounded choice fields, "Add another option", an end-time setting.

| Reference (X) | Ours |
|---|---|
| ![](reference/x-poll-composer-empty.jpg) | ![](ours/02-poll-editor-empty.png) |
| ![](reference/x-poll-composer-filled.jpg) | ![](ours/03-poll-editor-filled.png) |
| (Poll length row expands to Days / Hours / Minutes) | ![](ours/04-poll-length-open.png) |
| — | ![](ours/01-composer-poll-row.png) ![](ours/05-composer-poll-added.png) |
| ![](reference/x-poll-post-results.jpg) | ![](ours/06-feed-poll-before-vote.png) ![](ours/07-feed-poll-after-vote.png) |
| — | ![](ours/08-post-viewer-final-results.png) |

## What's new

### Server
- `lib/db/src/schema/postPolls.ts` and `lib/db/migrations/300_f6_thread-polls.sql` add two tables. Both cascade-delete with the post.
  - `post_polls`: `post_id` (primary key, FK to posts), `options` jsonb, `duration_minutes`, timestamps.
  - `post_poll_votes`: `(post_id, user_id)` is the primary key, which makes "one vote per person" a database rule. Also stores `option_index`.
- How the end time works (differs from the brief): instead of storing `ends_at`, the end time is computed when the poll is read, as the post's go-live time plus the duration. The go-live time is `published_at` for published posts and `scheduled_at` for scheduled ones. This way a poll on a draft or scheduled Thread starts counting when the Thread goes live. A stored `ends_at` would already be running down while the post sits in drafts.
- New router `artifacts/api-server/src/routes/post-polls.ts`, mounted under `/posts` ahead of the posts router (one import line and one `router.use` line in `routes/index.ts`). `posts.ts` is unchanged.
  - `GET /api/posts/polls?ids=a,b,…` returns summaries for the feed in one batch (max 50 ids). It only returns posts the viewer can see.
  - `GET /api/posts/:postId/poll`
  - `PUT /api/posts/:postId/poll`: author only. Works only on posts with `surface='thread'` (otherwise `POLL_THREADS_ONLY`), runs content moderation, and returns `409 POLL_LOCKED` once anyone has voted.
  - `POST /api/posts/:postId/poll/vote`: `{ optionIndex }`. Error codes:
    - `403 AUTHOR_CANNOT_VOTE` for the author
    - `409 ALREADY_VOTED` and `409 POLL_ENDED` (both return the current poll)
    - `404` when blocked or the post isn't visible
    - Uses the `post-interact` rate limit.
- `artifacts/api-server/src/lib/postPolls.ts` holds the pure rules: input validation, the poll clock, percentages that always add up to 100, and the summary (who sees results, `canVote`, winner).

### Mobile
- `services/postPollService.ts`:
  - Uses `serviceRequest`. Feed cards' requests are batched into one `/api/posts/polls?ids=` call per tick.
  - Keeps a small in-memory store so a vote updates every card showing that post.
- `lib/postPolls.ts`: draft validation, poll length and time-left copy ("1 day 23 hours left", "Final results"), vote counts.
- `components/create-post/PollPage.tsx`: the X poll editor on the create canvas.
  - "Choice 1/2" fields, a `+` to add a choice (up to 4), and an `x` to remove the poll.
  - A "Poll length" row that opens Days / Hours / Minutes columns. Done is enabled only when the poll is valid.
- `components/social/PollCard.tsx`:
  - Before voting: full-width rounded choice buttons.
  - After voting, after the poll ends, or for the author: fill bars with percentages, your choice in bold with a check, and the winner in bold once the poll ends.
  - Footer: "N votes · time left".
  - Guests tapping a choice get the existing sign-in gate.
- `lib/createPost/attachPoll.ts`: after the Thread is created, the poll is attached with `PUT`. It is retried once. If it still fails, an alert says the Thread was posted without its poll. The post is never failed or duplicated.

## Touches existing UI

All changes are additive and only take effect on posts that have a poll:

- `components/create-post/PostScreen.tsx`
  - One new `OptionRow` "Poll", shown only in Thread mode when creating, not when editing.
  - Before: Visibility row followed by More options. After: a Poll row in between. The row shows "4 choices · 1 day" once a poll is added.
  - The `PollPage` sub-page is rendered like the other sub-pages (3 lines plus 2 imports).
- `lib/createPost/types.ts`: optional `poll?: PollDraft | null` added to `PostDetails`.
- `app/create-post.tsx`: the publish `run` closure now chains `.then(post => attachThreadPoll(post, …))`, plus one import line.
- `components/buyer-feed/CaptionBlock.tsx`: a new optional `belowCaptionSlot` prop, rendered between the caption and the sound row. When it isn't passed, the layout is unchanged.
- `app/(tabs)/feed.tsx`: passes `belowCaptionSlot={<PollCard postId={item.id} variant="overlay" />}`, plus one import line. `PollCard` renders nothing when the post has no poll.
- `app/buyer-post-viewer.tsx`: `<PollCard>` is rendered under the caption (renders nothing without a poll), plus one import line.

## Feature flags / env keys

None. No external service and no keys. The feature is live for every Thread that has a poll.

## Tests

- `cd artifacts/api-server && pnpm exec vitest run src/lib/postPolls.test.ts`: **10 passed**. Covers validation, the poll clock, percentages, and visibility of results.
- `cd artifacts/api-server && TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/bt_test_thread_polls pnpm exec vitest run src/routes/__tests__/post-polls.integration.test.ts`: **10 passed**. Covers:
  - Only the author can attach a poll, only on a Thread, with input validation and sign-in required.
  - Draft polls are hidden from others.
  - Results stay hidden until you vote; then one vote is recorded, and a second or changed vote is rejected.
  - The author can't vote; blocked users can't see or vote.
  - Bad choice index; post with no poll; held post.
  - `POLL_LOCKED` after the first vote; `POLL_ENDED` with final results and a winner.
  - The batch endpoint only returns visible posts, enforces the 50-id cap, and cascade-deletes with the post.
- `cd artifacts/mobile && pnpm exec vitest run tests/thread-polls.test.ts`: **11 passed**. Covers draft rules, the poll-length and time-left copy, the batched service calls, keeping the server's poll on "already voted", and attachPoll retry and reporting.
- `pnpm run typecheck` in artifacts/api-server: 0 errors. `pnpm exec tsc -p tsconfig.json --noEmit` in artifacts/mobile: only the 2 errors that were already there (`lib/api-client-react/dist` not built). Nothing new.
- Screenshots: `node artifacts/mobile/scripts/f6-thread-polls-screenshots.mjs` at 390x844, output in `docs/pr-assets/thread-polls/ours/`. Each screenshot was checked by eye.

## Suggestions for Dev

- **The web create gallery is broken on dev.** In `lib/createPost/useDeviceMedia.ts`, `requestAccess()` sets `permission='denied'` whenever `isWeb`. On web, the gallery therefore always shows "Allow access to your photos" and never the file grid; `e2e/create-flow.spec.ts` expects the grid. To screenshot the composer, I patched that line locally for one build only (web → `granted`). The patch is **not** in this PR, because the create flow is owned by another session.
- Polls are attached with a separate `PUT` right after `POST /api/posts`, so `posts.ts` didn't need to change. If you'd rather create the post and its poll in one transaction, `POST /api/posts` could accept `poll` and call the same `validatePollInput` and insert.
- Editing a draft Thread doesn't show the Poll row; it appears only when creating a Thread. The server already allows `PUT` on a draft, so the row could be shown for drafts once the edit screen loads the existing poll.
- No notification to the author when their poll ends. X sends one; that would belong in `lib/activityEvents.ts`.
