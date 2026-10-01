/**
 * Saved live replays ("Replays" on a seller's profile).
 *
 * A replay is created by lib/liveReplay.ts (finalizeReplay) once Agora Cloud
 * Recording confirms an uploaded file; that also publishes a normal video
 * post. This file only READS those rows and lets the owner hide/delete them.
 * It never creates a replay or invents a URL.
 *
 *  GET    /api/live-replays/by-seller/:sellerId  list (public; owner also sees hidden)
 *  GET    /api/live-replays/:streamId            one replay for the player
 *  PATCH  /api/live-replays/:streamId            owner: { visibility: "public" | "hidden" }
 *  DELETE /api/live-replays/:streamId            owner: soft delete
 *
 * Visibility rules live in lib/liveReplayAccess.ts. Hiding also archives the
 * linked post (post_status 'archived') and un-hiding republishes it, so a
 * hidden replay drops out of the public video grid too; deleting marks the
 * post 'deleted'.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { isBlockedEitherWay, optionalViewerId } from "../lib/safety";
import { resolveToClerkId } from "./public";
import { parsePagination } from "../lib/pagination";
import {
  canViewReplay,
  normalizeVisibility,
  shapeReplay,
  type ReplayRow,
} from "../lib/liveReplayAccess";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_REPLAY = sql`
  SELECT ls.id, ls.seller_id, ls.title, ls.description, ls.thumbnail_url,
         ls.replay_url, ls.replay_post_id, ls.replay_visibility, ls.replay_deleted_at,
         ls.peak_viewer_count, ls.started_at, ls.ended_at,
         p.post_status, p.moderation_status AS post_moderation_status
  FROM live_streams ls
  LEFT JOIN posts p ON p.id = ls.replay_post_id
`;

// ─── GET /api/live-replays/by-seller/:sellerId ───────────────────────────────
router.get("/by-seller/:sellerId", async (req, res) => {
  try {
    const viewerId = optionalViewerId(req);
    const sellerId = await resolveToClerkId(String(req.params.sellerId));
    if (!sellerId) return res.status(404).json({ error: "Seller not found" });

    const parsed = parsePagination(req.query, { limit: 20 });
    if (!parsed.success) return res.status(400).json({ error: "Invalid pagination" });
    const { limit, offset } = parsed.data;

    const isOwner = !!viewerId && viewerId === sellerId;
    if (!isOwner && viewerId && (await isBlockedEitherWay(viewerId, sellerId))) {
      return res.json({ replays: [], total: 0 });
    }

    const rows = await db.execute(sql`
      ${SELECT_REPLAY}
      WHERE ls.seller_id = ${sellerId}
        AND ls.replay_url IS NOT NULL
        AND ls.replay_post_id IS NOT NULL
        AND ls.replay_deleted_at IS NULL
        AND (${isOwner}::boolean OR (
          ls.replay_visibility = 'public'
          AND p.post_status = 'published'
          AND p.moderation_status = 'visible'
          AND NOT EXISTS (
            SELECT 1 FROM users su
            WHERE su.clerk_id = ls.seller_id
              AND (su.suspended_at IS NOT NULL OR su.deleted_at IS NOT NULL)
          )
        ))
      ORDER BY ls.ended_at DESC NULLS LAST, ls.started_at DESC
      LIMIT ${limit + 1} OFFSET ${offset}
    `);
    const all = rows.rows as unknown as ReplayRow[];
    const page = all.slice(0, limit).filter((row) => canViewReplay(viewerId, row));
    return res.json({
      replays: page.map((row) => shapeReplay(row, viewerId)),
      hasMore: all.length > limit,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/live-replays/:streamId ─────────────────────────────────────────
router.get("/:streamId", async (req, res) => {
  try {
    const streamId = String(req.params.streamId);
    if (!UUID_RE.test(streamId)) return res.status(404).json({ error: "Replay not found" });
    const viewerId = optionalViewerId(req);
    const rows = await db.execute(sql`${SELECT_REPLAY} WHERE ls.id = ${streamId}::uuid LIMIT 1`);
    const row = rows.rows[0] as unknown as ReplayRow | undefined;
    if (!row) return res.status(404).json({ error: "Replay not found" });
    const blocked = !!viewerId && viewerId !== row.seller_id && (await isBlockedEitherWay(viewerId, row.seller_id));
    // Same 404 for missing, hidden, deleted and blocked: never reveal which.
    if (!canViewReplay(viewerId, row, { blocked })) return res.status(404).json({ error: "Replay not found" });
    return res.json({ replay: shapeReplay(row, viewerId) });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

async function loadOwnedReplay(streamId: string, userId: string): Promise<ReplayRow | null> {
  if (!UUID_RE.test(streamId)) return null;
  const rows = await db.execute(sql`
    ${SELECT_REPLAY} WHERE ls.id = ${streamId}::uuid AND ls.seller_id = ${userId} LIMIT 1
  `);
  const row = rows.rows[0] as unknown as ReplayRow | undefined;
  if (!row || !row.replay_url || !row.replay_post_id || row.replay_deleted_at) return null;
  return row;
}

// ─── PATCH /api/live-replays/:streamId ───────────────────────────────────────
router.patch("/:streamId", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).clerkUserId as string;
    const visibility = normalizeVisibility(req.body?.visibility);
    if (!visibility) {
      return res.status(400).json({ error: "visibility must be 'public' or 'hidden'", code: "INVALID_VISIBILITY" });
    }
    const row = await loadOwnedReplay(String(req.params.streamId), userId);
    if (!row) return res.status(404).json({ error: "Replay not found" });

    await db.execute(sql`
      UPDATE live_streams SET replay_visibility = ${visibility} WHERE id = ${row.id}::uuid
    `);
    // Keep the linked post in step. Only flip between published and archived
    // so a moderator-held/removed or already-deleted post is never resurrected.
    if (visibility === "hidden") {
      await db.execute(sql`
        UPDATE posts SET post_status = 'archived'
        WHERE id = ${row.replay_post_id}::uuid AND user_id = ${userId} AND post_status = 'published'
      `);
    } else {
      await db.execute(sql`
        UPDATE posts SET post_status = 'published'
        WHERE id = ${row.replay_post_id}::uuid AND user_id = ${userId} AND post_status = 'archived'
      `);
    }
    return res.json({ ok: true, visibility });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/live-replays/:streamId ──────────────────────────────────────
router.delete("/:streamId", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).clerkUserId as string;
    const row = await loadOwnedReplay(String(req.params.streamId), userId);
    if (!row) return res.status(404).json({ error: "Replay not found" });

    await db.execute(sql`
      UPDATE live_streams SET replay_deleted_at = now() WHERE id = ${row.id}::uuid
    `);
    await db.execute(sql`
      UPDATE posts SET post_status = 'deleted'
      WHERE id = ${row.replay_post_id}::uuid AND user_id = ${userId}
    `);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
