import { Router } from "express";
import { db, shippingRates, shippingZones, users } from "@workspace/db";
import { eq, and, asc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "@workspace/api-zod";
import { bodyObject, cents, idParams, validateInput } from "../lib/commerceValidation";
import { setPublicCacheHeaders } from "../lib/httpCache";
import { resolveFreeShippingThreshold } from "../lib/freeShippingThreshold";
import type { ShippingZoneRow } from "../lib/shippingZones";
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

  // How long the seller takes to ship (their domestic shipping zone), so
  // checkout can show a delivery window. null when the seller never set one;
  // the app then shows a generic estimate.
  const zones = await db
    .select({ processingDays: shippingZones.processingDays, zoneType: shippingZones.zoneType })
    .from(shippingZones)
    .where(and(eq(shippingZones.sellerId, String(sellerId)), eq(shippingZones.active, true)))
    .orderBy(asc(shippingZones.sortOrder));
  const zone = zones.find((z) => z.zoneType === "domestic") ?? zones[0];
  const processingDays = zone?.processingDays ?? null;

  if (!rate) {
    res.json({ shippingCents: 0, isFree: true, rateName: "Free Shipping", processingDays, freeAboveCents: null });
    return;
  }

  // The seller's own free-shipping threshold, so the buyer's bag can say how
  // far a seller's items are from free shipping. Only reported when this flat
  // rate is what checkout actually charges: a seller with shipping zones is
  // priced per destination at checkout, so no single threshold applies.
  const freeAboveCents = zones.length === 0 ? rate.freeAboveCents ?? null : null;

  if (rate.freeAboveCents != null && subtotal >= rate.freeAboveCents) {
    const threshold = (rate.freeAboveCents / 100).toFixed(0);
    res.json({
      shippingCents: 0,
      isFree: true,
      rateName: `${rate.name} (Free above $${threshold})`,
      processingDays,
      freeAboveCents,
    });
    return;
  }

  res.json({
    shippingCents: rate.flatRateCents,
    isFree: rate.flatRateCents === 0,
    rateName: rate.name,
    processingDays,
    freeAboveCents,
  });
});

// Public endpoint — no auth required. Read-only.
// GET /api/shipping-rates/free-shipping?sellerIds=a,b (at most 20 ids)
// → { thresholds: { [sellerId]: cents | null } } — each seller's
// free-shipping threshold for a domestic order (lib/freeShippingThreshold.ts),
// for the bag's "Spend $X more for free shipping" strip.
const FREE_SHIPPING_MAX_SELLERS = 20;
router.get("/free-shipping", async (req, res) => {
  const sellerIds = [...new Set(
    String(req.query.sellerIds ?? "").split(",").map((id) => id.trim()).filter(Boolean),
  )].slice(0, FREE_SHIPPING_MAX_SELLERS);
  if (sellerIds.length === 0) {
    res.status(400).json({ error: "sellerIds is required" });
    return;
  }

  const [zones, rates, sellers] = await Promise.all([
    db.select().from(shippingZones).where(inArray(shippingZones.sellerId, sellerIds)),
    db.select().from(shippingRates).where(and(inArray(shippingRates.sellerId, sellerIds), eq(shippingRates.active, true))),
    db.select({ clerkId: users.clerkId, shipFrom: users.sellerShipFromCountry }).from(users).where(inArray(users.clerkId, sellerIds)),
  ]);

  const thresholds: Record<string, number | null> = {};
  for (const sellerId of sellerIds) {
    const legacy = rates.find((r) => r.sellerId === sellerId) ?? null;
    thresholds[sellerId] = resolveFreeShippingThreshold({
      zones: zones.filter((z) => z.sellerId === sellerId) as unknown as ShippingZoneRow[],
      legacyRate: legacy ? { flatRateCents: legacy.flatRateCents, freeAboveCents: legacy.freeAboveCents, active: legacy.active } : null,
      sellerHomeCountry: sellers.find((s) => s.clerkId === sellerId)?.shipFrom ?? "US",
    });
  }
  setPublicCacheHeaders(res, { maxAgeSeconds: 30, staleWhileRevalidateSeconds: 120 });
  res.json({ thresholds });
});

// All routes below require authentication
router.use(requireAuth);

// Type/size guards; the handlers keep the non-negative-integer checks.
const rateIdParams = idParams("id");
const rateFields = {
  name: z.string().max(200).nullish(),
  flatRateCents: cents.optional(),
  freeAboveCents: cents.nullish(),
};
const createRateBody = bodyObject(rateFields);
const updateRateBody = bodyObject({ ...rateFields, active: z.boolean().optional() });

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
router.post("/", validateInput({ body: createRateBody }), async (req, res) => {
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
router.patch("/:id", validateInput({ params: rateIdParams, body: updateRateBody }), async (req, res) => {
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

  // Always stamps updatedAt, so an empty patch is a no-op rather than an
  // empty SET (which drizzle rejects). `name` is NOT NULL: null keeps it.
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined && name !== null) updates.name = name;
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
router.delete("/:id", validateInput({ params: rateIdParams }), async (req, res) => {
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
