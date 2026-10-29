/**
 * Seller Package Presets — saved box/parcel dimensions reused across the
 * fulfillment wizard's "Package" step.
 *
 * Units: weightOz in ounces, lengthIn/widthIn/heightIn in inches.
 *
 * GET    /api/package-presets
 * POST   /api/package-presets
 * PATCH  /api/package-presets/:id
 * DELETE /api/package-presets/:id
 */
import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, sellerPackagePresets } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "@workspace/api-zod";
import { bodyObject, idParams, numLike, validateInput } from "../lib/commerceValidation";
import { requireRole, teamContext } from "../middlewares/requireRole";
import { isUuid } from "../lib/uuid";

const router = Router();
router.use(requireAuth);
router.use(teamContext());

// Type/size guards; toDimension and the handlers keep the positive-number rules.
const presetIdParams = idParams("id");
const presetDimension = numLike(-1_000_000, 1_000_000);
const presetFields = {
  name: z.string().max(200).optional(),
  weightOz: presetDimension.optional(),
  lengthIn: presetDimension.optional(),
  widthIn: presetDimension.optional(),
  heightIn: presetDimension.optional(),
};
const presetBody = bodyObject(presetFields);

// length_in/width_in/height_in are numeric(6,2): anything that rounds past
// 9999.99 overflows the column (a 500), and anything that rounds to 0.00
// would store a zero dimension the positive-number rule is meant to refuse.
const MAX_DIMENSION = 9999.99;

function toDimension(value: unknown): string | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  const fixed = n.toFixed(2);
  const rounded = Number(fixed);
  if (rounded <= 0 || rounded > MAX_DIMENSION) return null;
  return fixed;
}

// weight_oz is a whole number of ounces; a positive weight under half an
// ounce must not round down to a stored 0.
function toWeightOz(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
  return Math.max(1, Math.round(n));
}

router.get("/", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const rows = await db.select().from(sellerPackagePresets)
    .where(eq(sellerPackagePresets.ownerId, ownerId))
    .orderBy(desc(sellerPackagePresets.createdAt));
  res.json({ presets: rows });
});

router.post("/", requireRole("staff"), validateInput({ body: presetBody }), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const weightOz = toWeightOz(req.body?.weightOz);
  const lengthIn = toDimension(req.body?.lengthIn);
  const widthIn = toDimension(req.body?.widthIn);
  const heightIn = toDimension(req.body?.heightIn);
  if (!name) return void res.status(400).json({ error: "name is required" });
  if (weightOz === null) {
    return void res.status(400).json({ error: "weightOz must be a positive number" });
  }
  if (!lengthIn || !widthIn || !heightIn) {
    return void res.status(400).json({ error: "lengthIn, widthIn, and heightIn must be positive numbers (at most 9999.99)" });
  }
  const [preset] = await db.insert(sellerPackagePresets).values({
    ownerId, name, weightOz, lengthIn, widthIn, heightIn,
  }).returning();
  res.status(201).json({ preset });
});

router.patch("/:id", requireRole("staff"), validateInput({ params: presetIdParams, body: presetBody }), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.id)) return void res.status(404).json({ error: "Preset not found" });
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (req.body?.name !== undefined) {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) return void res.status(400).json({ error: "name must be a non-empty string" });
    update.name = name;
  }
  if (req.body?.weightOz !== undefined) {
    const weightOz = toWeightOz(req.body.weightOz);
    if (weightOz === null) {
      return void res.status(400).json({ error: "weightOz must be a positive number" });
    }
    update.weightOz = weightOz;
  }
  for (const [key, field] of [["lengthIn", "lengthIn"], ["widthIn", "widthIn"], ["heightIn", "heightIn"]] as const) {
    if (req.body?.[key] !== undefined) {
      const dim = toDimension(req.body[key]);
      if (!dim) return void res.status(400).json({ error: `${key} must be a positive number (at most 9999.99)` });
      update[field] = dim;
    }
  }
  const [preset] = await db.update(sellerPackagePresets).set(update)
    .where(and(eq(sellerPackagePresets.id, req.params.id), eq(sellerPackagePresets.ownerId, ownerId)))
    .returning();
  if (!preset) return void res.status(404).json({ error: "Preset not found" });
  res.json({ preset });
});

router.delete("/:id", requireRole("staff"), validateInput({ params: presetIdParams }), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.id)) return void res.status(404).json({ error: "Preset not found" });
  const [deleted] = await db.delete(sellerPackagePresets)
    .where(and(eq(sellerPackagePresets.id, req.params.id), eq(sellerPackagePresets.ownerId, ownerId)))
    .returning({ id: sellerPackagePresets.id });
  if (!deleted) return void res.status(404).json({ error: "Preset not found" });
  res.json({ ok: true });
});

export default router;
