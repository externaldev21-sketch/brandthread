/**
 * Live chat moderation endpoints (host controls). Enforcement itself lives in
 * routes/live.ts (POST /:id/comment and /:id/join call lib/liveModeration.ts).
 *
 *  GET    /api/live/moderation-defaults              host's saved default list
 *  PUT    /api/live/moderation-defaults              save default banned words / slow mode
 *  GET    /api/live/:id/moderation                   host: settings + muted/banned lists
 *  PUT    /api/live/:id/moderation/settings          host: banned words, slow mode (optionally save as default)
 *  POST   /api/live/:id/moderation/pin               host: pin a comment ({ commentId }) or unpin ({ commentId: null })
 *  POST   /api/live/:id/moderation/mute              host: { userId }
 *  DELETE /api/live/:id/moderation/mute/:userId
 *  POST   /api/live/:id/moderation/ban               host: { userId } (also removes them from the room)
 *  DELETE /api/live/:id/moderation/ban/:userId
 *  DELETE /api/live/:id/moderation/comments/:commentId   host: remove one comment
 *  GET    /api/live/:id/pinned                       anyone: pinned comment + slow mode seconds
 *
 * Realtime (ws/liveHub.ts): `comment_pinned`, `comment_removed`, `moderation` events.
 */
import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { broadcastToRoom, disconnectUserFromRoom } from "../ws/liveHub";
import { clampSlowMode, normalizeBannedWords } from "../lib/liveModeration";
import { loadEffectiveSettings } from "../lib/liveModerationState";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loads the stream and returns it only when the caller is its host. */
async function hostStream(req: Request, res: Response): Promise<{ id: string; seller_id: string } | null> {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid stream id" }); return null; }
  const userId = (req as any).clerkUserId as string;
  const rows = await db.execute(sql`SELECT id, seller_id FROM live_streams WHERE id = ${id}::uuid LIMIT 1`);
  const stream = rows.rows[0] as any;
  if (!stream) { res.status(404).json({ error: "Stream not found" }); return null; }
  if (stream.seller_id !== userId) { res.status(403).json({ error: "Only the host can moderate this live" }); return null; }
  return stream;
}

function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((e: any) => { if (!res.headersSent) res.status(500).json({ error: e?.message ?? "Server error" }); });
  };
}

// ─── Seller-level defaults ───────────────────────────────────────────────────
router.get("/moderation-defaults", requireAuth, wrap(async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const r = await db.execute(sql`
    SELECT banned_words, slow_mode_seconds FROM seller_live_moderation_defaults WHERE seller_id = ${sellerId}
  `);
  const row = r.rows[0] as any;
  return res.json({
    bannedWords: normalizeBannedWords(row?.banned_words),
    slowModeSeconds: clampSlowMode(row?.slow_mode_seconds),
  });
}));

router.put("/moderation-defaults", requireAuth, wrap(async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const bannedWords = normalizeBannedWords(req.body?.bannedWords);
  const slowModeSeconds = clampSlowMode(req.body?.slowModeSeconds);
  await db.execute(sql`
    INSERT INTO seller_live_moderation_defaults (seller_id, banned_words, slow_mode_seconds, updated_at)
    VALUES (${sellerId}, ${JSON.stringify(bannedWords)}::jsonb, ${slowModeSeconds}, now())
    ON CONFLICT (seller_id) DO UPDATE
      SET banned_words = EXCLUDED.banned_words, slow_mode_seconds = EXCLUDED.slow_mode_seconds, updated_at = now()
  `);
  return res.json({ bannedWords, slowModeSeconds });
}));

// ─── Host: read everything ───────────────────────────────────────────────────
router.get("/:id/moderation", requireAuth, wrap(async (req, res) => {
  const stream = await hostStream(req, res);
  if (!stream) return;
  const settings = await loadEffectiveSettings(stream.id, stream.seller_id);
  const restricted = await db.execute(sql`
    SELECT r.user_id, r.kind, r.created_at,
           COALESCE(u.username, '') AS username,
           COALESCE(u.brand_name, u.display_name, 'Viewer') AS display_name
    FROM live_stream_restrictions r
    LEFT JOIN users u ON u.clerk_id = r.user_id
    WHERE r.stream_id = ${stream.id}::uuid
    ORDER BY r.created_at DESC
  `);
  const rows = restricted.rows as any[];
  const shape = (r: any) => ({ userId: r.user_id, displayName: r.display_name, username: r.username, createdAt: r.created_at });
  return res.json({
    bannedWords: settings.bannedWords,
    slowModeSeconds: settings.slowModeSeconds,
    pinnedCommentId: settings.pinnedCommentId,
    muted: rows.filter((r) => r.kind === "mute").map(shape),
    banned: rows.filter((r) => r.kind === "ban").map(shape),
  });
}));

