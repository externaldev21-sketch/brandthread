/**
 * Seller Locations — multi-location inventory management.
 * GET    /api/seller/locations
 * POST   /api/seller/locations
 * PATCH  /api/seller/locations/:id
 * DELETE /api/seller/locations/:id
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { isUuid } from "../lib/uuid";

const router = Router();
router.use(requireAuth);

const TEXT_FIELDS = ["name", "address", "city", "state", "country", "zip", "phone"] as const;
const FLAG_FIELDS = ["isActive", "isPrimary", "fulfillsOnlineOrders"] as const;

/** Type guard for the body: text fields are strings (or null), flags booleans. */
function bodyError(body: Record<string, unknown>): string | null {
  for (const key of TEXT_FIELDS) {
    const v = body[key];
    if (v !== undefined && v !== null && (typeof v !== "string" || v.length > 500)) return `${key} must be text`;
  }
  for (const key of FLAG_FIELDS) {
    const v = body[key];
    if (v !== undefined && v !== null && typeof v !== "boolean") return `${key} must be true or false`;
  }
  return null;
}

function serverError(req: any, res: any, err: unknown, message: string) {
  req.log?.error?.({ err }, message);
  return res.status(500).json({ error: message });
}

// List all locations for the authenticated seller
router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    const rows = await db.execute(sql`
      SELECT id, owner_id, name, address, city, state, country, zip, phone,
             is_active, is_primary, fulfills_online_orders, created_at
      FROM seller_locations
      WHERE owner_id = ${ownerId}
      ORDER BY is_primary DESC, created_at ASC
    `);
    return res.json({ locations: rows.rows });
  } catch (e) {
    return serverError(req, res, e, "Couldn't load your locations");
  }
});

// Create a new location
router.post("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const {
    name = "New Location",
    address,
    city,
    state,
    country = "US",
    zip,
    phone,
    isActive = true,
    isPrimary = false,
    fulfillsOnlineOrders = true,
  } = (req.body ?? {}) as Record<string, any>;

  const invalid = bodyError(req.body ?? {});
  if (invalid) return res.status(400).json({ error: invalid });
  if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "name is required" });

  try {
    // One transaction, serialised per seller, so two creates can't both
    // become primary (or both see "no locations yet").
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`seller_locations:${ownerId}`}))`);
      // If this is the first location, make it primary
      const existing = await tx.execute(sql`
        SELECT count(*) FROM seller_locations WHERE owner_id = ${ownerId}
      `);
      const count = parseInt((existing.rows[0] as any).count ?? "0");
      const forcePrimary = count === 0;

      // If new location is primary, un-set existing primaries
      if (isPrimary || forcePrimary) {
        await tx.execute(sql`
          UPDATE seller_locations SET is_primary = false WHERE owner_id = ${ownerId}
        `);
      }

      return tx.execute(sql`
        INSERT INTO seller_locations
          (owner_id, name, address, city, state, country, zip, phone, is_active, is_primary, fulfills_online_orders)
        VALUES
          (${ownerId}, ${name.trim()}, ${address ?? null}, ${city ?? null}, ${state ?? null},
           ${country ?? "US"}, ${zip ?? null}, ${phone ?? null},
           ${isActive ?? true}, ${!!isPrimary || forcePrimary}, ${fulfillsOnlineOrders ?? true})
        RETURNING *
      `);
    });
    return res.status(201).json({ location: result.rows[0] });
  } catch (e) {
    return serverError(req, res, e, "Couldn't save this location");
  }
});

// Update a location
router.patch("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;
  if (!isUuid(id)) return res.status(404).json({ error: "Not found" });
  const {
    name, address, city, state, country, zip, phone,
    isActive, isPrimary, fulfillsOnlineOrders,
  } = (req.body ?? {}) as Record<string, any>;
  const invalid = bodyError(req.body ?? {});
  if (invalid) return res.status(400).json({ error: invalid });

  try {
    const result = await db.transaction(async (tx) => {
      // Verify ownership
      const check = await tx.execute(sql`
        SELECT id FROM seller_locations WHERE id = ${id}::uuid AND owner_id = ${ownerId}
      `);
      if (!check.rows.length) return null;

      // If setting as primary, clear others
      if (isPrimary === true) {
        await tx.execute(sql`
          UPDATE seller_locations SET is_primary = false WHERE owner_id = ${ownerId}
        `);
      }

      return tx.execute(sql`
        UPDATE seller_locations SET
          name                  = COALESCE(${name ?? null}, name),
          address               = COALESCE(${address ?? null}, address),
          city                  = COALESCE(${city ?? null}, city),
          state                 = COALESCE(${state ?? null}, state),
          country               = COALESCE(${country ?? null}, country),
          zip                   = COALESCE(${zip ?? null}, zip),
          phone                 = COALESCE(${phone ?? null}, phone),
          is_active             = COALESCE(${isActive ?? null}, is_active),
          is_primary            = COALESCE(${isPrimary ?? null}, is_primary),
          fulfills_online_orders = COALESCE(${fulfillsOnlineOrders ?? null}, fulfills_online_orders),
          updated_at            = NOW()
        WHERE id = ${id}::uuid AND owner_id = ${ownerId}
        RETURNING *
      `);
    });
    if (!result) return res.status(404).json({ error: "Not found" });
    return res.json({ location: result.rows[0] });
  } catch (e) {
    return serverError(req, res, e, "Couldn't update this location");
  }
});

// Delete a location (cannot delete the only primary)
router.delete("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;
  if (!isUuid(id)) return res.status(404).json({ error: "Not found" });

  try {
    const check = await db.execute(sql`
      SELECT id, is_primary FROM seller_locations WHERE id = ${id}::uuid AND owner_id = ${ownerId}
    `);
    if (!check.rows.length) return res.status(404).json({ error: "Not found" });

    const loc = check.rows[0] as any;
    if (loc.is_primary) {
      // Count total locations — can't delete if it's the last/only primary
      const countRes = await db.execute(sql`
        SELECT count(*) FROM seller_locations WHERE owner_id = ${ownerId}
      `);
      const total = parseInt((countRes.rows[0] as any).count ?? "0");
      if (total <= 1) {
        return res.status(400).json({ error: "Cannot delete your only location" });
      }
    }

    await db.transaction(async (tx) => {
      if (loc.is_primary) {
        // Re-assign primary to the oldest remaining location. (PostgreSQL's
        // UPDATE has no ORDER BY / LIMIT; pick the row in a subquery.)
        await tx.execute(sql`
          UPDATE seller_locations
          SET is_primary = true, updated_at = NOW()
          WHERE id = (
            SELECT id FROM seller_locations
            WHERE owner_id = ${ownerId} AND id != ${id}::uuid
            ORDER BY created_at ASC, id ASC
            LIMIT 1
          )
        `);
      }
      await tx.execute(sql`
        DELETE FROM seller_locations WHERE id = ${id}::uuid AND owner_id = ${ownerId}
      `);
    });
    return res.json({ ok: true });
  } catch (e) {
    return serverError(req, res, e, "Couldn't delete this location");
  }
});

export default router;
