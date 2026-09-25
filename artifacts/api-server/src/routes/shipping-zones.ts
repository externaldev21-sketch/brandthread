/**
 * Worldwide shipping zones — seller CRUD, plus a public preview/calculate
 * endpoint used by checkout. See lib/shippingZones.ts for the pure
 * destination -> cost resolution logic shared with guest-checkout.ts.
 *
 * GET    /api/shipping-zones                     — list this seller's zones (with weight tiers)
 * POST   /api/shipping-zones                     — create a zone
 * PATCH  /api/shipping-zones/:id                 — update a zone
 * DELETE /api/shipping-zones/:id                 — delete a zone
 * PUT    /api/shipping-zones/:id/weight-tiers    — replace a zone's weight tiers
 * GET    /api/shipping-zones/resolve             — public: resolve cost for a destination (no auth)
 */
import { Router } from "express";
import crypto from "crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, shippingZones, shippingZoneWeightTiers, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole, teamContext } from "../middlewares/requireRole";
import { resolveShippingForDestination, type ShippingZoneRow, type ShippingZoneWeightTierRow } from "../lib/shippingZones";

const router = Router();

const ZONE_TYPES = new Set(["domestic", "country", "rest_of_world"]);
const PRICING_MODELS = new Set(["flat", "weight_tiered"]);
const DUTIES = new Set(["ddp", "dap"]);

function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

async function zoneWithTiers(zoneId: string) {
  return db.select().from(shippingZoneWeightTiers)
    .where(eq(shippingZoneWeightTiers.zoneId, zoneId))
    .orderBy(asc(shippingZoneWeightTiers.sortOrder));
}

// ── Public: resolve shipping cost for a destination (used by buyer checkout preview) ──
router.get("/resolve", async (req, res) => {
  const { sellerId, country, subtotalCents, weightGrams } = req.query;
  if (!sellerId || !country) {
    res.status(400).json({ error: "sellerId and country are required" });
    return;
  }
  const subtotal = subtotalCents !== undefined ? parseInt(String(subtotalCents), 10) : 0;
  const weight = weightGrams !== undefined ? parseInt(String(weightGrams), 10) : 0;
  if (isNaN(subtotal) || subtotal < 0 || isNaN(weight) || weight < 0) {
    res.status(400).json({ error: "subtotalCents and weightGrams must be non-negative integers" });
    return;
  }

  const [seller] = await db.select({ country: users.sellerShipFromCountry }).from(users)
    .where(eq(users.clerkId, String(sellerId))).limit(1);
  const zoneRows = await db.select().from(shippingZones)
    .where(and(eq(shippingZones.sellerId, String(sellerId)), eq(shippingZones.active, true)))
    .orderBy(asc(shippingZones.sortOrder));

  if (zoneRows.length === 0) {
    res.json({ zoneId: null, shippingCents: 0, isFree: true, zoneName: null, unavailable: false, legacy: true });
    return;
  }

  // Fetch tiers for every candidate zone (small N per seller) rather than one at a time.
  const allTiers: ShippingZoneWeightTierRow[] = [];
  for (const z of zoneRows) {
    if (z.pricingModel !== "weight_tiered") continue;
    const rows = await zoneWithTiers(z.id);
    allTiers.push(...rows);
  }

  const resolved = resolveShippingForDestination({
    zones: zoneRows as unknown as ShippingZoneRow[],
    weightTiers: allTiers,
    destinationCountry: String(country),
    sellerHomeCountry: seller?.country ?? "US",
    subtotalCents: subtotal,
    weightGrams: weight,
  });
  res.json(resolved);
});

// All routes below require authentication + team context (seller settings).
router.use(requireAuth);
router.use(teamContext());

// GET /api/shipping-zones/settings — the seller's ship-from country (used to resolve the "domestic" zone)
router.get("/settings", requireRole("staff"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const [seller] = await db.select({ country: users.sellerShipFromCountry }).from(users)
    .where(eq(users.clerkId, sellerId)).limit(1);
  res.json({ shipFromCountry: seller?.country ?? "US" });
});

// PATCH /api/shipping-zones/settings — update the seller's ship-from country
router.patch("/settings", requireRole("staff"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const country = typeof req.body?.shipFromCountry === "string" ? req.body.shipFromCountry.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(country)) {
    return void res.status(400).json({ error: "shipFromCountry must be a 2-letter ISO country code" });
  }
  await db.update(users).set({ sellerShipFromCountry: country }).where(eq(users.clerkId, sellerId));
  res.json({ shipFromCountry: country });
});

