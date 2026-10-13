import { and, eq, gt, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { db, drops, follows, orders } from "@workspace/db";
import { publishNotification } from "../routes/notifications-feed";

export interface EarlyAccessPushResult {
  dropId: string;
  sent: number;
  errors: number;
}

/** "the next hour" / "the next 30 minutes" / "the next 2 hours". */
export function earlyAccessWindowLabel(minutes: number): string {
  if (minutes === 60) return "the next hour";
  if (minutes % 60 === 0) return `the next ${minutes / 60} hours`;
  return `the next ${minutes} minutes`;
}

/**
 * Tells followers the moment their early-access window opens
 * (releaseAt − earlyAccessMinutes). Each drop is claimed once with a
 * conditional update, so overlapping workers never double-send. Members-only
 * drops only notify followers who can actually buy.
 */
export async function deliverDueEarlyAccessPushes(now = new Date()): Promise<EarlyAccessPushResult[]> {
  const due = await db.select({ id: drops.id }).from(drops).where(and(
    eq(drops.status, "active"),
    isNotNull(drops.releaseAt),
    gt(drops.earlyAccessMinutes, 0),
    isNull(drops.earlyAccessNotifiedAt),
    gt(drops.releaseAt, now),
    sql`${drops.releaseAt} - (${drops.earlyAccessMinutes} * interval '1 minute') <= ${now}`,
  ));

  const results: EarlyAccessPushResult[] = [];
  for (const { id } of due) {
    const [claimed] = await db.update(drops)
      .set({ earlyAccessNotifiedAt: now })
      .where(and(eq(drops.id, id), isNull(drops.earlyAccessNotifiedAt)))
      .returning({
        id: drops.id,
        name: drops.name,
        ownerId: drops.ownerId,
        earlyAccessMinutes: drops.earlyAccessMinutes,
        membersOnly: drops.membersOnly,
      });
    if (!claimed) continue;

    let followerIds = (await db.select({ userId: follows.followerId }).from(follows)
      .where(eq(follows.followingId, claimed.ownerId))).map((row) => row.userId);
    if (claimed.membersOnly && followerIds.length > 0) {
      const members = await db.selectDistinct({ buyerId: orders.buyerId }).from(orders).where(and(
        eq(orders.ownerId, claimed.ownerId),
        inArray(orders.buyerId, followerIds),
        isNotNull(orders.paidAt),
        ne(orders.status, "cancelled"),
        lt(orders.refundedCents, sql`${orders.totalCents}`),
      ));
      const memberIds = new Set(members.map((row) => row.buyerId));
      followerIds = followerIds.filter((followerId) => memberIds.has(followerId));
    }

    const settled = await Promise.allSettled(followerIds.map((userId) => publishNotification({
      userId,
      category: "drops",
      type: "drop_early_access",
      title: "Early access is open",
      body: `${claimed.name} is open to followers for ${earlyAccessWindowLabel(claimed.earlyAccessMinutes)}.`,
      targetId: claimed.id,
      targetType: "drop",
      cta: "Shop the drop",
      analyticsOwnerId: claimed.ownerId,
      pushChannelId: "drops",
      pushKind: "promotional",
    })));
    const sent = settled.filter((r) => r.status === "fulfilled").length;
    results.push({ dropId: claimed.id, sent, errors: settled.length - sent });
  }
  return results;
}
