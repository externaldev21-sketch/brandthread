/**
 * Digital Closet (buyer profile → Closet tab).
 * GET    /api/buyer/closet/pieces        — delivered pieces, newest first
 * GET    /api/buyer/closet/outfits       — saved outfits with their pieces
 * POST   /api/buyer/closet/outfits       — save { pieceIds } (closet pieces only)
 * DELETE /api/buyer/closet/outfits/:id   — delete one of my outfits
 * GET    /api/buyer/closet/unboxing      — the delivery waiting for its unboxing moment, or null
 * POST   /api/buyer/closet/unboxing/seen — never show the moment again for what's waiting
 */
import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { closetOutfits, db } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { loadClosetPieces, type ClosetPiece } from "../lib/closet/pieces";
import { markUnboxingSeen, nextUnboxing } from "../lib/closet/unboxing";

export const MAX_OUTFIT_PIECES = 8;

const router = Router();
router.use(requireAuth);

const me = (req: unknown) => (req as { clerkUserId: string }).clerkUserId;

router.get("/pieces", async (req, res) => {
  try {
    res.json({ pieces: await loadClosetPieces(me(req)) });
  } catch (err) {
    req.log.error({ err }, "Failed to load closet pieces");
    res.status(500).json({ error: "Couldn't load your closet" });
  }
});

router.get("/outfits", async (req, res) => {
  try {
    const buyerId = me(req);
    const [rows, pieces] = await Promise.all([
      db.select().from(closetOutfits).where(eq(closetOutfits.buyerId, buyerId)).orderBy(desc(closetOutfits.createdAt)),
      loadClosetPieces(buyerId),
    ]);
    const byId = new Map(pieces.map((p) => [p.id, p]));
    const outfits = rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      // A refunded piece drops out of the outfit rather than showing a hole.
      pieces: row.pieceIds.map((id) => byId.get(id)).filter((p): p is ClosetPiece => !!p),
    })).filter((o) => o.pieces.length > 0);
    res.json({ outfits });
  } catch (err) {
    req.log.error({ err }, "Failed to load closet outfits");
    res.status(500).json({ error: "Couldn't load your outfits" });
  }
});

router.post("/outfits", async (req, res) => {
  const buyerId = me(req);
  const raw: unknown = req.body?.pieceIds;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    return res.status(400).json({ error: "pieceIds must be a list of piece ids" });
  }
  const pieceIds = [...new Set(raw as string[])];
  if (pieceIds.length === 0) return res.status(400).json({ error: "Pick at least one piece" });
  if (pieceIds.length > MAX_OUTFIT_PIECES) {
    return res.status(400).json({ error: `An outfit holds up to ${MAX_OUTFIT_PIECES} pieces` });
  }
  if (pieceIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
    return res.status(400).json({ error: "Unknown piece" });
  }
  try {
    const pieces = await loadClosetPieces(buyerId, pieceIds);
    if (pieces.length !== pieceIds.length) return res.status(400).json({ error: "Only pieces in your closet can go in an outfit" });
    const [row] = await db.insert(closetOutfits).values({ buyerId, pieceIds }).returning();
    const byId = new Map(pieces.map((p) => [p.id, p]));
    return res.status(201).json({
      outfit: { id: row.id, createdAt: row.createdAt.toISOString(), pieces: pieceIds.map((id) => byId.get(id)!) },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to save closet outfit");
    return res.status(500).json({ error: "Couldn’t save this outfit" });
  }
});

router.delete("/outfits/:id", async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: "Outfit not found" });
  try {
    const deleted = await db.delete(closetOutfits)
      .where(and(eq(closetOutfits.id, req.params.id), eq(closetOutfits.buyerId, me(req))))
      .returning({ id: closetOutfits.id });
    if (deleted.length === 0) return res.status(404).json({ error: "Outfit not found" });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete closet outfit");
    return res.status(500).json({ error: "Couldn’t delete this outfit" });
  }
});

router.get("/unboxing", async (req, res) => {
  try {
    return res.json({ unboxing: await nextUnboxing(me(req)) });
  } catch (err) {
    req.log.error({ err }, "Failed to load unboxing");
    return res.status(500).json({ error: "Couldn’t load this" });
  }
});

router.post("/unboxing/seen", async (req, res) => {
  try {
    return res.json({ marked: await markUnboxingSeen(me(req)) });
  } catch (err) {
    req.log.error({ err }, "Failed to mark unboxing seen");
    return res.status(500).json({ error: "Couldn’t save this" });
  }
});

export default router;