// GET /api/shipping-zones — list all zones (with weight tiers) for the authenticated seller
router.get("/", requireRole("staff"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const zones = await db.select().from(shippingZones)
    .where(eq(shippingZones.sellerId, sellerId))
    .orderBy(asc(shippingZones.sortOrder));
  const zonesWithTiers = await Promise.all(zones.map(async (zone) => ({
    ...zone,
    weightTiers: zone.pricingModel === "weight_tiered" ? await zoneWithTiers(zone.id) : [],
  })));
  res.json(zonesWithTiers);
});

// POST /api/shipping-zones — create a new zone
router.post("/", requireRole("staff"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const {
    name, zoneType, countries, pricingModel, flatRateCents, freeAboveCents,
    processingDays, carrierLabel, shipsInternationally, dutiesHandling, sortOrder,
  } = req.body ?? {};

  const cleanName = typeof name === "string" ? name.trim() : "";
  if (!cleanName) return void res.status(400).json({ error: "name is required" });
  if (typeof zoneType !== "string" || !ZONE_TYPES.has(zoneType)) {
    return void res.status(400).json({ error: "zoneType must be one of domestic, country, rest_of_world" });
  }
  const cleanPricingModel = typeof pricingModel === "string" && PRICING_MODELS.has(pricingModel) ? pricingModel : "flat";
  const rate = flatRateCents === undefined ? 0 : flatRateCents;
  if (!isNonNegInt(rate)) return void res.status(400).json({ error: "flatRateCents must be a non-negative integer" });
  if (freeAboveCents !== undefined && freeAboveCents !== null && !isNonNegInt(freeAboveCents)) {
    return void res.status(400).json({ error: "freeAboveCents must be a non-negative integer if provided" });
  }
  const cleanCountries = Array.isArray(countries)
    ? [...new Set(countries.filter((c: unknown): c is string => typeof c === "string" && /^[A-Za-z]{2}$/.test(c)).map((c: string) => c.toUpperCase()))]
    : [];
  if (zoneType === "country" && cleanCountries.length === 0) {
    return void res.status(400).json({ error: "countries must include at least one ISO country code for a country zone" });
  }
  const cleanDuties = typeof dutiesHandling === "string" && DUTIES.has(dutiesHandling) ? dutiesHandling : "dap";
  const cleanProcessingDays = isNonNegInt(processingDays) ? processingDays : 2;

  const [zone] = await db.insert(shippingZones).values({
    id: crypto.randomUUID(),
    sellerId,
    name: cleanName,
    zoneType,
    countries: zoneType === "rest_of_world" ? [] : cleanCountries,
    pricingModel: cleanPricingModel,
    flatRateCents: rate,
    freeAboveCents: freeAboveCents ?? null,
    processingDays: cleanProcessingDays,
    carrierLabel: typeof carrierLabel === "string" && carrierLabel.trim() ? carrierLabel.trim() : null,
    shipsInternationally: zoneType === "domestic" ? true : shipsInternationally !== false,
    dutiesHandling: cleanDuties,
    sortOrder: isNonNegInt(sortOrder) ? sortOrder : 0,
  }).returning();

  res.status(201).json({ ...zone, weightTiers: [] });
});

