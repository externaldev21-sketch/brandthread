/**
 * In-app notification feed (separate from push token registration).
 * GET    /api/buyer/notifications               — list (newest first, max 100)
 * PATCH  /api/buyer/notifications/read-all      — mark all as read
 * PATCH  /api/buyer/notifications/:id/read      — mark one as read
 * DELETE /api/buyer/notifications/:id           — delete one
 * POST   /api/internal/notifications            — publish a notification (server-to-user)
 */
import { Router } from "express";
import { db, notificationsFeed } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  normalizePushEventCategory,
  sendPushToUser,
  type PushEventCategory,
} from "../lib/push";

export const router = Router();

// ─── Buyer-facing routes (all require auth) ───────────────────────────────────
const buyerRouter = Router();
buyerRouter.use(requireAuth);

function adapt(n: typeof notificationsFeed.$inferSelect) {
  return {
    id:            n.id,
    category:      n.category,
    type:          n.type,
    title:         n.title,
    body:          n.body,
    isRead:        n.isRead,
    isMuted:       n.isMuted,
    actorName:     n.actorName    ?? undefined,
    actorHandle:   n.actorHandle  ?? undefined,
    actorInitials: n.actorInitials ?? undefined,
    actorColor:    n.actorColor   ?? undefined,
    targetId:      n.targetId     ?? undefined,
    targetType:    n.targetType   ?? undefined,
    cta:           n.cta          ?? undefined,
    createdAt:     n.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

buyerRouter.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const rows = await db.select().from(notificationsFeed)
    .where(eq(notificationsFeed.userId, userId))
    .orderBy(desc(notificationsFeed.createdAt))
    .limit(100);
  return res.json(rows.map(adapt));
});

buyerRouter.patch("/read-all", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  await db.update(notificationsFeed).set({ isRead: true })
    .where(eq(notificationsFeed.userId, userId));
  return res.json({ ok: true });
});

buyerRouter.patch("/:id/read", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  await db.update(notificationsFeed).set({ isRead: true })
    .where(and(eq(notificationsFeed.id, req.params.id), eq(notificationsFeed.userId, userId)));
  return res.json({ ok: true });
});

buyerRouter.delete("/:id", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  await db.delete(notificationsFeed)
    .where(and(eq(notificationsFeed.id, req.params.id), eq(notificationsFeed.userId, userId)));
  return res.json({ ok: true });
});

// ─── Internal publisher (used by other routes, e.g. order status webhooks) ───

export async function publishNotification(n: {
  userId:       string;
  category:     string;
  type:         string;
  title:        string;
  body?:        string;
  actorName?:   string;
  actorHandle?: string;
  actorInitials?: string;
  actorColor?:  string;
  targetId?:    string;
  targetType?:  string;
  cta?:         string;
  analyticsOwnerId?: string;
  pushCategory?: PushEventCategory;
  pushSound?: string | null;
  pushChannelId?: string;
}): Promise<void> {
  const pushCategory = n.pushCategory ?? normalizePushEventCategory(n.category);

  const [notification] = await db
    .insert(notificationsFeed)
    .values({
      userId:       n.userId,
      category:     n.category,
      type:         n.type,
      title:        n.title,
      body:         n.body   ?? "",
      actorName:    n.actorName    ?? null,
      actorHandle:  n.actorHandle  ?? null,
      actorInitials: n.actorInitials ?? null,
      actorColor:   n.actorColor   ?? null,
      targetId:     n.targetId     ?? null,
      targetType:   n.targetType   ?? null,
      cta:          n.cta          ?? null,
    })
    // Order alerts are unique by seller, type, and order target. The
    // database partial unique index is the concurrency-safe idempotency
    // boundary for webhook retries.
    .onConflictDoNothing()
    .returning({ id: notificationsFeed.id });

  // Do not send a second push when the in-app notification already existed.
  if (!notification) return;

  if (pushCategory) {
    await sendPushToUser(n.userId, {
      title: n.title,
      body: n.body ?? "",
      data: {
        notificationId: notification.id,
        type: n.type,
        targetId: n.targetId,
        targetType: n.targetType,
        cta: n.cta,
      },
      sound: n.pushSound,
      channelId: n.pushChannelId,
    }, pushCategory, n.analyticsOwnerId);
  }
}

export default buyerRouter;
