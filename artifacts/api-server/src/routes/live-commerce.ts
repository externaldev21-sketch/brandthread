/**
 * Live commerce — pinned product, live-only codes list, scheduled lives.
 * Mounted at /api/live BEFORE routes/live.ts (which stays the write path for
 * streams themselves). Routes:
 *
 *  POST   /api/live/:id/pin                 seller pins/unpins a tagged product (ws: pinned + products)
 *  GET    /api/live/:id/codes               live-only codes viewers can apply during this live
 *  GET    /api/live/scheduled/upcoming      upcoming scheduled lives (?sellerId= for one seller's profile)
 *  GET    /api/live/scheduled/mine          the signed-in seller's scheduled lives
 *  POST   /api/live/scheduled               seller schedules a live
 *  DELETE /api/live/scheduled/:id           seller cancels a scheduled live
 *  PUT    /api/live/scheduled/:id/remind    viewer asks to be reminded
 *  DELETE /api/live/scheduled/:id/remind    viewer removes the reminder
 *
 * Creating a live-only code goes through the existing POST /api/discount-codes
 * with `liveStreamId` (see routes/discount-codes.ts) — not duplicated here.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requirePlan } from "../middlewares/requireAuth";
import { optionalViewerId } from "../lib/safety";
import { broadcastToRoom } from "../ws/liveHub";
import {
  MAX_SCHEDULED_PER_SELLER, applyPin, sanitizeProductTags, validateScheduleInput,
} from "../lib/liveCommerce";

const router = Router();
const hostPlan = requirePlan("pro");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Pinned product ───────────────────────────────────────────────────────────
router.post("/:id/pin", requireAuth, hostPlan, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Not found" });
  const productId = req.body?.productId;
  if (productId !== null && (typeof productId !== "string" || !productId)) {
    return res.status(400).json({ error: "productId must be a product id, or null to unpin" });
  }
  try {
    const rows = await db.execute(sql`
      SELECT product_tags, status FROM live_streams
      WHERE id = ${id}::uuid AND seller_id = ${sellerId}
    `);
    const stream = rows.rows[0] as any;
    if (!stream) return res.status(404).json({ error: "Not found or not your stream" });
    if (stream.status !== "live") return res.status(409).json({ error: "This live has ended" });

    const pin = applyPin(stream.product_tags, productId ?? null);
    if (!pin.ok) return res.status(400).json({ error: pin.error });

    await db.execute(sql`
      UPDATE live_streams
      SET product_tags = ${JSON.stringify(pin.productTags)}::jsonb,
          pinned_product_id = ${pin.pinnedProductId},
          pin_updated_at = now()
      WHERE id = ${id}::uuid AND seller_id = ${sellerId}
    `);
    broadcastToRoom(id, { type: "pinned", productId: pin.pinnedProductId });
    broadcastToRoom(id, { type: "products", productTags: pin.productTags });
    return res.json({ pinnedProductId: pin.pinnedProductId, productTags: pin.productTags });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── Live-only codes (viewer list) ────────────────────────────────────────────
router.get("/:id/codes", requireAuth, async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.json({ codes: [] });
  try {
    const rows = await db.execute(sql`
      SELECT dc.id, dc.code, dc.type, dc.value, dc.min_order_cents, dc.expires_at
      FROM discount_codes dc
      JOIN live_streams ls ON ls.id = dc.live_stream_id
      WHERE dc.live_stream_id = ${id}::uuid
        AND ls.status = 'live'
        AND dc.active = true
        AND (dc.starts_at IS NULL OR dc.starts_at <= now())
        AND (dc.expires_at IS NULL OR dc.expires_at > now())
        AND (dc.max_uses IS NULL OR dc.uses_count < dc.max_uses)
      ORDER BY dc.created_at DESC
      LIMIT 10
    `);
    return res.json({
      codes: (rows.rows as any[]).map((r) => ({
        id: r.id,
        code: r.code,
        type: r.type,
        value: Number(r.value),
        minOrderCents: r.min_order_cents,
        expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      })),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── Scheduled lives ──────────────────────────────────────────────────────────
function scheduledRow(r: any) {
  return {
    id: r.id,
    sellerId: r.seller_id,
    title: r.title,
    description: r.description ?? null,
    startsAt: new Date(r.starts_at).toISOString(),
    productTags: r.product_tags ?? [],
    status: r.status,
    streamId: r.stream_id ?? null,
    reminderCount: Number(r.reminder_count ?? 0),
    reminderSet: r.reminder_set === true,
    seller: {
      name: r.brand_name || r.seller_name || "Live",
      username: r.username ?? null,
      avatarUrl: r.avatar_url ?? null,
      verified: r.verified === true,
    },
  };
}

router.get("/scheduled/upcoming", async (req, res) => {
  const viewerId = optionalViewerId(req);
  const sellerId = typeof req.query.sellerId === "string" ? req.query.sellerId : null;
  try {
    const rows = await db.execute(sql`
      SELECT sl.*, u.display_name AS seller_name, u.brand_name, u.avatar_url, u.username,
             COALESCE(u.verified, false) AS verified,
             (SELECT count(*) FROM scheduled_live_reminders r WHERE r.scheduled_live_id = sl.id) AS reminder_count,
             ${viewerId
               ? sql`EXISTS (SELECT 1 FROM scheduled_live_reminders r WHERE r.scheduled_live_id = sl.id AND r.user_id = ${viewerId})`
               : sql`false`} AS reminder_set
      FROM scheduled_lives sl
      LEFT JOIN users u ON u.clerk_id = sl.seller_id
      WHERE sl.status = 'scheduled'
        AND sl.starts_at > now() - interval '1 hour'
        AND u.suspended_at IS NULL
        ${sellerId ? sql`AND sl.seller_id = ${sellerId}` : sql``}
        ${viewerId ? sql`AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = sl.seller_id)
             OR (b.blocker_id = sl.seller_id AND b.blocked_id = ${viewerId})
        )` : sql``}
      ORDER BY sl.starts_at ASC
      LIMIT 30
    `);
    return res.json({ scheduled: (rows.rows as any[]).map(scheduledRow) });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get("/scheduled/mine", requireAuth, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  try {
    const rows = await db.execute(sql`
      SELECT sl.*, u.display_name AS seller_name, u.brand_name, u.avatar_url, u.username,
             COALESCE(u.verified, false) AS verified,
             (SELECT count(*) FROM scheduled_live_reminders r WHERE r.scheduled_live_id = sl.id) AS reminder_count,
             false AS reminder_set
      FROM scheduled_lives sl
      LEFT JOIN users u ON u.clerk_id = sl.seller_id
      WHERE sl.seller_id = ${sellerId}
        AND sl.status = 'scheduled'
      ORDER BY sl.starts_at ASC
      LIMIT 50
    `);
    return res.json({ scheduled: (rows.rows as any[]).map(scheduledRow) });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/scheduled", requireAuth, hostPlan, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const parsed = validateScheduleInput(req.body ?? {});
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const productTags = sanitizeProductTags(req.body?.productTags);
  try {
    const count = await db.execute(sql`
      SELECT count(*)::int AS n FROM scheduled_lives WHERE seller_id = ${sellerId} AND status = 'scheduled'
    `);
    if (Number((count.rows[0] as any)?.n ?? 0) >= MAX_SCHEDULED_PER_SELLER) {
      return res.status(409).json({ error: "You have too many scheduled lives. Cancel one first." });
    }
    const result = await db.execute(sql`
      INSERT INTO scheduled_lives (seller_id, title, description, starts_at, product_tags)
      VALUES (${sellerId}, ${parsed.title}, ${parsed.description}, ${parsed.startsAt}, ${JSON.stringify(productTags)}::jsonb)
      RETURNING *
    `);
    const r = result.rows[0] as any;
    return res.status(201).json({
      scheduled: scheduledRow({ ...r, reminder_count: 0, reminder_set: false }),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.delete("/scheduled/:id", requireAuth, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: "Not found" });
  try {
    const result = await db.execute(sql`
      UPDATE scheduled_lives SET status = 'cancelled'
      WHERE id = ${req.params.id}::uuid AND seller_id = ${sellerId} AND status = 'scheduled'
      RETURNING id
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.put("/scheduled/:id/remind", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: "Not found" });
  try {
    const rows = await db.execute(sql`
      SELECT seller_id FROM scheduled_lives WHERE id = ${req.params.id}::uuid AND status = 'scheduled'
    `);
    if (!rows.rows.length) return res.status(404).json({ error: "Not found" });
    await db.execute(sql`
      INSERT INTO scheduled_live_reminders (scheduled_live_id, user_id)
      VALUES (${req.params.id}::uuid, ${userId})
      ON CONFLICT DO NOTHING
    `);
    return res.json({ reminderSet: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.delete("/scheduled/:id/remind", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  if (!UUID_RE.test(String(req.params.id))) return res.json({ reminderSet: false });
  try {
    await db.execute(sql`
      DELETE FROM scheduled_live_reminders
      WHERE scheduled_live_id = ${req.params.id}::uuid AND user_id = ${userId}
    `);
    return res.json({ reminderSet: false });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
