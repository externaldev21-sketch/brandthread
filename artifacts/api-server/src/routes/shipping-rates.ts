import { Router } from "express";
import { db, shippingRates } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import crypto from "crypto";

const router = Router();

// Public endpoint — no auth required
// GET /api/shipping-rates/calculate?sellerId=X&subtotalCents=Y
router.get("/calculate", async (req, res) => {
  const { sellerId, subtotalCents } = req.query;

  if (!sellerId || subtotalCents === undefined) {
    res.status(400).json({ error: "sellerId and subtotalCents are required" });
    return;
  }

  const subtotal = parseInt(String(subtotalCents), 10);
  if (isNaN(subtotal) || subtotal < 0) {
    res.status(400).json({ error: "subtotalCents must be a non-negative integer" });
    return;
  }

  const [rate] = await db
    .select()
    .from(shippingRates)
    .where(and(eq(shippingRates.sellerId, String(sellerId)), eq(shippingRates.active, true)))
    .limit(1);

  if (!rate) {
    res.json({ shippingCents: 0, isFree: true, rateName: "Free Shipping" });
    return;
  }

  if (rate.freeAboveCents != null && subtotal >= rate.freeAboveCents) {
    const threshold = (rate.freeAboveCents / 100).toFixed(0);
    res.json({
      shippingCents: 0,
      isFree: true,
      rateName: `${rate.name} (Free above $${threshold})`,
    });
    return;
  }

  res.json({
    shippingCents: rate.flatRateCents,
    isFree: rate.flatRateCents === 0,
    rateName: rate.name,
  });
});

// All routes below require authentication
router.use(requireAuth);

// GET /api/shipping-rates — list all rates for the authenticated seller
router.get("/", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const rates = await db
    .select()
    .from(shippingRates)
    .where(eq(shippingRates.sellerId, sellerId));
  res.json(rates);
});

// POST /api/shipping-rates — create a new shipping rate
router.post("/", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { name, flatRateCents, freeAboveCents } = req.body;

  if (
    flatRateCents === undefined ||
    !Number.isInteger(flatRateCents) ||
    flatRateCents < 0
  ) {
    res.status(400).json({ error: "flatRateCents must be a non-negative integer" });
    return;
  }

  if (
    freeAboveCents !== undefined &&
    freeAboveCents !== null &&
    (!Number.isInteger(freeAboveCents) || freeAboveCents < 0)
  ) {
    res.status(400).json({ error: "freeAboveCents must be a non-negative integer if provided" });
    return;
  }

  const [rate] = await db
    .insert(shippingRates)
    .values({
      id: crypto.randomUUID(),
      sellerId,
      name: name ?? "Standard Shipping",
      flatRateCents,
      freeAboveCents: freeAboveCents ?? null,
    })
    .returning();

  res.status(201).json(rate);
});

// PATCH /api/shipping-rates/:id — update a shipping rate
router.patch("/:id", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { id } = req.params;

  const [existing] = await db
    .select()
    .from(shippingRates)
    .where(and(eq(shippingRates.id, id), eq(shippingRates.sellerId, sellerId)));

  if (!existing) {
    res.status(404).json({ error: "Shipping rate not found" });
    return;
  }

  const { name, flatRateCents, freeAboveCents, active } = req.body;

  if (
    flatRateCents !== undefined &&
    (!Number.isInteger(flatRateCents) || flatRateCents < 0)
  ) {
    res.status(400).json({ error: "flatRateCents must be a non-negative integer" });
    return;
  }

  if (
    freeAboveCents !== undefined &&
    freeAboveCents !== null &&
    (!Number.isInteger(freeAboveCents) || freeAboveCents < 0)
  ) {
    res.status(400).json({ error: "freeAboveCents must be a non-negative integer if provided" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (flatRateCents !== undefined) updates.flatRateCents = flatRateCents;
  if (freeAboveCents !== undefined) updates.freeAboveCents = freeAboveCents;
  if (active !== undefined) updates.active = active;

  const [updated] = await db
    .update(shippingRates)
    .set(updates)
    .where(and(eq(shippingRates.id, id), eq(shippingRates.sellerId, sellerId)))
    .returning();

  res.json(updated);
});

// DELETE /api/shipping-rates/:id — delete a shipping rate
router.delete("/:id", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { id } = req.params;

  const [existing] = await db
    .select()
    .from(shippingRates)
    .where(and(eq(shippingRates.id, id), eq(shippingRates.sellerId, sellerId)));

  if (!existing) {
    res.status(404).json({ error: "Shipping rate not found" });
    return;
  }

  await db
    .delete(shippingRates)
    .where(and(eq(shippingRates.id, id), eq(shippingRates.sellerId, sellerId)));

  res.status(204).send();
});

export default router;
