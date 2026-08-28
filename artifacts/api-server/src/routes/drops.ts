import { Router } from "express";
import { db, drops, orders, customers, follows, dropAlertSubscriptions, dropBroadcasts } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { sendPushToUser } from "../lib/push";

const router = Router();
router.use(requireAuth);

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
  const { name, status, mfgProgress, payoutStatus, estimatedShipDate, stripePayoutId } = req.body;

  // Validate mfgProgress range
  if (mfgProgress !== undefined && (!Number.isInteger(mfgProgress) || mfgProgress < 0 || mfgProgress > 100)) {
    res.status(400).json({ error: "mfgProgress must be 0–100" }); return;
  }
  const validStatuses = ["draft", "active", "closed", "fulfilled"];
  if (status && !validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` }); return;
  }

  const [updated] = await db.update(drops)
    .set({
      ...(name             && { name }),
      ...(status           && { status }),
      ...(mfgProgress      !== undefined && { mfgProgress }),
      ...(payoutStatus     && { payoutStatus }),
      ...(estimatedShipDate && { estimatedShipDate: new Date(estimatedShipDate) }),
      ...(stripePayoutId   && { stripePayoutId }),
      updatedAt: new Date(),
    })
    .where(and(eq(drops.id, req.params.id), eq(drops.ownerId, ownerId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
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

  // Check if already broadcast (one broadcast per drop)
  const [existing] = await db
    .select({ id: dropBroadcasts.id })
    .from(dropBroadcasts)
    .where(eq(dropBroadcasts.dropId, drop.id))
    .limit(1);
  if (existing) {
    return res.status(409).json({ error: "This drop has already been broadcast to your followers.", code: "ALREADY_BROADCAST" });
  }

  // Notify both followers and buyers who explicitly requested this drop alert.
  const [followerRows, alertRows] = await Promise.all([
    db.select({ userId: follows.followerId }).from(follows).where(eq(follows.followingId, sellerId)),
    db.select({ userId: dropAlertSubscriptions.userId }).from(dropAlertSubscriptions)
      .where(eq(dropAlertSubscriptions.dropId, drop.id)),
  ]);
  const followerIds = [...new Set([...followerRows, ...alertRows].map((row) => row.userId))];

  if (followerIds.length === 0) {
    return res.json({ ok: true, sent: 0, errors: 0, followers: 0, message: "No followers to notify yet." });
  }

  const results = await Promise.allSettled(followerIds.map((followerId) =>
    sendPushToUser(followerId, {
      title: "Drop is live!",
      body: `${drop.name} is available now — limited stock. Tap to shop.`,
      data: { dropId: drop.id, sellerId, type: "drop_live" },
    }, "drop")
  ));
  const sent = results.filter((result) => result.status === "fulfilled").length;
  const errors = results.length - sent;

  // Record the broadcast (idempotency key)
  await db.insert(dropBroadcasts).values({
    dropId:    drop.id,
    sellerId,
    sentCount: sent,
  }).onConflictDoNothing();

  return res.json({ ok: true, sent, errors, followers: followerIds.length });
});

export default router;
