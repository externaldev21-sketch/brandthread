# Drafts and scheduled posts

Server contract for the create flow. All endpoints require auth and operate on the caller's own posts only (another user's post is a 404). Times are ISO-8601 strings in UTC (`2026-10-05T14:30:00.000Z`); the client converts from local time.

## States

`posts.post_status`: `draft` -> `scheduled` -> `published` (also `archived`, `deleted`). A draft is private and never appears outside the owner's own lists.

## Create (existing endpoint)

`POST /api/posts`

| Intent | Payload |
| --- | --- |
| Save draft | `{ ...post fields, "isDraft": true }` |
| Schedule | `{ ...post fields, "scheduledAt": "<ISO UTC>" }` (sellers only) |
| Publish | neither field |

Rules:

- `isDraft` and `scheduledAt` together: 400.
- `scheduledAt` must be between **5 minutes** and **75 days** from now, otherwise 400 `INVALID_SCHEDULE_TIME` (message says which bound).
- Draft cap: **100 drafts per user**; the 101st returns 409 `DRAFT_LIMIT_REACHED`.
- **Buyers cannot schedule**: `scheduledAt` returns 403 `BUYER_NO_SCHEDULING`. Buyers can keep drafts and publish them. This rule is asserted by `posts-buyer-rules.integration.test.ts`, so it was left as is.

`PATCH /api/posts/:id` still accepts `isDraft`, `postStatus`, `scheduledAt` (same window rules) for editing a draft or scheduled post's content.

## Dedicated transitions

| Endpoint | Body | From -> to | Errors |
| --- | --- | --- | --- |
| `POST /api/posts/:id/schedule` | `{ "scheduledAt" }` | draft or scheduled -> scheduled (reschedule when already scheduled) | 400 `INVALID_SCHEDULE_TIME`, 403 `BUYER_NO_SCHEDULING`, 409 `POST_NOT_SCHEDULABLE` |
| `POST /api/posts/:id/unschedule` | none | scheduled -> draft (no-op 200 if already draft) | 409 `POST_NOT_SCHEDULED`, 409 `POST_ALREADY_LIVE` (time already passed) |
| `POST /api/posts/:id/publish-now` | none | draft or scheduled -> published (200 and unchanged if already published) | 409 `POST_NOT_PUBLISHABLE` |
| `DELETE /api/posts/:id` | none | any -> deleted (soft delete; also clears `scheduledAt`) | 404 |

All transitions respond with the full post (same shape as `GET /api/posts/mine`).

## Lists

`GET /api/posts/mine?status=draft|scheduled|published|archived&limit=&offset=` returns the caller's posts newest-first. Without `status` it returns all four statuses (unchanged). Unknown values: 400.

## Go-live (publisher job)

`jobs/scheduledPostPublisher.ts` runs every minute on every instance. Claiming is one `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`, so a due post is flipped exactly once.

When a post goes live the job sets `post_status = 'published'`, `published_at = scheduled_at`, `created_at = now` (feeds order by `created_at`, so it surfaces as fresh and stays inside the `posts_created_published_idx` partial index), promotes composed media to public, and sends the author the notification **"Your scheduled post is live"** (`type: scheduled_post_live`, `targetType: post`). The notification is skipped while moderation holds the post, and it is sent once per post.

Reads still evaluate "due" lazily (`scheduled_at <= now()`), so a post is visible the moment its time passes even if the job is a few seconds behind.

Normal publishing has no follower fan-out today, so none is added for scheduled posts either. `lib/postPublish.ts#onPostPublished` holds the go-live side effects and is shared by the job and `publish-now`.

## Orphaned media

Media uploaded for a draft stays in object storage, private, as long as the draft exists. Deleting a draft soft-deletes the row and sets composed slide media private; the objects are not purged immediately. There is no separate retention sweep yet, so abandoned uploads are kept until a storage cleanup job is added.
