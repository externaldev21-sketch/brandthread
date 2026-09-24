import { Router } from "express";
import {
  db,
  drops,
  orders,
  customers,
  follows,
  dropAlertSubscriptions,
  dropBroadcasts,
} from "@workspace/db";
import { eq, desc, and, notExists } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { deliverDropBroadcast } from "../lib/dropBroadcast";
import {
  defaultFulfillmentDeadline, failDrop, validateFulfillmentDeadline,
} from "../lib/money/dropLifecycle";
import { maybeCompleteDrop } from "../lib/money/escrow";

const router = Router();
router.use(requireAuth);

const dropFields = {
  id: drops.id,
  ownerId: drops.ownerId,
  name: drops.name,
  type: drops.type,
  status: drops.status,
  releaseAt: drops.releaseAt,
  scheduledBroadcastAt: drops.scheduledBroadcastAt,
  estimatedShipDate: drops.estimatedShipDate,
  totalCollectedCents: drops.totalCollectedCents,
  orderCount: drops.orderCount,
  mfgProgress: drops.mfgProgress,
  payoutStatus: drops.payoutStatus,
  estimatedPayoutDate: drops.estimatedPayoutDate,
  stripePayoutId: drops.stripePayoutId,
  escrowState: drops.escrowState,
  fulfillmentDeadlineAt: drops.fulfillmentDeadlineAt,
  escrowFailedAt: drops.escrowFailedAt,
  escrowFailureReason: drops.escrowFailureReason,
  createdAt: drops.createdAt,
  updatedAt: drops.updatedAt,
};
async function getBroadcastAudience(sellerId: string, dropId: string): Promise<string[]> {
  const [followerRows, alertRows] = await Promise.all([
    db.select({ userId: follows.followerId }).from(follows).where(eq(follows.followingId, sellerId)),
    db.select({ userId: dropAlertSubscriptions.userId }).from(dropAlertSubscriptions)
      .where(eq(dropAlertSubscriptions.dropId, dropId)),
  ]);

  return [...new Set([...followerRows, ...alertRows].map((row) => row.userId))];
}

// GET /api/drops
router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const rows = await db
    .select({
      ...dropFields,
      broadcastSentAt: dropBroadcasts.sentAt,
    })
    .from(drops)
    .leftJoin(
      dropBroadcasts,
      and(
        eq(dropBroadcasts.dropId, drops.id),
        eq(dropBroadcasts.sellerId, ownerId),
      ),
    )
    .where(eq(drops.ownerId, ownerId))
    .orderBy(desc(drops.createdAt));
  res.json(rows);
});

// POST /api/drops
router.post("/", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { name, type, estimatedShipDate, estimatedPayoutDate, fulfillmentDeadlineAt } = req.body;
  if (!name || typeof name !== "string") { res.status(400).json({ error: "name required" }); return; }
  if (!["pre-order", "pre-made"].includes(type)) {
    res.status(400).json({ error: "type must be 'pre-order' or 'pre-made'" }); return;
  }
  const shipDate = estimatedShipDate ? new Date(estimatedShipDate) : undefined;
  if (shipDate && Number.isNaN(shipDate.valueOf())) {
    res.status(400).json({ error: "estimatedShipDate must be a valid ISO date" }); return;
  }
  // Pre-order money is held by Brandthread until each order ships, and is
  // refunded automatically if unshipped orders remain after the deadline.
  let deadline: Date | undefined;
  if (type === "pre-order") {
    deadline = fulfillmentDeadlineAt
      ? new Date(fulfillmentDeadlineAt)
      : defaultFulfillmentDeadline({ estimatedShipDate: shipDate ?? null });
    const deadlineError = validateFulfillmentDeadline(deadline);
    if (deadlineError) { res.status(400).json({ error: deadlineError, code: "INVALID_DEADLINE" }); return; }
  }
  // Pre Order funds are held until shipped; Pre Made follows standard payout schedule
  const payoutStatus = type === "pre-order" ? "held" : "pending";

  const [drop] = await db.insert(drops).values({
    ownerId,
    name,
    type,
    payoutStatus,
    estimatedShipDate: shipDate,
    estimatedPayoutDate: estimatedPayoutDate ? new Date(estimatedPayoutDate) : undefined,
    ...(type === "pre-order" ? { escrowState: "collecting", fulfillmentDeadlineAt: deadline } : {}),
  }).returning();
  res.status(201).json(drop);
});

