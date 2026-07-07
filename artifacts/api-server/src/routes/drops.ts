import { Router } from "express";
import { db, drops, orders, customers } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

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

export default router;
