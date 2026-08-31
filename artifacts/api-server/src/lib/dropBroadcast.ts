import { and, eq } from "drizzle-orm";
import { db, dropAlertSubscriptions, dropBroadcasts, drops, follows } from "@workspace/db";
import { sendPushToUser } from "./push";

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

  const [followerRows, alertRows] = await Promise.all([
    db.select({ userId: follows.followerId }).from(follows).where(eq(follows.followingId, sellerId)),
    db.select({ userId: dropAlertSubscriptions.userId }).from(dropAlertSubscriptions)
      .where(eq(dropAlertSubscriptions.dropId, claimedDrop.id)),
  ]);
  const followerIds = [...new Set([...followerRows, ...alertRows].map((row) => row.userId))];

  if (followerIds.length === 0) {
    return { sent: 0, errors: 0, followers: 0 };
  }

  const results = await Promise.allSettled(followerIds.map((followerId) =>
    sendPushToUser(followerId, {
      title: "Drop is live!",
      body: `${claimedDrop.name} is available now — limited stock. Tap to shop.`,
      data: { dropId: claimedDrop.id, sellerId, type: "drop_live" },
    }, "drop")
  ));
  const sent = results.filter((result) => result.status === "fulfilled").length;
  const errors = results.length - sent;

  await db.update(dropBroadcasts)
    .set({ sentCount: sent })
    .where(eq(dropBroadcasts.id, claimedDrop.claimId));

  return { sent, errors, followers: followerIds.length };
}