// PATCH /api/shipping-zones/:id — update a zone
router.patch("/:id", requireRole("staff"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { id } = req.params;

  const [existing] = await db.select().from(shippingZones)
    .where(and(eq(shippingZones.id, id), eq(shippingZones.sellerId, sellerId)));
  if (!existing) return void res.status(404).json({ error: "Shipping zone not found" });

  const {
    name, zoneType, countries, pricingModel, flatRateCents, freeAboveCents,
    processingDays, carrierLabel, shipsInternationally, dutiesHandling, active, sortOrder,
  } = req.body ?? {};

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) {
    const cleanName = typeof name === "string" ? name.trim() : "";
    if (!cleanName) return void res.status(400).json({ error: "name must be a non-empty string" });
    updates.name = cleanName;
  }
  if (zoneType !== undefined) {
    if (typeof zoneType !== "string" || !ZONE_TYPES.has(zoneType)) {
      return void res.status(400).json({ error: "zoneType must be one of domestic, country, rest_of_world" });
    }
    updates.zoneType = zoneType;
  }
  if (countries !== undefined) {
    if (!Array.isArray(countries)) return void res.status(400).json({ error: "countries must be an array of ISO country codes" });
    updates.countries = [...new Set(countries.filter((c: unknown): c is string => typeof c === "string" && /^[A-Za-z]{2}$/.test(c)).map((c: string) => c.toUpperCase()))];
  }
  if (pricingModel !== undefined) {
    if (typeof pricingModel !== "string" || !PRICING_MODELS.has(pricingModel)) {
      return void res.status(400).json({ error: "pricingModel must be flat or weight_tiered" });
    }
    updates.pricingModel = pricingModel;
  }
  if (flatRateCents !== undefined) {
    if (!isNonNegInt(flatRateCents)) return void res.status(400).json({ error: "flatRateCents must be a non-negative integer" });
    updates.flatRateCents = flatRateCents;
  }
  if (freeAboveCents !== undefined) {
    if (freeAboveCents !== null && !isNonNegInt(freeAboveCents)) {
      return void res.status(400).json({ error: "freeAboveCents must be a non-negative integer if provided" });
    }
    updates.freeAboveCents = freeAboveCents;
  }
  if (processingDays !== undefined) {
    if (!isNonNegInt(processingDays)) return void res.status(400).json({ error: "processingDays must be a non-negative integer" });
    updates.processingDays = processingDays;
  }
  if (carrierLabel !== undefined) {
    updates.carrierLabel = typeof carrierLabel === "string" && carrierLabel.trim() ? carrierLabel.trim() : null;
  }
  if (shipsInternationally !== undefined) updates.shipsInternationally = Boolean(shipsInternationally);
  if (dutiesHandling !== undefined) {
    if (typeof dutiesHandling !== "string" || !DUTIES.has(dutiesHandling)) {
      return void res.status(400).json({ error: "dutiesHandling must be ddp or dap" });
    }
    updates.dutiesHandling = dutiesHandling;
  }
  if (active !== undefined) updates.active = Boolean(active);
  if (sortOrder !== undefined) {
    if (!isNonNegInt(sortOrder)) return void res.status(400).json({ error: "sortOrder must be a non-negative integer" });
    updates.sortOrder = sortOrder;
  }

  const [updated] = await db.update(shippingZones).set(updates)
    .where(and(eq(shippingZones.id, id), eq(shippingZones.sellerId, sellerId)))
    .returning();
  const weightTiers = updated.pricingModel === "weight_tiered" ? await zoneWithTiers(updated.id) : [];
  res.json({ ...updated, weightTiers });
});

// DELETE /api/shipping-zones/:id — delete a zone (and its weight tiers, via cascade)
router.delete("/:id", requireRole("staff"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { id } = req.params;

  const [existing] = await db.select().from(shippingZones)
    .where(and(eq(shippingZones.id, id), eq(shippingZones.sellerId, sellerId)));
  if (!existing) return void res.status(404).json({ error: "Shipping zone not found" });

  await db.delete(shippingZones).where(and(eq(shippingZones.id, id), eq(shippingZones.sellerId, sellerId)));
  res.status(204).send();
});

// PUT /api/shipping-zones/:id/weight-tiers — replace all weight tiers for a zone
router.put("/:id/weight-tiers", requireRole("staff"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { id } = req.params;

  const [existing] = await db.select().from(shippingZones)
    .where(and(eq(shippingZones.id, id), eq(shippingZones.sellerId, sellerId)));
  if (!existing) return void res.status(404).json({ error: "Shipping zone not found" });

  const tiers = Array.isArray(req.body?.tiers) ? req.body.tiers : null;
  if (!tiers) return void res.status(400).json({ error: "tiers must be an array" });

  for (const t of tiers) {
    if (!isNonNegInt(t?.minWeightGrams)) return void res.status(400).json({ error: "each tier needs a non-negative integer minWeightGrams" });
    if (t?.maxWeightGrams !== undefined && t.maxWeightGrams !== null && !isNonNegInt(t.maxWeightGrams)) {
      return void res.status(400).json({ error: "maxWeightGrams must be a non-negative integer if provided" });
    }
    if (!isNonNegInt(t?.rateCents)) return void res.status(400).json({ error: "each tier needs a non-negative integer rateCents" });
  }

  await db.delete(shippingZoneWeightTiers).where(eq(shippingZoneWeightTiers.zoneId, id));
  if (tiers.length > 0) {
    await db.insert(shippingZoneWeightTiers).values(tiers.map((t: any, i: number) => ({
      id: crypto.randomUUID(),
      zoneId: id,
      minWeightGrams: t.minWeightGrams,
      maxWeightGrams: t.maxWeightGrams ?? null,
      rateCents: t.rateCents,
      sortOrder: i,
    })));
  }
  const rows = await zoneWithTiers(id);
  res.json({ weightTiers: rows });
});

export default router;