// GET /api/drops/:id
router.get("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [drop] = await db
    .select({
      ...dropFields,
      broadcastSentAt: dropBroadcasts.sentAt,
    })
    .from(drops)
    .leftJoin(
      dropBroadcasts,
      and(
        eq(dropBroadcasts.dropId, drops.id),
        eq(dropBroadcasts.sellerId, ownerId),
      ),
    )
    .where(and(eq(drops.id, req.params.id), eq(drops.ownerId, ownerId)))
    .limit(1);
  if (!drop) { res.status(404).json({ error: "Not found" }); return; }
  const dropOrders = await db
    .select({
      id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
      totalCents: orders.totalCents, createdAt: orders.createdAt,
      customerName: customers.name,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .where(and(eq(orders.dropId, drop.id), eq(orders.ownerId, ownerId)))
    .orderBy(desc(orders.createdAt))
    .limit(20);
  res.json({ ...drop, orders: dropOrders });
});

// PATCH /api/drops/:id
router.patch("/:id", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;

  // payoutStatus / stripePayoutId are derived from real money state and are
  // no longer writable by the seller.
  const {
    name, status, mfgProgress, estimatedShipDate,
    scheduledBroadcastAt, fulfillmentDeadlineAt,
  } = req.body;
  const scheduleWasProvided = Object.prototype.hasOwnProperty.call(req.body, "scheduledBroadcastAt");

  // Validate mfgProgress range
  if (mfgProgress !== undefined && (!Number.isInteger(mfgProgress) || mfgProgress < 0 || mfgProgress > 100)) {
    res.status(400).json({ error: "mfgProgress must be 0–100" }); return;
  }
  const validStatuses = ["draft", "active", "closed", "fulfilled"];
  if (status && !validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` }); return;
  }

  const [currentDrop] = await db.select({
    id: drops.id,
    status: drops.status,
    releaseAt: drops.releaseAt,
    escrowState: drops.escrowState,
  }).from(drops)
    .where(and(eq(drops.id, req.params.id), eq(drops.ownerId, ownerId)))
    .limit(1);
  if (!currentDrop) { res.status(404).json({ error: "Not found" }); return; }

  let deadline: Date | undefined;
  if (fulfillmentDeadlineAt !== undefined) {
    if (!currentDrop.escrowState || !["collecting", "production", "fulfilling"].includes(currentDrop.escrowState)) {
      res.status(409).json({ error: "This drop has no open preorder deadline to change", code: "DEADLINE_LOCKED" }); return;
    }
    deadline = new Date(fulfillmentDeadlineAt);
    const deadlineError = validateFulfillmentDeadline(deadline);
    if (deadlineError) { res.status(400).json({ error: deadlineError, code: "INVALID_DEADLINE" }); return; }
  }

  let scheduledBroadcastDate: Date | null | undefined;
  if (scheduleWasProvided) {
    if (scheduledBroadcastAt === null) {
      scheduledBroadcastDate = null;
    } else {
      if (typeof scheduledBroadcastAt !== "string") {
        res.status(400).json({ error: "scheduledBroadcastAt must be an ISO date or null" }); return;
      }
      const parsed = new Date(scheduledBroadcastAt);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "scheduledBroadcastAt must be a valid ISO date" }); return;
      }
      const effectiveStatus = status ?? currentDrop.status;
      if (effectiveStatus !== "active") {
        res.status(400).json({ error: "Only active drops can schedule a follower notification.", code: "DROP_NOT_ACTIVE" }); return;
      }
      if (!currentDrop.releaseAt || currentDrop.releaseAt.getTime() <= Date.now()) {
        res.status(400).json({ error: "Only drops with a future releaseAt can schedule a launch notification.", code: "DROP_RELEASE_NOT_FUTURE" }); return;
      }
      if (parsed.getTime() !== currentDrop.releaseAt.getTime()) {
        res.status(400).json({ error: "scheduledBroadcastAt must match the drop releaseAt.", code: "SCHEDULE_MUST_MATCH_RELEASE" }); return;
      }
      const [existingBroadcast] = await db.select({ id: dropBroadcasts.id })
        .from(dropBroadcasts)
        .where(eq(dropBroadcasts.dropId, currentDrop.id))
        .limit(1);
      if (existingBroadcast) {
        res.status(409).json({ error: "This drop has already been broadcast to your followers.", code: "ALREADY_BROADCAST" }); return;
      }
      scheduledBroadcastDate = parsed;
    }
  }

  const updateConditions = [
    eq(drops.id, req.params.id),
    eq(drops.ownerId, ownerId),
  ];
  if (scheduledBroadcastDate) {
    updateConditions.push(notExists(
      db.select({ id: dropBroadcasts.id })
        .from(dropBroadcasts)
        .where(eq(dropBroadcasts.dropId, currentDrop.id)),
    ));
  }

  const [updated] = await db.update(drops)
    .set({
      ...(name             && { name }),
      ...(status           && { status }),
      ...(mfgProgress      !== undefined && { mfgProgress }),
      ...(estimatedShipDate && { estimatedShipDate: new Date(estimatedShipDate) }),
      ...(deadline && { fulfillmentDeadlineAt: deadline }),
      ...(scheduleWasProvided && { scheduledBroadcastAt: scheduledBroadcastDate }),
      updatedAt: new Date(),
    })
    .where(and(...updateConditions))
    .returning();
  if (!updated) {
    if (scheduledBroadcastDate) {
      res.status(409).json({ error: "This drop has already been broadcast to your followers.", code: "ALREADY_BROADCAST" }); return;
    }
    res.status(404).json({ error: "Not found" }); return;
  }
  // Closing sales can complete a drop whose orders have all shipped.
  if (status === "closed" || status === "fulfilled") await maybeCompleteDrop(db, updated.id);
  res.json(updated);
});

// ─── POST /api/drops/:id/cancel-preorders ────────────────────────────────────
// The seller cancels a preorder drop: every buyer whose order has not
// shipped is refunded in full, automatically. Orders already shipped keep
// their release. Requires { confirm: true } because it cannot be undone.
router.post("/:id/cancel-preorders", requireRole("manager"), async (req, res): Promise<void> => {
  const sellerId = (req as any).clerkUserId as string;
  if (req.body?.confirm !== true) {
    res.status(400).json({ error: "Send { confirm: true } to refund every unshipped preorder", code: "CONFIRM_REQUIRED" });
    return;
  }
  const [drop] = await db.select({ id: drops.id, type: drops.type, escrowState: drops.escrowState })
    .from(drops).where(and(eq(drops.id, req.params.id), eq(drops.ownerId, sellerId))).limit(1);
  if (!drop) { res.status(404).json({ error: "Drop not found" }); return; }
  if (drop.type !== "pre-order" || !drop.escrowState) {
    res.status(409).json({ error: "Only preorder drops hold buyer money", code: "NOT_A_PREORDER_DROP" }); return;
  }
  if (drop.escrowState === "completed" || drop.escrowState === "failed") {
    res.status(409).json({ error: `This drop is already ${drop.escrowState}`, code: "DROP_FINISHED" }); return;
  }
  try {
    const summary = await failDrop(drop.id, "seller_cancelled", sellerId);
    res.json(summary);
  } catch (err) {
    req.log.error({ err, dropId: drop.id }, "Failed to cancel preorder drop");
    res.status(500).json({ error: "Could not cancel the drop. Refunds will be retried automatically." });
  }
});

// ─── GET /api/drops/:id/broadcast-preview ────────────────────────────────────
// Return the exact number of unique recipients for the drop broadcast without
// sending anything. The audience matches the POST broadcast route.
router.get("/:id/broadcast-preview", async (req, res): Promise<void> => {
  const sellerId = (req as any).clerkUserId as string;

  // Verify the drop belongs to this seller
  const [drop] = await db
    .select({ id: drops.id, name: drops.name, status: drops.status })
    .from(drops)
    .where(and(eq(drops.id, req.params.id), eq(drops.ownerId, sellerId)))
    .limit(1);
  if (!drop) {
    res.status(404).json({ error: "Drop not found" });
    return;
  }

  const audience = await getBroadcastAudience(sellerId, drop.id);
  res.json({ followers: audience.length });
});

// ─── POST /api/drops/:id/broadcast ───────────────────────────────────────────
// Send a push notification to all followers announcing a live/active drop.
// Idempotent: each drop can only be broadcast once (unique drop_id constraint).
router.post("/:id/broadcast", requireRole("manager"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;

  // Verify the drop belongs to this seller
  const [drop] = await db
    .select({ id: drops.id, name: drops.name, status: drops.status })
    .from(drops)
    .where(and(eq(drops.id, req.params.id), eq(drops.ownerId, sellerId)))
    .limit(1);
  if (!drop) return res.status(404).json({ error: "Drop not found" });

  // Only active drops may be broadcast — draft/closed/fulfilled should not trigger live notifications
  if (drop.status !== "active") {
    return res.status(400).json({ error: "Only active drops can be broadcast to followers.", code: "DROP_NOT_ACTIVE" });
  }

  const result = await deliverDropBroadcast(drop.id, sellerId);
  if (!result) {
    return res.status(409).json({ error: "This drop has already been broadcast to your followers.", code: "ALREADY_BROADCAST" });
  }
  return res.json({ ok: true, ...result });
});

export default router;