// ─── Host: banned words + slow mode ──────────────────────────────────────────
router.put("/:id/moderation/settings", requireAuth, wrap(async (req, res) => {
  const stream = await hostStream(req, res);
  if (!stream) return;
  const current = await loadEffectiveSettings(stream.id, stream.seller_id);
  const bannedWords = req.body?.bannedWords === undefined ? current.bannedWords : normalizeBannedWords(req.body.bannedWords);
  const slowModeSeconds = req.body?.slowModeSeconds === undefined ? current.slowModeSeconds : clampSlowMode(req.body.slowModeSeconds);
  await db.execute(sql`
    INSERT INTO live_moderation_settings (stream_id, banned_words, slow_mode_seconds, updated_at)
    VALUES (${stream.id}::uuid, ${JSON.stringify(bannedWords)}::jsonb, ${slowModeSeconds}, now())
    ON CONFLICT (stream_id) DO UPDATE
      SET banned_words = EXCLUDED.banned_words, slow_mode_seconds = EXCLUDED.slow_mode_seconds, updated_at = now()
  `);
  if (req.body?.saveAsDefault === true) {
    await db.execute(sql`
      INSERT INTO seller_live_moderation_defaults (seller_id, banned_words, slow_mode_seconds, updated_at)
      VALUES (${stream.seller_id}, ${JSON.stringify(bannedWords)}::jsonb, ${slowModeSeconds}, now())
      ON CONFLICT (seller_id) DO UPDATE
        SET banned_words = EXCLUDED.banned_words, slow_mode_seconds = EXCLUDED.slow_mode_seconds, updated_at = now()
    `);
  }
  broadcastToRoom(stream.id, { type: "moderation", slowModeSeconds });
  return res.json({ bannedWords, slowModeSeconds });
}));

// ─── Host: pin / unpin ───────────────────────────────────────────────────────
router.post("/:id/moderation/pin", requireAuth, wrap(async (req, res) => {
  const stream = await hostStream(req, res);
  if (!stream) return;
  const commentId = req.body?.commentId ?? null;
  let comment: any = null;
  if (commentId !== null) {
    if (typeof commentId !== "string" || !UUID_RE.test(commentId)) return res.status(400).json({ error: "Invalid commentId" });
    const r = await db.execute(sql`
      SELECT id, user_id, display_name, avatar_url, message, created_at
      FROM live_comments
      WHERE id = ${commentId}::uuid AND stream_id = ${stream.id}::uuid AND removed_at IS NULL
    `);
    comment = r.rows[0];
    if (!comment) return res.status(404).json({ error: "Comment not found" });
  }
  await db.execute(sql`
    INSERT INTO live_moderation_settings (stream_id, pinned_comment_id, updated_at)
    VALUES (${stream.id}::uuid, ${commentId}::uuid, now())
    ON CONFLICT (stream_id) DO UPDATE SET pinned_comment_id = EXCLUDED.pinned_comment_id, updated_at = now()
  `);
  broadcastToRoom(stream.id, { type: "comment_pinned", comment });
  return res.json({ pinnedComment: comment });
}));

