/**
 * Seller Metafields — custom product field definitions.
 * GET    /api/seller/metafields              — counts per owner_resource
 * GET    /api/seller/metafields/:resource    — list definitions for one resource
 * POST   /api/seller/metafields              — create a definition (upsert on key)
 * PATCH  /api/seller/metafields/:id          — edit a definition's name/type/description/pinned
 * DELETE /api/seller/metafields/:id          — delete a definition
 *
 * Table: metafield_definitions (migration 285).
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

const ALLOWED_RESOURCES = [
  "products","variants","collections","customers","orders",
  "draft-orders","companies","company-locations","locations",
  "transfers","pages","blogs","blog-posts","markets","shop",
];

/** Value types a definition can declare (Shopify-style names). */
export const METAFIELD_TYPES = [
  "single_line_text_field", "multi_line_text_field", "number_integer",
  "number_decimal", "boolean", "date", "url", "color",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[a-z0-9_]{1,64}$/;

// Counts per resource
router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    const rows = await db.execute(sql`
      SELECT owner_resource, count(*)::int AS count
      FROM metafield_definitions
      WHERE owner_id = ${ownerId}
      GROUP BY owner_resource
    `);
    const counts: Record<string, number> = {};
    for (const row of rows.rows as any[]) {
      counts[row.owner_resource] = row.count;
    }
    return res.json({ counts });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// List definitions for one resource type
router.get("/:resource", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { resource } = req.params;
  if (!ALLOWED_RESOURCES.includes(resource)) {
    return res.status(400).json({ error: "Invalid resource type" });
  }
  try {
    const rows = await db.execute(sql`
      SELECT id, owner_resource, namespace, key, name, type, description, pinned, created_at
      FROM metafield_definitions
      WHERE owner_id = ${ownerId} AND owner_resource = ${resource}
      ORDER BY pinned DESC, created_at ASC
    `);
    return res.json({ definitions: rows.rows });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Create a definition
router.post("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const {
    ownerResource,
    namespace = "custom",
    key,
    name,
    type = "single_line_text_field",
    description,
    pinned = false,
  } = req.body;

  if (!ownerResource || typeof key !== "string" || typeof name !== "string" || !key.trim() || !name.trim()) {
    return res.status(400).json({ error: "ownerResource, key, and name are required" });
  }
  if (!ALLOWED_RESOURCES.includes(ownerResource)) {
    return res.status(400).json({ error: "Invalid ownerResource" });
  }
  if (!KEY_RE.test(key.trim())) {
    return res.status(400).json({ error: "Key can only use lowercase letters, numbers and underscores" });
  }
  if (!METAFIELD_TYPES.includes(type)) {
    return res.status(400).json({ error: "Invalid type" });
  }
  if (typeof namespace !== "string" || !KEY_RE.test(namespace)) {
    return res.status(400).json({ error: "Invalid namespace" });
  }

  try {
    const result = await db.execute(sql`
      INSERT INTO metafield_definitions
        (owner_id, owner_resource, namespace, key, name, type, description, pinned)
      VALUES
        (${ownerId}, ${ownerResource}, ${namespace}, ${key.trim()}, ${name.trim()},
         ${type}, ${description ?? null}, ${pinned})
      ON CONFLICT (owner_id, owner_resource, namespace, key) DO UPDATE
        SET name = EXCLUDED.name, type = EXCLUDED.type,
            description = EXCLUDED.description, pinned = EXCLUDED.pinned,
            updated_at = NOW()
      RETURNING *
    `);
    return res.status(201).json({ definition: result.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Edit a definition (key/namespace/resource stay fixed — they identify the field)
router.patch("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: "Not found" });
  const { name, type, description, pinned } = req.body ?? {};
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ error: "Name can't be empty" });
  }
  if (type !== undefined && !METAFIELD_TYPES.includes(type)) {
    return res.status(400).json({ error: "Invalid type" });
  }
  if (description !== undefined && description !== null && typeof description !== "string") {
    return res.status(400).json({ error: "Invalid description" });
  }
  if (pinned !== undefined && typeof pinned !== "boolean") {
    return res.status(400).json({ error: "Invalid pinned" });
  }
  try {
    const result = await db.execute(sql`
      UPDATE metafield_definitions SET
        name        = COALESCE(${name === undefined ? null : name.trim()}, name),
        type        = COALESCE(${type ?? null}, type),
        description = CASE WHEN ${description !== undefined}::boolean THEN ${description === undefined ? null : (description?.trim() || null)}::text ELSE description END,
        pinned      = COALESCE(${pinned ?? null}::boolean, pinned),
        updated_at  = NOW()
      WHERE id = ${req.params.id}::uuid AND owner_id = ${ownerId}
      RETURNING *
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    return res.json({ definition: result.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Delete a definition
router.delete("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: "Not found" });
  try {
    const result = await db.execute(sql`
      DELETE FROM metafield_definitions
      WHERE id = ${req.params.id}::uuid AND owner_id = ${ownerId}
      RETURNING id
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
