import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db, adminAnnouncements, notificationsFeed, users } from "@workspace/db";
import { sendPushToUser } from "../push";
import { logger } from "../logger";

export type Audience = "all" | "sellers" | "buyers";
export const AUDIENCES: readonly Audience[] = ["all", "sellers", "buyers"];

const BATCH = 500;
const PUSH_CONCURRENCY = 20;

function audienceFilter(audience: Audience) {
  const base = [isNull(users.deletedAt), isNull(users.suspendedAt), eq(users.isSystemAccount, false)];
  if (audience === "sellers") base.push(or(eq(users.accountType, "seller"), eq(users.accountType, "both"))!);
  if (audience === "buyers") base.push(or(eq(users.accountType, "buyer"), isNull(users.accountType))!);
  return base;
}

/** Recipients are counted up front so the admin sees the reach before/after sending. */
export async function countAudience(audience: Audience): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(users).where(and(...audienceFilter(audience)));
  return Number(row?.n ?? 0);
}

/**
 * Fans an announcement out to its audience in keyset-paginated batches:
 * an in-app row in the Activity feed and/or a device push per recipient.
 * Updates the announcement row with the outcome; never throws.
 */
export async function deliverAnnouncement(announcementId: string): Promise<void> {
  try {
    const [a] = await db.select().from(adminAnnouncements).where(eq(adminAnnouncements.id, announcementId)).limit(1);
    if (!a) return;
    let delivered = 0;
    let recipients = 0;
    let cursor = "";
    for (;;) {
      const batch = await db.select({ clerkId: users.clerkId }).from(users)
        .where(and(...audienceFilter(a.audience as Audience), gt(users.clerkId, cursor)))
        .orderBy(asc(users.clerkId)).limit(BATCH);
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.clerkId;
      recipients += batch.length;

      if (a.sendInApp) {
        await db.insert(notificationsFeed).values(batch.map((u) => ({
          userId: u.clerkId,
          category: "system",
          type: "announcement",
          title: a.title,
          body: a.body,
          targetId: a.id,
          targetType: "announcement",
        })));
        delivered += batch.length;
      }
      if (a.sendPush) {
        for (let i = 0; i < batch.length; i += PUSH_CONCURRENCY) {
          const sent = await Promise.all(batch.slice(i, i + PUSH_CONCURRENCY).map((u) =>
            sendPushToUser(u.clerkId, { title: a.title, body: a.body, data: { type: "announcement", announcementId: a.id } })
              .catch(() => false)));
          if (!a.sendInApp) delivered += sent.filter(Boolean).length;
        }
      }
    }
    await db.update(adminAnnouncements)
      .set({ status: "sent", recipientCount: recipients, deliveredCount: delivered, sentAt: new Date() })
      .where(eq(adminAnnouncements.id, announcementId));
  } catch (err) {
    logger.error({ err, announcementId }, "Announcement delivery failed");
    await db.update(adminAnnouncements).set({ status: "failed" }).where(eq(adminAnnouncements.id, announcementId)).catch(() => {});
  }
}
