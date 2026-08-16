/**
 * Seller Metafields — custom product field definitions.
 * GET    /api/seller/metafields              — counts per owner_resource
 * GET    /api/seller/metafields/:resource    — list definitions for one resource
 * POST   /api/seller/metafields              — create a definition
 * DELETE /api/seller/metafields/:id          — delete a definition
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

// Counts per resource
router.get("/", async (req, res) => {
  const ownerId = (req as any).userId as string;
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
  const ownerId = (req as any).userId as string;
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
  const ownerId = (req as any).userId as string;
  const {
    ownerResource,
    namespace = "custom",
    key,
    name,
    type = "single_line_text_field",
    description,
    pinned = false,
  } = req.body;

  if (!ownerResource || !key || !name) {
    return res.status(400).json({ error: "ownerResource, key, and name are required" });
  }
  if (!ALLOWED_RESOURCES.includes(ownerResource)) {
    return res.status(400).json({ error: "Invalid ownerResource" });
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
            description = EXCLUDED.description, pinned = EXCLUDED.pinned
      RETURNING *
    `);
    return res.status(201).json({ definition: result.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Delete a definition
router.delete("/:id", async (req, res) => {
  const ownerId = (req as any).userId as string;
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