// ─── Host: mute / ban ────────────────────────────────────────────────────────
async function setRestriction(req: Request, res: Response, kind: "mute" | "ban") {
  const stream = await hostStream(req, res);
  if (!stream) return;
  const target = req.body?.userId;
  if (typeof target !== "string" || !target) return res.status(400).json({ error: "userId required" });
  if (target === stream.seller_id) return res.status(400).json({ error: "You can't moderate yourself" });
  await db.execute(sql`
    INSERT INTO live_stream_restrictions (stream_id, user_id, kind, created_by)
    VALUES (${stream.id}::uuid, ${target}, ${kind}, ${stream.seller_id})
    ON CONFLICT (stream_id, user_id) DO UPDATE SET kind = EXCLUDED.kind, created_at = now()
  `);
  if (kind === "ban") {
    // Removed from the room: drop their presence, clear their chat, and cut
    // their socket so they stop receiving the stream's events.
    await db.execute(sql`
      DELETE FROM live_viewers WHERE stream_id = ${stream.id}::uuid AND user_id_or_session_id = ${target}
    `);
    const removed = await db.execute(sql`
      UPDATE live_comments SET removed_at = now()
      WHERE stream_id = ${stream.id}::uuid AND user_id = ${target} AND removed_at IS NULL
      RETURNING id
    `);
    for (const row of removed.rows as any[]) broadcastToRoom(stream.id, { type: "comment_removed", commentId: row.id });
    broadcastToRoom(stream.id, { type: "user_banned", userId: target });
    disconnectUserFromRoom(stream.id, target);
  } else {
    broadcastToRoom(stream.id, { type: "user_muted", userId: target });
  }
  return res.json({ ok: true, userId: target, kind });
}

async function clearRestriction(req: Request, res: Response, kind: "mute" | "ban") {
  const stream = await hostStream(req, res);
  if (!stream) return;
  await db.execute(sql`
    DELETE FROM live_stream_restrictions
    WHERE stream_id = ${stream.id}::uuid AND user_id = ${String(req.params.userId)} AND kind = ${kind}
  `);
  return res.json({ ok: true });
}

router.post("/:id/moderation/mute", requireAuth, wrap((req, res) => setRestriction(req, res, "mute")));
router.delete("/:id/moderation/mute/:userId", requireAuth, wrap((req, res) => clearRestriction(req, res, "mute")));
router.post("/:id/moderation/ban", requireAuth, wrap((req, res) => setRestriction(req, res, "ban")));
router.delete("/:id/moderation/ban/:userId", requireAuth, wrap((req, res) => clearRestriction(req, res, "ban")));

// ─── Host: remove a single comment ───────────────────────────────────────────
router.delete("/:id/moderation/comments/:commentId", requireAuth, wrap(async (req, res) => {
  const stream = await hostStream(req, res);
  if (!stream) return;
  const commentId = String(req.params.commentId);
  if (!UUID_RE.test(commentId)) return res.status(400).json({ error: "Invalid commentId" });
  const r = await db.execute(sql`
    UPDATE live_comments SET removed_at = now()
    WHERE id = ${commentId}::uuid AND stream_id = ${stream.id}::uuid AND removed_at IS NULL
    RETURNING id
  `);
  if (!r.rows.length) return res.status(404).json({ error: "Comment not found" });
  await db.execute(sql`
    UPDATE live_moderation_settings SET pinned_comment_id = NULL, updated_at = now()
    WHERE stream_id = ${stream.id}::uuid AND pinned_comment_id = ${commentId}::uuid
  `);
  broadcastToRoom(stream.id, { type: "comment_removed", commentId });
  return res.json({ ok: true });
}));

// ─── Anyone: pinned comment + slow mode (viewer chat header) ─────────────────
router.get("/:id/pinned", wrap(async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid stream id" });
  const rows = await db.execute(sql`
    SELECT ls.seller_id, lc.id, lc.user_id, lc.display_name, lc.avatar_url, lc.message, lc.created_at
    FROM live_streams ls
    LEFT JOIN live_moderation_settings ms ON ms.stream_id = ls.id
    LEFT JOIN live_comments lc ON lc.id = ms.pinned_comment_id AND lc.removed_at IS NULL
    WHERE ls.id = ${id}::uuid
  `);
  const row = rows.rows[0] as any;
  if (!row) return res.status(404).json({ error: "Stream not found" });
  const settings = await loadEffectiveSettings(id, row.seller_id);
  return res.json({
    pinnedComment: row.id
      ? { id: row.id, user_id: row.user_id, display_name: row.display_name, avatar_url: row.avatar_url, message: row.message, created_at: row.created_at }
      : null,
    slowModeSeconds: settings.slowModeSeconds,
  });
}));

export default router;
