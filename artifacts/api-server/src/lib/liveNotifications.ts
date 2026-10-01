/**
 * "Live started" alerts to a seller's followers. Called fire-and-forget from
 * POST /api/live/start; the unique (user, type, stream) feed index makes a
 * retried fan-out idempotent, and publishNotification applies each
 * follower's own push / in-app switches and quiet hours.
 */
import { and, eq, or, sql } from "drizzle-orm";
import { blocks, db, follows, users } from "@workspace/db";
import { publishNotification } from "../routes/notifications-feed";
import { logger } from "./logger";

const FANOUT_CHUNK = 50;

export async function notifyFollowersLiveStarted(input: {
  streamId: string;
  sellerId: string;
  title: string;
}): Promise<{ followers: number }> {
  const [seller] = await db
    .select({ brandName: users.brandName, displayName: users.displayName, name: users.name })
    .from(users)
    .where(eq(users.clerkId, input.sellerId))
    .limit(1);
  const sellerName = seller?.brandName || seller?.displayName || seller?.name || "A brand you follow";

  const rows = await db
    .select({ userId: follows.followerId })
    .from(follows)
    .where(and(
      eq(follows.followingId, input.sellerId),
      sql`NOT EXISTS (
        SELECT 1 FROM ${blocks}
        WHERE (${blocks.blockerId} = ${follows.followerId} AND ${blocks.blockedId} = ${input.sellerId})
           OR (${blocks.blockerId} = ${input.sellerId} AND ${blocks.blockedId} = ${follows.followerId})
      )`,
    ));
  const followerIds = [...new Set(rows.map((row) => row.userId))];

  for (let i = 0; i < followerIds.length; i += FANOUT_CHUNK) {
    const results = await Promise.allSettled(followerIds.slice(i, i + FANOUT_CHUNK).map((userId) =>
      publishNotification({
        userId,
        category: "live",
        type: "live_started",
        title: `${sellerName} is live`,
        body: input.title,
        actorId: input.sellerId,
        targetId: input.streamId,
        targetType: "live",
        cta: "Watch now",
        analyticsOwnerId: input.sellerId,
        pushChannelId: "drops",
      }),
    ));
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed > 0) logger.warn({ streamId: input.streamId, failed }, "Live-started notification fan-out had failures");
  }
  return { followers: followerIds.length };
}
