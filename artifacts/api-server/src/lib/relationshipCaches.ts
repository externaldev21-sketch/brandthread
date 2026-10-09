/**
 * Caches that depend on who follows or blocks whom. A follow, unfollow, block
 * or unblock must show on the very next read, so these drop the affected
 * entries instead of waiting for them to expire:
 *  - For You's precomputed page (lib/ranking/forYou.ts, up to 6 minutes), which
 *    filtered blocks and weighted follows when it was computed;
 *  - the shared response cache's "has any blocks" memo (60s), which decides
 *    whether a viewer may read the shared, unfiltered search/profile entry.
 * Failures are logged and swallowed: the TTLs remain the backstop.
 */
import { inArray } from "drizzle-orm";
import { db, forYouFeedCache } from "@workspace/db";
import { forgetViewerBlocksMemo } from "../middlewares/responseCache";
import { logger } from "./logger";

async function dropForYouPages(userIds: string[]): Promise<void> {
  await db.delete(forYouFeedCache).where(inArray(forYouFeedCache.userId, userIds));
}

/** After `followerId` follows or unfollows someone. */
export async function afterFollowChange(followerId: string): Promise<void> {
  await dropForYouPages([followerId]).catch((err) => {
    logger.warn({ err, followerId }, "For You cache invalidation after follow failed");
  });
}

/** After a block or unblock between `a` and `b` (both sides see the change). */
export async function afterBlockChange(a: string, b: string): Promise<void> {
  await Promise.all([
    dropForYouPages([a, b]),
    forgetViewerBlocksMemo(a, b),
  ]).catch((err) => {
    logger.warn({ err, a, b }, "Cache invalidation after block change failed");
  });
}
