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
import { requireRole, teamContext } from "../middlewares/requireRole";

const router = Router();
router.use(requireAuth);
router.use(teamContext());

function toDimension(value: unknown): string | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

router.get("/", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const rows = await db.select().from(sellerPackagePresets)
    .where(eq(sellerPackagePresets.ownerId, ownerId))
    .orderBy(desc(sellerPackagePresets.createdAt));
  res.json({ presets: rows });
});

router.post("/", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const weightOz = Number(req.body?.weightOz);
  const lengthIn = toDimension(req.body?.lengthIn);
  const widthIn = toDimension(req.body?.widthIn);
  const heightIn = toDimension(req.body?.heightIn);
  if (!name) return void res.status(400).json({ error: "name is required" });
  if (!Number.isFinite(weightOz) || weightOz <= 0) {
    return void res.status(400).json({ error: "weightOz must be a positive number" });
  }
  if (!lengthIn || !widthIn || !heightIn) {
    return void res.status(400).json({ error: "lengthIn, widthIn, and heightIn must be positive numbers" });
  }
  const [preset] = await db.insert(sellerPackagePresets).values({
    ownerId, name, weightOz: Math.round(weightOz), lengthIn, widthIn, heightIn,
  }).returning();
  res.status(201).json({ preset });
});

router.patch("/:id", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (req.body?.name !== undefined) {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) return void res.status(400).json({ error: "name must be a non-empty string" });
    update.name = name;
  }
  if (req.body?.weightOz !== undefined) {
    const weightOz = Number(req.body.weightOz);
    if (!Number.isFinite(weightOz) || weightOz <= 0) {
      return void res.status(400).json({ error: "weightOz must be a positive number" });
    }
    update.weightOz = Math.round(weightOz);
  }
  for (const [key, field] of [["lengthIn", "lengthIn"], ["widthIn", "widthIn"], ["heightIn", "heightIn"]] as const) {
    if (req.body?.[key] !== undefined) {
      const dim = toDimension(req.body[key]);
      if (!dim) return void res.status(400).json({ error: `${key} must be a positive number` });
      update[field] = dim;
    }
  }
  const [preset] = await db.update(sellerPackagePresets).set(update)
    .where(and(eq(sellerPackagePresets.id, req.params.id), eq(sellerPackagePresets.ownerId, ownerId)))
    .returning();
  if (!preset) return void res.status(404).json({ error: "Preset not found" });
  res.json({ preset });
});

router.delete("/:id", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [deleted] = await db.delete(sellerPackagePresets)
    .where(and(eq(sellerPackagePresets.id, req.params.id), eq(sellerPackagePresets.ownerId, ownerId)))
    .returning({ id: sellerPackagePresets.id });
  if (!deleted) return void res.status(404).json({ error: "Preset not found" });
  res.json({ ok: true });
});

export default router;
