import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, notificationDeliveries, notificationEvents, notificationsFeed } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { recordNotificationEvent, type NotificationEventType } from "../lib/push";

const router = Router();
router.use(requireAuth);

const EVENT_TYPES = new Set<NotificationEventType>(["receipt", "open", "tap"]);

// POST /api/notifications/events
// Client event IDs are deliberately not trusted as ownership identifiers. The
// server derives the dedupe key from the authenticated user and event fields.
router.post("/events", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const body = req.body as {
    notificationId?: unknown;
    eventType?: unknown;
    occurredAt?: unknown;
  };
  const notificationId = typeof body.notificationId === "string"
    ? body.notificationId.trim()
    : "";
  const eventType = typeof body.eventType === "string"
    ? body.eventType as NotificationEventType
    : null;

  if (!notificationId || notificationId.length > 200 || !eventType || !EVENT_TYPES.has(eventType)) {
    return res.status(400).json({ error: "notificationId and a valid eventType are required" });
  }

  // A notification can be an in-app-only row or a push delivery. Either way,
  // an authenticated user may record events only for their own notifications.
  const [ownedFeed, ownedDelivery] = await Promise.all([
    db.select({ id: notificationsFeed.id })
      .from(notificationsFeed)
      .where(and(eq(notificationsFeed.id, notificationId), eq(notificationsFeed.userId, userId)))
      .limit(1),
    db.select({ id: notificationDeliveries.id, ownerId: notificationDeliveries.ownerId })
      .from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.notificationId, notificationId), eq(notificationDeliveries.userId, userId)))
      .limit(1),
  ]);
  if (ownedFeed.length === 0 && ownedDelivery.length === 0) {
    return res.status(404).json({ error: "Notification not found" });
  }

  const parsedDate = typeof body.occurredAt === "string" ? new Date(body.occurredAt) : null;
  const occurredAt = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : undefined;
  const inserted = await recordNotificationEvent({
    userId,
    ownerId: ownedDelivery[0]?.ownerId ?? userId,
    notificationId,
    eventType,
    occurredAt,
  });
  return res.json({ ok: true, recorded: inserted });
});

export default router;