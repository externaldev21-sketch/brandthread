/**
 * In-app notification feed (separate from push token registration).
 * GET    /api/buyer/notifications               — list, newest first
 *        ?limit=&offset=  page through the feed (limit defaults to 30, max 100).
 *                         With neither param the legacy single page of 100 is
 *                         returned so existing callers keep their behaviour.
 *        ?filter=orders|social  Activity Center filter chips.
 * GET    /api/buyer/notifications/unread-count  — { count } for bell badges
 * PATCH  /api/buyer/notifications/read-all      — mark all as read
 * PATCH  /api/buyer/notifications/:id/read      — mark one as read
 * DELETE /api/buyer/notifications/:id           — delete one
 * POST   /api/internal/notifications            — publish a notification (server-to-user)
 */
import { Router } from "express";
import { db, notificationsFeed } from "@workspace/db";
import { eq, and, desc, inArray, or, sql, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";
import {
  normalizePushEventCategory,
  sendPushToUser,
  type PushEventCategory,
} from "../lib/push";

export const router = Router();

// ─── Buyer-facing routes (all require auth) ───────────────────────────────────
const buyerRouter = Router();
buyerRouter.use(requireAuth);

const objectStorage = new ObjectStorageService();
/** Signed thumbnail URLs outlive a normal browsing session. */
const THUMBNAIL_URL_TTL_SEC = 60 * 60;

type FeedRow = typeof notificationsFeed.$inferSelect;

export function adapt(n: FeedRow, targetImageUrl: string | null = n.targetImageUrl ?? null) {
  return {
    id:            n.id,
    category:      n.category,
    type:          n.type,
    title:         n.title,
    body:          n.body,
    isRead:        n.isRead,
    isMuted:       n.isMuted,
    actorId:       n.actorId      ?? undefined,
    actorName:     n.actorName    ?? undefined,
    actorHandle:   n.actorHandle  ?? undefined,
    actorInitials: n.actorInitials ?? undefined,
    actorColor:    n.actorColor   ?? undefined,
    targetId:      n.targetId     ?? undefined,
    targetType:    n.targetType   ?? undefined,
    targetImageUrl: targetImageUrl ?? undefined,
    cta:           n.cta          ?? undefined,
    createdAt:     n.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

/**
 * Thumbnails may be private object-storage paths (product photos). Sign them
 * per read so the client gets a working URL without the feed persisting an
 * expiring link. Any signing failure degrades to "no thumbnail".
 */
async function resolveTargetImage(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!value.startsWith("/objects/")) return null;
  try {
    return await objectStorage.getObjectEntityDownloadURL(value, THUMBNAIL_URL_TTL_SEC);
  } catch (err) {
    logger.debug({ err }, "Could not sign notification thumbnail");
    return null;
  }
}

/** Feed categories the Activity Center shows under "Orders". */
export const ORDER_ACTIVITY_CATEGORIES = ["orders", "order", "payout", "payouts", "payment", "production"] as const;
/** Inventory alerts are inserted without an orders category but belong there. */
export const ORDER_ACTIVITY_TYPES = ["low_stock", "out_of_stock"] as const;
/**
 * price_drop/back_in_stock/new_product are published under category "stock"
 * (artifacts/api-server/src/lib/stockNotifications.ts) or "social"
 * (activityEvents.ts), but are always a buyer "things you follow/saved"
 * event for the Activity Center's Social filter.
 */
export const SOCIAL_ACTIVITY_TYPES = ["price_drop", "back_in_stock", "waitlist_restock", "product_restocked", "new_product"] as const;

function filterCondition(filter: unknown): SQL | undefined {
  if (filter === "orders") {
    return or(
      inArray(notificationsFeed.category, [...ORDER_ACTIVITY_CATEGORIES]),
      inArray(notificationsFeed.type, [...ORDER_ACTIVITY_TYPES]),
    );
  }
  if (filter === "social") {
    return or(
      eq(notificationsFeed.category, "social"),
      inArray(notificationsFeed.type, [...SOCIAL_ACTIVITY_TYPES]),
    );
  }
  return undefined;
}

function parsePage(query: Record<string, unknown>): { limit: number; offset: number } {
  const hasLimit = query.limit !== undefined;
  const hasOffset = query.offset !== undefined;
  // Legacy callers (the original notifications screen) send no paging params
  // and expect the most recent 100 in one response.
  if (!hasLimit && !hasOffset) return { limit: 100, offset: 0 };
  const rawLimit = Number.parseInt(String(query.limit ?? ""), 10);
  const rawOffset = Number.parseInt(String(query.offset ?? ""), 10);
  return {
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 30,
    offset: Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0,
  };
}

buyerRouter.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { limit, offset } = parsePage(req.query as Record<string, unknown>);
  const filter = filterCondition(req.query.filter);
  const rows = await db.select().from(notificationsFeed)
    .where(filter ? and(eq(notificationsFeed.userId, userId), filter) : eq(notificationsFeed.userId, userId))
    .orderBy(desc(notificationsFeed.createdAt), desc(notificationsFeed.id))
    .limit(limit)
    .offset(offset);
  const images = await Promise.all(rows.map((row) => resolveTargetImage(row.targetImageUrl ?? null)));
  return res.json(rows.map((row, index) => adapt(row, images[index])));
});

buyerRouter.get("/unread-count", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const [row] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(notificationsFeed)
    .where(and(
      eq(notificationsFeed.userId, userId),
      eq(notificationsFeed.isRead, false),
      eq(notificationsFeed.isMuted, false),
    ));
  return res.json({ count: row?.count ?? 0 });
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
  actorId?:     string;
  targetImageUrl?: string | null;
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
      actorId:      n.actorId      ?? null,
      targetImageUrl: n.targetImageUrl ?? null,
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
        category: n.category,
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
