/**
 * "Pin to your profile" (Instagram pattern; routes/post-pins.ts): an author
 * pins up to 3 of their own published posts, which list first on their
 * profile grid, most recently pinned first. Pinning a 4th asks to replace the
 * oldest pin (the client confirms, then retries with `replaceOldest`).
 */
import { and, eq, inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { db, postPins, posts } from "@workspace/db";

export const MAX_PINS = 3;

export interface ExistingPin { postId: string; pinnedAt: Date }

export type PinPlan =
  | { action: "already" }
  | { action: "insert" }
  | { action: "replace"; removePostId: string }
  | { action: "limit"; pinned: string[] };

/**
 * What pinning `postId` does given the author's current live pins.
 * Already pinned is a no-op; under the cap inserts; at the cap either replaces
 * the oldest pin (when the author confirmed) or reports the limit.
 */
export function planPin(existing: ExistingPin[], postId: string, replaceOldest: boolean): PinPlan {
  if (existing.some((p) => p.postId === postId)) return { action: "already" };
  if (existing.length < MAX_PINS) return { action: "insert" };
  const byAge = [...existing].sort((a, b) => a.pinnedAt.getTime() - b.pinnedAt.getTime() || a.postId.localeCompare(b.postId));
  if (!replaceOldest) return { action: "limit", pinned: byAge.map((p) => p.postId) };
  return { action: "replace", removePostId: byAge[0].postId };
}

/**
 * `pinned_at` of the post in `postIdColumn`, or NULL — for select lists. A pin
 * only counts while its post is published (archiving or unpublishing a post
 * leaves the pin dormant, as Instagram drops it from the grid).
 */
export function pinnedAtSql(postIdColumn: SQLWrapper): SQL<Date | null> {
  return sql<Date | null>`(SELECT pp.pinned_at FROM post_pins pp JOIN posts pinned_post ON pinned_post.id = pp.post_id AND pinned_post.post_status = 'published' WHERE pp.post_id = ${postIdColumn})`;
}

/** ORDER BY term that lists pinned posts first, newest pin first. */
export function pinnedFirst(postIdColumn: SQLWrapper): SQL {
  return sql`${pinnedAtSql(postIdColumn)} DESC NULLS LAST`;
}

/** ISO `pinnedAt` (or null) for API rows. Drizzle returns raw subquery timestamps as strings. */
export function pinnedAtIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** pinnedAt by post id, for endpoints that select whole post rows. */
export async function pinnedAtByPostId(postIds: string[]): Promise<Map<string, string>> {
  if (postIds.length === 0) return new Map();
  const rows = await db.select({ postId: postPins.postId, pinnedAt: postPins.pinnedAt }).from(postPins)
    .innerJoin(posts, and(eq(posts.id, postPins.postId), eq(posts.postStatus, "published")))
    .where(inArray(postPins.postId, postIds));
  return new Map(rows.map((r) => [r.postId, r.pinnedAt.toISOString()]));
}
