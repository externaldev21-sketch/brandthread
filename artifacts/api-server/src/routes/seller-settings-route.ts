/**
 * Seller Settings — language, store preferences, and integration status.
 * GET   /api/seller/settings              — current settings
 * PATCH /api/seller/settings              — update settings (language, etc.)
 * GET   /api/seller/settings/policies     — load store policies from storefronts table
 * PUT   /api/seller/settings/policies     — save store policies to storefronts table
 * GET   /api/seller/settings/integrations — list connected integrations
 * POST  /api/seller/settings/integrations/:key/connect
 * DELETE /api/seller/settings/integrations/:key
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

// ─── Settings (language, preferences) ────────────────────────────────────────

router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    const result = await db.execute(sql`
      SELECT settings FROM seller_settings WHERE owner_id = ${ownerId}
    `);
    const settings = result.rows[0] ? (result.rows[0] as any).settings : {};
    return res.json({ settings });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.patch("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const updates = req.body; // e.g. { language: 'fr', ...}

  try {
    await db.execute(sql`
      INSERT INTO seller_settings (owner_id, settings, updated_at)
      VALUES (${ownerId}, ${JSON.stringify(updates)}::jsonb, now())
      ON CONFLICT (owner_id) DO UPDATE
        SET settings   = seller_settings.settings || ${JSON.stringify(updates)}::jsonb,
            updated_at = now()
    `);
    const result = await db.execute(sql`
      SELECT settings FROM seller_settings WHERE owner_id = ${ownerId}
    `);
    return res.json({ settings: (result.rows[0] as any).settings });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── Policies ─────────────────────────────────────────────────────────────────

router.get("/policies", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    const result = await db.execute(sql`
      SELECT policies FROM storefronts WHERE owner_id = ${ownerId}
    `);
    const policies = result.rows[0] ? (result.rows[0] as any).policies : [];
    return res.json({ policies: policies ?? [] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.put("/policies", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { policies } = req.body;
  if (!Array.isArray(policies)) return res.status(400).json({ error: "policies must be an array" });

  try {
    // Upsert storefront row if it doesn't exist yet
    await db.execute(sql`
      INSERT INTO storefronts (owner_id, slug, title, policies)
      VALUES (${ownerId}, ${ownerId}, 'My Store', ${JSON.stringify(policies)}::jsonb)
      ON CONFLICT (owner_id) DO UPDATE
        SET policies   = ${JSON.stringify(policies)}::jsonb,
            updated_at = now()
    `);
    return res.json({ ok: true, policies });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── Integrations status ──────────────────────────────────────────────────────

router.get("/integrations", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    const result = await db.execute(sql`
      SELECT key, connected_at, settings
      FROM seller_integrations
      WHERE owner_id = ${ownerId}
    `);
    return res.json({ integrations: result.rows });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/integrations/:key/connect", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { key } = req.params;
  const settings = req.body.settings ?? {};
  try {
    await db.execute(sql`
      INSERT INTO seller_integrations (owner_id, key, settings, connected_at)
      VALUES (${ownerId}, ${key}, ${JSON.stringify(settings)}::jsonb, now())
      ON CONFLICT (owner_id, key) DO UPDATE
        SET settings     = ${JSON.stringify(settings)}::jsonb,
            connected_at = now()
    `);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.delete("/integrations/:key", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { key } = req.params;
  try {
    await db.execute(sql`
      DELETE FROM seller_integrations WHERE owner_id = ${ownerId} AND key = ${key}
    `);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
