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

const router = Router();
router.use(requireAuth);

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
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
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
  } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: "name is required" });

  try {
    // If this is the first location, make it primary
    const existing = await db.execute(sql`
      SELECT count(*) FROM seller_locations WHERE owner_id = ${ownerId}
    `);
    const count = parseInt((existing.rows[0] as any).count ?? "0");
    const forcePrimary = count === 0;

    // If new location is primary, un-set existing primaries
    if (isPrimary || forcePrimary) {
      await db.execute(sql`
        UPDATE seller_locations SET is_primary = false WHERE owner_id = ${ownerId}
      `);
    }

    const result = await db.execute(sql`
      INSERT INTO seller_locations
        (owner_id, name, address, city, state, country, zip, phone, is_active, is_primary, fulfills_online_orders)
      VALUES
        (${ownerId}, ${name.trim()}, ${address ?? null}, ${city ?? null}, ${state ?? null},
         ${country ?? "US"}, ${zip ?? null}, ${phone ?? null},
         ${isActive}, ${isPrimary || forcePrimary}, ${fulfillsOnlineOrders})
      RETURNING *
    `);
    return res.status(201).json({ location: result.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Update a location
router.patch("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;
  const {
    name, address, city, state, country, zip, phone,
    isActive, isPrimary, fulfillsOnlineOrders,
  } = req.body;

  try {
    // Verify ownership
    const check = await db.execute(sql`
      SELECT id FROM seller_locations WHERE id = ${id}::uuid AND owner_id = ${ownerId}
    `);
    if (!check.rows.length) return res.status(404).json({ error: "Not found" });

    // If setting as primary, clear others
    if (isPrimary === true) {
      await db.execute(sql`
        UPDATE seller_locations SET is_primary = false WHERE owner_id = ${ownerId}
      `);
    }

    const result = await db.execute(sql`
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
        fulfills_online_orders = COALESCE(${fulfillsOnlineOrders ?? null}, fulfills_online_orders)
      WHERE id = ${id}::uuid AND owner_id = ${ownerId}
      RETURNING *
    `);
    return res.json({ location: result.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Delete a location (cannot delete the only primary)
router.delete("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;

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
      // Re-assign primary to the oldest remaining location
      await db.execute(sql`
        UPDATE seller_locations
        SET is_primary = true
        WHERE owner_id = ${ownerId} AND id != ${id}::uuid
        ORDER BY created_at ASC
        LIMIT 1
      `);
    }

    await db.execute(sql`
      DELETE FROM seller_locations WHERE id = ${id}::uuid AND owner_id = ${ownerId}
    `);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
