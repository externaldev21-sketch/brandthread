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
import { deliverDropBroadcast } from "../lib/dropBroadcast";

const router = Router();
router.use(requireAuth);

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
  const rows = await db.select().from(drops).where(eq(drops.ownerId, ownerId)).orderBy(desc(drops.createdAt));
  res.json(rows);
});

// POST /api/drops
router.post("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { name, type, estimatedShipDate, estimatedPayoutDate } = req.body;
  if (!name || typeof name !== "string") { res.status(400).json({ error: "name required" }); return; }
  if (!["pre-order", "pre-made"].includes(type)) {
    res.status(400).json({ error: "type must be 'pre-order' or 'pre-made'" }); return;
  }
  // Pre Order funds are held in escrow until shipped; Pre Made follows standard payout schedule
  const payoutStatus = type === "pre-order" ? "held" : "pending";

  const [drop] = await db.insert(drops).values({
    ownerId,
    name,
    type,
    payoutStatus,
    estimatedShipDate: estimatedShipDate ? new Date(estimatedShipDate) : undefined,
    estimatedPayoutDate: estimatedPayoutDate ? new Date(estimatedPayoutDate) : undefined,
  }).returning();
  res.status(201).json(drop);
});

// GET /api/drops/:id
router.get("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [drop] = await db.select().from(drops)
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
router.patch("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const {
    name, status, mfgProgress, payoutStatus, estimatedShipDate, stripePayoutId,
    scheduledBroadcastAt,
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
  }).from(drops)
    .where(and(eq(drops.id, req.params.id), eq(drops.ownerId, ownerId)))
    .limit(1);
  if (!currentDrop) { res.status(404).json({ error: "Not found" }); return; }

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
      ...(payoutStatus     && { payoutStatus }),
      ...(estimatedShipDate && { estimatedShipDate: new Date(estimatedShipDate) }),
      ...(stripePayoutId   && { stripePayoutId }),
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
  res.json(updated);
});

// ─── GET /api/drops/:id/broadcast-preview ────────────────────────────────────
// Return the exact number of unique recipients for the drop broadcast without
// sending anything. The audience matches the POST broadcast route.
router.get("/:id/broadcast-preview", async (req, res): Promise<void> => {
  const sellerId = (req as any).clerkUserId as string;

  const [drop] = await db
    .select({ id: drops.id })
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
router.post("/:id/broadcast", async (req, res) => {
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
