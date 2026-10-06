/**
 * "<Brand> is live" — tells a seller's followers the moment they go live.
 *
 * One in-app Activity row + push per follower through publishNotification
 * (which already applies "See less" mutes, notification prefs and push
 * delivery). Sent in bounded batches so a seller with a large following
 * never opens thousands of concurrent queries. Followers who blocked the
 * seller (or were blocked by them) and suspended accounts are skipped.
 * Tapping it opens the live (`targetType: "live_stream"` → /buyer-live).
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { publishNotification } from "../routes/notifications-feed";
import { logger } from "./logger";

const BATCH = 50;

export type GoLiveNotifyResult = { followers: number; sent: number; errors: number };

export async function notifyFollowersSellerIsLive(stream: {
  id: string;
  sellerId: string;
  title: string;
  thumbnailUrl?: string | null;
}): Promise<GoLiveNotifyResult> {
  const [seller] = await db.execute(sql`
    SELECT display_name, brand_name, username, profile_image_url FROM users WHERE clerk_id = ${stream.sellerId} LIMIT 1
  `).then((r) => r.rows as any[]);
  const name: string = seller?.brand_name || seller?.display_name || seller?.username || "A brand you follow";

  const followers = await db.execute(sql`
    SELECT f.follower_id AS id
    FROM follows f
    JOIN users u ON u.clerk_id = f.follower_id
    WHERE f.following_id = ${stream.sellerId}
      AND f.follower_id <> ${stream.sellerId}
      AND u.suspended_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = f.follower_id AND b.blocked_id = ${stream.sellerId})
           OR (b.blocker_id = ${stream.sellerId} AND b.blocked_id = f.follower_id)
      )
  `).then((r) => (r.rows as Array<{ id: string }>).map((row) => row.id));

  let sent = 0;
  let errors = 0;
  for (let i = 0; i < followers.length; i += BATCH) {
    const results = await Promise.allSettled(followers.slice(i, i + BATCH).map((userId) =>
      publishNotification({
        userId,
        category: "social",
        type: "live_started",
        title: `${name} is live`,
        body: stream.title,
        actorId: stream.sellerId,
        actorName: name,
        actorHandle: seller?.username ?? undefined,
        targetId: stream.id,
        targetType: "live_stream",
        targetImageUrl: stream.thumbnailUrl ?? seller?.profile_image_url ?? null,
        cta: "Watch",
        analyticsOwnerId: stream.sellerId,
      })));
    for (const r of results) {
      if (r.status === "fulfilled") sent += 1;
      else errors += 1;
    }
  }
  if (errors > 0) logger.warn({ streamId: stream.id, errors }, "Some go-live notifications failed");
  return { followers: followers.length, sent, errors };
}
