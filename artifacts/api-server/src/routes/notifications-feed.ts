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
import { sendPushToUser, type PushEventCategory } from "../lib/push";

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
  pushCategory?: PushEventCategory;
  pushSound?: string | null;
  pushChannelId?: string;
}): Promise<void> {
  await db.insert(notificationsFeed).values({
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
  });
  const inferredCategory: PushEventCategory | undefined = n.pushCategory
    ?? (n.category === "social" ? "social"
      : n.category === "message" || n.category === "messages" ? "message"
      : n.category === "order" ? "order"
      : n.category === "drop" || n.category === "drops" ? "drop"
      : n.category === "production" ? "production"
      : n.category === "payout" || n.category === "finance" ? "payout"
      : n.category === "dispute" || n.category === "disputes" ? "dispute"
      : undefined);
  if (inferredCategory) {
    await sendPushToUser(n.userId, {
      title: n.title,
      body: n.body ?? "",
      data: {
        type: n.type,
        targetId: n.targetId,
        targetType: n.targetType,
        cta: n.cta,
      },
      sound: n.pushSound,
      channelId: n.pushChannelId,
    }, inferredCategory);
  }
}

export default buyerRouter;
