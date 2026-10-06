import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, dropAlertSubscriptions, dropBroadcasts, drops, follows } from "@workspace/db";
import { publishNotification } from "../routes/notifications-feed";

export interface DropBroadcastResult {
  sent: number;
  errors: number;
  followers: number;
}

/**
 * Claim and deliver a drop broadcast.
 *
 * The insert is the cross-process idempotency boundary shared by the manual
 * endpoint and the launch-time worker. A unique drop_id means only one of
 * them can deliver a notification for a drop.
 */
export async function deliverDropBroadcast(
  dropId: string,
  sellerId: string,
  options?: { scheduledNow?: Date },
): Promise<DropBroadcastResult | null> {
  const claimedDrop = await db.transaction(async (tx) => {
    const [drop] = await tx
      .select({
        id: drops.id,
        name: drops.name,
        status: drops.status,
        releaseAt: drops.releaseAt,
        scheduledBroadcastAt: drops.scheduledBroadcastAt,
      })
      .from(drops)
      .where(and(eq(drops.id, dropId), eq(drops.ownerId, sellerId)))
      .for("update")
      .limit(1);
    if (!drop || drop.status !== "active") return null;

    if (options?.scheduledNow) {
      const now = options.scheduledNow.getTime();
      if (
        !drop.releaseAt ||
        drop.releaseAt.getTime() > now ||
        !drop.scheduledBroadcastAt ||
        drop.scheduledBroadcastAt.getTime() > now
      ) {
        return null;
      }
    }

    // A claimed broadcast is no longer pending. Clear the schedule under the
    // same row lock used by scheduling so the UI cannot retain stale state.
    await tx.update(drops)
      .set({ scheduledBroadcastAt: null, updatedAt: new Date() })
      .where(and(eq(drops.id, drop.id), eq(drops.ownerId, sellerId)));

    const [inserted] = await tx
      .insert(dropBroadcasts)
      .values({ dropId: drop.id, sellerId, sentCount: 0 })
      .onConflictDoNothing()
      .returning({ id: dropBroadcasts.id });
    return inserted ? { ...drop, claimId: inserted.id } : null;
  });
  if (!claimedDrop) return null;

  // Notify-me subscribers not yet alerted are covered by this broadcast; the
  // claim (notified_at) keeps deliverDropLaunchAlerts from pushing them again,
  // and subscribers it already alerted aren't pushed twice.
  const alreadyAlerted = new Set((await db.select({ userId: dropAlertSubscriptions.userId })
    .from(dropAlertSubscriptions)
    .where(and(eq(dropAlertSubscriptions.dropId, claimedDrop.id), isNotNull(dropAlertSubscriptions.notifiedAt))))
    .map((row) => row.userId));
  const followerRows = (await db.select({ userId: follows.followerId }).from(follows)
    .where(eq(follows.followingId, sellerId)))
    .filter((row) => !alreadyAlerted.has(row.userId));
  const alertRows = await db.update(dropAlertSubscriptions)
    .set({ notifiedAt: new Date() })
    .where(and(eq(dropAlertSubscriptions.dropId, claimedDrop.id), isNull(dropAlertSubscriptions.notifiedAt)))
    .returning({ userId: dropAlertSubscriptions.userId });
  const followerIds = [...new Set([...followerRows, ...alertRows].map((row) => row.userId))];

  if (followerIds.length === 0) {
    return { sent: 0, errors: 0, followers: 0 };
  }

  const results = await Promise.allSettled(followerIds.map((followerId) =>
    publishNotification({
      userId: followerId,
      category: "drops",
      type: "drop_live",
      title: "Drop is live!",
      body: `${claimedDrop.name} is available now — limited stock. Tap to shop.`,
      targetId: claimedDrop.id,
      targetType: "drop",
      cta: "Shop the drop",
      analyticsOwnerId: sellerId,
      pushChannelId: "drops",
    })
  ));
  const sent = results.filter((result) => result.status === "fulfilled").length;
  const errors = results.length - sent;

  await db.update(dropBroadcasts)
    .set({ sentCount: sent })
    .where(eq(dropBroadcasts.id, claimedDrop.claimId));

  return { sent, errors, followers: followerIds.length };
}
/** Drops that went live longer ago than this are not alerted retroactively. */
const LAUNCH_ALERT_LOOKBACK_HOURS = 24;

/**
 * Pushes "Drop is live" to everyone who tapped Notify me, when the drop's
 * releaseAt arrives. Before this, subscribers were only reached if the seller
 * separately scheduled or sent a follower broadcast. Each subscription is
 * claimed (notified_at) in the same statement that selects it, so
 * overlapping workers never double-send.
 */
export async function deliverDropLaunchAlerts(now = new Date()): Promise<number> {
  const claimed = await db.execute(sql`
    UPDATE drop_alert_subscriptions s
    SET notified_at = ${now}
    FROM drops d
    WHERE s.drop_id = d.id
      AND s.notified_at IS NULL
      AND d.status = 'active'
      AND d.release_at IS NOT NULL
      AND d.release_at <= ${now}
      AND d.release_at > ${new Date(now.getTime() - LAUNCH_ALERT_LOOKBACK_HOURS * 60 * 60 * 1000)}
      AND (d.ends_at IS NULL OR d.ends_at > ${now})
    RETURNING s.user_id, d.id AS drop_id, d.name AS drop_name, d.owner_id
  `);
  const rows = ((claimed as unknown as { rows?: Array<{ user_id: string; drop_id: string; drop_name: string; owner_id: string }> }).rows ?? []);
  const results = await Promise.allSettled(rows.map((row) =>
    publishNotification({
      userId: row.user_id,
      category: "drops",
      type: "drop_live",
      title: "Drop is live!",
      body: `${row.drop_name} is available now — limited stock. Tap to shop.`,
      targetId: row.drop_id,
      targetType: "drop",
      cta: "Shop the drop",
      analyticsOwnerId: row.owner_id,
      pushChannelId: "drops",
    })
  ));
  return results.filter((result) => result.status === "fulfilled").length;
}
