/**
 * Post go-live helpers shared by the scheduled-post publisher job and the
 * explicit "publish now" endpoint.
 *
 * Normal publish (POST /api/posts with no scheduledAt) has no follower fan-out
 * or author notification today: it inserts the row and promotes composed
 * media to public. `onPostPublished` therefore covers exactly the side effects
 * a scheduled post missed while it sat as `scheduled`: its composed media was
 * kept private, and the author never heard that it went live.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, notificationsFeed, posts } from "@workspace/db";
import { setComposedMediaVisibility } from "../routes/post-video";
import { publishNotification } from "../routes/notifications-feed";
import { postThumbnail } from "./activityEvents";
import { logger } from "./logger";

export const MIN_SCHEDULE_LEAD_MS = 5 * 60_000;
export const MAX_SCHEDULE_LEAD_MS = 75 * 24 * 60 * 60_000;
export const MAX_DRAFTS_PER_USER = 100;
export const SCHEDULED_LIVE_NOTIFICATION = "scheduled_post_live";

type PostRow = typeof posts.$inferSelect;

/** Returns an error message when `at` is outside the allowed scheduling window. */
export function scheduleWindowError(at: Date, now = new Date()): string | null {
  const lead = at.getTime() - now.getTime();
  if (lead <= 0) return "scheduledAt must be in the future";
  if (lead < MIN_SCHEDULE_LEAD_MS) return "scheduledAt must be at least 5 minutes from now";
  if (lead > MAX_SCHEDULE_LEAD_MS) return "scheduledAt must be within 75 days from now";
  return null;
}

function composedPathFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const pathname = new URL(value, "https://brandthread.invalid").pathname;
    const marker = "/api/posts/media/";
    const index = pathname.indexOf(marker);
    if (index < 0) return null;
    const suffix = decodeURIComponent(pathname.slice(index + marker.length));
    if (!suffix || suffix.includes("..")) return null;
    return `/objects/${suffix.replace(/^\/+/, "")}`;
  } catch {
    return null;
  }
}

/** Object-storage paths a post's media lives at (composed video/thumbnail/slides). */
export function postMediaPaths(post: Pick<PostRow, "mediaUrl" | "thumbnailUrl" | "mediaPaths">): string[] {
  return [composedPathFromUrl(post.mediaUrl), composedPathFromUrl(post.thumbnailUrl), ...(post.mediaPaths ?? [])]
    .filter((p): p is string => !!p);
}

/** Promote a post's composed media to public when its visibility allows it. */
export async function promotePostMedia(post: PostRow): Promise<void> {
  if (post.visibility?.isPublic === false) return;
  const paths = postMediaPaths(post);
  if (paths.length === 0) return;
  await setComposedMediaVisibility(post.userId, paths, "public");
}

/** "Your scheduled post is live": once per post, skipped while moderation holds it. */
export async function notifyScheduledPostLive(post: PostRow): Promise<void> {
  if (post.moderationStatus !== "visible") return;
  const [existing] = await db.select({ id: notificationsFeed.id }).from(notificationsFeed)
    .where(and(
      eq(notificationsFeed.userId, post.userId),
      eq(notificationsFeed.type, SCHEDULED_LIVE_NOTIFICATION),
      eq(notificationsFeed.targetId, post.id),
    )).limit(1);
  if (existing) return;
  await publishNotification({
    userId: post.userId,
    category: "social",
    type: SCHEDULED_LIVE_NOTIFICATION,
    title: "Your scheduled post is live",
    body: post.caption ? post.caption.slice(0, 120) : "",
    targetId: post.id,
    targetType: "post",
    targetImageUrl: postThumbnail(post),
  });
}

/** Side effects of a post going live from draft/scheduled. Never throws. */
export async function onPostPublished(
  post: PostRow,
  opts: { notifyAuthor?: boolean } = {},
): Promise<void> {
  try {
    await promotePostMedia(post);
  } catch (err) {
    logger.error({ err, postId: post.id }, "Could not promote media of a post that went live");
  }
  if (opts.notifyAuthor) {
    try {
      await notifyScheduledPostLive(post);
    } catch (err) {
      logger.warn({ err, postId: post.id }, "Scheduled post live notification failed");
    }
  }
}

const BATCH = 100;

/**
 * Flip every due scheduled post to published exactly once. The claim is a
 * single `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`,
 * so concurrent runners (several instances, or overlapping ticks) never claim
 * the same row and only the claimer runs the side effects.
 */
export async function publishDuePosts(now = new Date()): Promise<PostRow[]> {
  const published: PostRow[] = [];
  for (;;) {
    const due = await db.select().from(posts)
      .where(and(eq(posts.postStatus, "scheduled"), lte(posts.scheduledAt, now)))
      .limit(BATCH);
    if (due.length === 0) break;
    // Promote media before the flip so a post never goes public with private media.
    await Promise.all(due.map((post) => promotePostMedia(post).catch((err) =>
      logger.error({ err, postId: post.id }, "Could not promote scheduled post media"))));

    const claimed = await db.execute(sql`
      UPDATE posts
         SET post_status = 'published',
             published_at = scheduled_at,
             created_at = ${now},
             updated_at = ${now}
       WHERE id IN (
         SELECT id FROM posts
          WHERE post_status = 'scheduled'
            AND scheduled_at <= ${now}
            AND id IN (${sql.join(due.map((p) => sql`${p.id}::uuid`), sql`, `)})
          FOR UPDATE SKIP LOCKED
       )
         AND post_status = 'scheduled'
      RETURNING id
    `);
    const ids = (claimed.rows as Array<{ id: string }>).map((r) => r.id);
    if (ids.length === 0) break;
    const rows = await db.select().from(posts).where(inArray(posts.id, ids));
    for (const post of rows) {
      await onPostPublished(post, { notifyAuthor: true });
      published.push(post);
    }
    if (due.length < BATCH) break;
  }
  return published;
}
