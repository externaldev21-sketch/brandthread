/**
 * Live Shopping — Brandthread
 * Agora Interactive Live Streaming backend.
 *
 * Routes:
 *  POST   /api/live/start               seller starts a stream (host token)
 *  GET    /api/live/active              list active streams (for feed mixing)
 *  GET    /api/live/feed                LIVE pager list: followed first, then viewers
 *
 * Viewer routes are open to every signed-in user (buyers watch lives);
 * only the host routes (start / end / products) require the Pro plan.
 *  GET    /api/live/:id                 stream details (public, for viewer)
 *  POST   /api/live/:id/join            viewer gets a token + is now present
 *  POST   /api/live/:id/leave           viewer is no longer present
 *  POST   /api/live/:id/heartbeat       HTTP presence fallback (see below)
 *  POST   /api/live/:id/end             seller ends stream (saves replay)
 *  PATCH  /api/live/:id/products        update tagged products mid-stream
 *  POST   /api/live/:id/comment         add a chat comment
 *  GET    /api/live/:id/comments        poll recent comments (one-shot backfill)
 *
 * Realtime: new comments and product-tag changes are broadcast to the
 * stream's WebSocket room (see ws/liveHub.ts) right after they're written
 * here — this file stays the sole write path, the socket only fans out
 * what was just committed. viewer_count is NOT incremented/decremented by
 * join/leave anymore; it's a live presence count derived from the
 * `live_viewers` table (a WebSocket heartbeat, or the /heartbeat route as
 * an HTTP fallback) by jobs/liveViewersPresence.ts.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requirePlan } from "../middlewares/requireAuth";
import { evaluateContent } from "../lib/contentModerator";
import { optionalViewerId, publishingRestriction } from "../lib/safety";
import { rankLiveFeed } from "../lib/liveFeed";
import { logger } from "../lib/logger";
import { beginCloudRecording, stopCloudRecordingAndMaybeFinalize } from "../lib/liveReplay";
import { broadcastToRoom } from "../ws/liveHub";
import { canJoinStream, checkCommentAllowed } from "../lib/liveModeration";
import { loadEffectiveSettings, loadLastCommentAt, loadRestriction } from "../lib/liveModerationState";

const router = Router();

/** Hosting a live is a Pro feature; watching one is not. */
const hostPlan = requirePlan("pro");

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function generateToken(
  appId: string,
  appCert: string,
  channelName: string,
  uid: number,
  role: number,
): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
    const expireTs = Math.floor(Date.now() / 1000) + 7200; // 2 h
    return RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCert,
      channelName,
      uid,
      role === 1 ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER,
      expireTs,
    );
  } catch {
    return ""; // will fall back to no-cert mode (dev)
  }
}

export function uidFromClerkId(clerkId: string): number {
  let h = 0;
  for (let i = 0; i < clerkId.length; i++) {
    h = (Math.imul(31, h) + clerkId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 999999 + 1;
}

function randomChannelName(): string {
  return `bt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── POST /api/live/start ─────────────────────────────────────────────────────
router.post("/start", requireAuth, hostPlan, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { title, description, thumbnailUrl, productTags = [] } = req.body;

  if (!title?.trim()) return res.status(400).json({ error: "title is required" });

  const appId   = process.env.AGORA_APP_ID ?? "";
  const appCert = process.env.AGORA_APP_CERTIFICATE ?? "";

  if (!appId) {
    return res.status(503).json({ error: "AGORA_APP_ID not configured" });
  }

  // Only one live stream per seller at a time
  const existing = await db.execute(sql`
    SELECT id FROM live_streams
    WHERE seller_id = ${sellerId} AND status = 'live'
    LIMIT 1
  `);
  if (existing.rows.length) {
    return res.status(409).json({
      error: "You already have a live stream. End it first.",
      streamId: (existing.rows[0] as any).id,
    });
  }

  const channelName = randomChannelName();
  const agoraUid   = uidFromClerkId(sellerId);

  const token = generateToken(appId, appCert, channelName, agoraUid, 1 /* PUBLISHER */);

  const result = await db.execute(sql`
    INSERT INTO live_streams
      (seller_id, channel_name, title, description, status, product_tags,
       agora_uid, thumbnail_url, started_at)
    VALUES
      (${sellerId}, ${channelName}, ${title.trim()},
       ${description ?? null}, 'live',
       ${JSON.stringify(productTags)}::jsonb,
       ${agoraUid}, ${thumbnailUrl ?? null}, now())
    RETURNING *
  `);

  const stream = result.rows[0] as any;

  // Kick off Agora Cloud Recording (if configured) so an ended stream can
  // get a real replay. This never blocks or fails stream start — a
  // recording failure is logged and leaves the stream with no replay
  // (see lib/liveReplay.ts + the part-1 guard on GET /:id and /end below).
  beginCloudRecording(stream).catch((err) =>
    logger.error({ err, streamId: stream.id }, "beginCloudRecording threw unexpectedly"),
  );

  return res.status(201).json({
    stream: {
      id: stream.id,
      channelName: stream.channel_name,
      agoraUid:    stream.agora_uid,
      title:       stream.title,
    },
    agoraAppId: appId,
    token,          // "" means no-cert dev mode — Agora console must have auth disabled
  });
});

// ─── GET /api/live/active ─────────────────────────────────────────────────────
router.get("/active", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT ls.id, ls.seller_id, ls.channel_name, ls.title, ls.viewer_count,
             ls.peak_viewer_count, ls.product_tags, ls.thumbnail_url, ls.started_at,
             u.display_name AS seller_name, u.brand_name, u.avatar_url
      FROM live_streams ls
      LEFT JOIN users u ON u.clerk_id = ls.seller_id
      WHERE ls.status = 'live'
      ORDER BY ls.viewer_count DESC, ls.started_at ASC
      LIMIT 20
    `);
    return res.json({ streams: rows.rows });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/live/feed ───────────────────────────────────────────────────────
// The LIVE pager's list: every currently-live stream the viewer may see,
// followed creators first, then by viewer count (see lib/liveFeed.ts).
// Signed-out callers get the same list without the followed boost.
router.get("/feed", async (req, res) => {
  const viewerId = optionalViewerId(req);
  try {
    const rows = await db.execute(sql`
      SELECT ls.id, ls.seller_id, ls.title, ls.viewer_count, ls.product_tags,
             ls.thumbnail_url, ls.started_at,
             u.display_name AS seller_name, u.brand_name, u.avatar_url, u.username,
             COALESCE(u.verified, false) AS verified,
             ${viewerId
               ? sql`EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId} AND f.following_id = ls.seller_id)`
               : sql`false`} AS followed
      FROM live_streams ls
      LEFT JOIN users u ON u.clerk_id = ls.seller_id
      WHERE ls.status = 'live'
        AND (u.suspended_at IS NULL)
        ${viewerId ? sql`AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = ls.seller_id)
             OR (b.blocker_id = ls.seller_id AND b.blocked_id = ${viewerId})
        )` : sql``}
      ORDER BY ls.viewer_count DESC
      LIMIT 200
    `);
    return res.json({ streams: rankLiveFeed(rows.rows as any[]) });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/live/:id ────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const viewerId = optionalViewerId(req);
  try {
    const rows = await db.execute(sql`
      SELECT ls.*, u.display_name AS seller_name, u.brand_name, u.avatar_url
      FROM live_streams ls
      LEFT JOIN users u ON u.clerk_id = ls.seller_id
      WHERE ls.id = ${req.params.id}::uuid
    `);
    if (!rows.rows.length) return res.status(404).json({ error: "Not found" });

    const row = rows.rows[0] as any;
    const isOwner = !!viewerId && viewerId === row.seller_id;

    // Recording internals (Agora resourceId/sid) are never returned to any
    // client — they're only ever needed server-side. `recording_status` /
    // `recording_error` (the "Replay unavailable" state) are shown only to
    // the seller who went live, the same pattern as other owner-only fields
    // in this codebase (see hydrateVideoRows' `isOwnerView` in
    // routes/profile-media.ts): buyers/viewers never see them, and never
    // see a replay reference unless `replay_url` is actually set (it's only
    // ever set once a recording is confirmed uploaded — see lib/liveReplay.ts).
    const {
      recording_resource_id, recording_sid, recording_status, recording_error,
      recording_uid, recording_started_at, recording_stopped_at,
      ...publicRow
    } = row;

    return res.json({
      stream: {
        ...publicRow,
        ...(isOwner ? { recordingStatus: recording_status, recordingError: recording_error } : {}),
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/live/:id/join ──────────────────────────────────────────────────
router.post("/:id/join", requireAuth, async (req, res) => {
  const viewerId = (req as any).clerkUserId as string;
  const { id } = req.params;

  try {
    const rows = await db.execute(sql`
      SELECT id, channel_name, status, agora_uid, seller_id
      FROM live_streams WHERE id = ${id}::uuid
    `);
    if (!rows.rows.length) return res.status(404).json({ error: "Stream not found" });
    const stream = rows.rows[0] as any;
    if (stream.status !== "live") {
      return res.status(410).json({ error: "Stream has ended" });
    }

    // Moderation: a viewer the host banned can't rejoin this stream. (See
    // routes/live-moderation.ts.) Streams with no moderation rows are unaffected.
    if (!canJoinStream(await loadRestriction(String(id), viewerId), viewerId === stream.seller_id)) {
      return res.status(403).json({ error: "You can't join this live.", code: "BANNED" });
    }

    // Presence: mark this viewer live right away so the count feels instant
    // even before the periodic recompute job's next tick. The WebSocket
    // connection (or the /heartbeat fallback) keeps this row fresh from
    // here on — this is not an increment, just the first heartbeat.
    await db.execute(sql`
      INSERT INTO live_viewers (stream_id, user_id_or_session_id, last_seen)
      VALUES (${id}::uuid, ${viewerId}, now())
      ON CONFLICT (stream_id, user_id_or_session_id)
      DO UPDATE SET last_seen = now()
    `);

    const appId   = process.env.AGORA_APP_ID ?? "";
    const appCert = process.env.AGORA_APP_CERTIFICATE ?? "";
    const viewerUid = uidFromClerkId(viewerId + "_viewer");
    const token = generateToken(appId, appCert, stream.channel_name, viewerUid, 0 /* SUBSCRIBER */);

    return res.json({
      channelName: stream.channel_name,
      agoraUid: viewerUid,
      agoraAppId: appId,
      token,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/live/:id/leave ─────────────────────────────────────────────────
router.post("/:id/leave", requireAuth, async (req, res) => {
  const viewerId = (req as any).clerkUserId as string;
  try {
    await db.execute(sql`
      DELETE FROM live_viewers
      WHERE stream_id = ${req.params.id}::uuid AND user_id_or_session_id = ${viewerId}
    `);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/live/:id/heartbeat ─────────────────────────────────────────────
// HTTP fallback presence path for the client's slow-polling fallback mode
// (used when a WebSocket connection genuinely can't be established). The
// WebSocket heartbeat (ws/liveHub.ts) is the preferred path and covers this
// same row when the socket is up.
router.post("/:id/heartbeat", requireAuth, async (req, res) => {
  const viewerId = (req as any).clerkUserId as string;
  try {
    await db.execute(sql`
      INSERT INTO live_viewers (stream_id, user_id_or_session_id, last_seen)
      VALUES (${req.params.id}::uuid, ${viewerId}, now())
      ON CONFLICT (stream_id, user_id_or_session_id)
      DO UPDATE SET last_seen = now()
    `);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/live/:id/end ───────────────────────────────────────────────────
router.post("/:id/end", requireAuth, hostPlan, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;

  try {
    const rows = await db.execute(sql`
      SELECT * FROM live_streams
      WHERE id = ${req.params.id}::uuid AND seller_id = ${sellerId}
    `);
    if (!rows.rows.length) return res.status(404).json({ error: "Not found or not your stream" });
    const stream = rows.rows[0] as any;
    if (stream.status === "ended") return res.json({ ok: true, message: "Already ended" });

    // Mark as ended
    await db.execute(sql`
      UPDATE live_streams
      SET status = 'ended', ended_at = now()
      WHERE id = ${req.params.id}::uuid
    `);

    // Stop the Agora Cloud Recording session (if one is running) and, if the
    // upload is already confirmed, create the replay post right away.
    //
    // IMPORTANT: a replay post is only ever created once a real recording
    // file is confirmed uploaded — never here unconditionally. If recording
    // was never configured/started, or the upload isn't confirmed yet, no
    // post is created now; `recording_status` stays 'stopping' and
    // jobs/liveRecordingFinalize.ts finishes the job once Agora reports the
    // file as ready (or marks it 'failed' after a bounded timeout).
    let replayPostId: string | null = null;
    let replayStatus: "ready" | "pending" | "unavailable" = "unavailable";
    try {
      const { postId } = await stopCloudRecordingAndMaybeFinalize(stream);
      if (postId) {
        replayPostId = postId;
        replayStatus = "ready";
      } else if (stream.recording_status === "started") {
        replayStatus = "pending";
      }
    } catch (err) {
      logger.error({ err, streamId: stream.id }, "stopCloudRecordingAndMaybeFinalize threw unexpectedly");
    }

    return res.json({ ok: true, replayPostId, replayStatus });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── PATCH /api/live/:id/products ────────────────────────────────────────────
router.patch("/:id/products", requireAuth, hostPlan, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { productTags } = req.body;
  if (!Array.isArray(productTags)) return res.status(400).json({ error: "productTags must be an array" });

  try {
    const result = await db.execute(sql`
      UPDATE live_streams
      SET product_tags = ${JSON.stringify(productTags)}::jsonb
      WHERE id = ${req.params.id}::uuid AND seller_id = ${sellerId}
      RETURNING product_tags
    `);
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    const updatedTags = (result.rows[0] as any).product_tags;
    broadcastToRoom(String(req.params.id), { type: "products", productTags: updatedTags });
    return res.json({ productTags: updatedTags });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/live/:id/comment ───────────────────────────────────────────────
router.post("/:id/comment", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { message } = req.body;
  if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "message required" });
  if (message.length > 500) return res.status(400).json({ error: "message too long" });

  const restriction = await publishingRestriction(userId);
  if (restriction) return res.status(restriction.status).json(restriction.body);

  // displayName/avatarUrl are resolved from the caller's own profile — never
  // trust client-supplied identity fields here, or any authenticated viewer
  // could post live chat that visually impersonates another user/seller.
  const [viewer] = await db.execute(sql`
    SELECT display_name, brand_name, profile_image_url FROM users WHERE clerk_id = ${userId} LIMIT 1
  `).then((r) => r.rows as any[]);
  const displayName = viewer?.brand_name || viewer?.display_name || "Viewer";
  const avatarUrl = viewer?.profile_image_url ?? null;

  // Live chat is shown instantly, so it cannot wait in a review queue:
  // anything the public filter would hold is declined with an explanation.
  const decision = evaluateContent(message, "public");
  if (decision.action !== "allow") {
    return res.status(422).json({
      error: decision.action === "reject"
        ? decision.reason
        : `${decision.reason} Keep live chat friendly — it's visible to everyone watching.`,
      category: decision.category,
      code: "CONTENT_REJECTED",
    });
  }

  try {
    // Moderation (banned words / slow mode / mute / ban). No-op for a stream
    // with no settings. The host is never restricted.
    const [modStream] = await db.execute(sql`
      SELECT seller_id FROM live_streams WHERE id = ${req.params.id}::uuid LIMIT 1
    `).then((r) => r.rows as any[]);
    if (modStream) {
      const [settings, restriction] = await Promise.all([
        loadEffectiveSettings(String(req.params.id), modStream.seller_id),
        loadRestriction(String(req.params.id), userId),
      ]);
      const lastCommentAt = settings.slowModeSeconds > 0
        ? await loadLastCommentAt(String(req.params.id), userId)
        : null;
      const verdict = checkCommentAllowed({
        isHost: userId === modStream.seller_id,
        restriction,
        bannedWords: settings.bannedWords,
        slowModeSeconds: settings.slowModeSeconds,
        lastCommentAt,
        now: Date.now(),
        message,
      });
      if (!verdict.ok) {
        return res.status(verdict.status).json({
          error: verdict.error, code: verdict.code, retryAfterSeconds: verdict.retryAfterSeconds,
        });
      }
    }

    const result = await db.execute(sql`
      INSERT INTO live_comments (stream_id, user_id, display_name, avatar_url, message)
      VALUES (${req.params.id}::uuid, ${userId}, ${displayName ?? "Viewer"}, ${avatarUrl ?? null}, ${message.trim()})
      RETURNING *
    `);
    const comment = result.rows[0];
    broadcastToRoom(String(req.params.id), { type: "comment", comment });
    return res.status(201).json({ comment });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/live/:id/comments ───────────────────────────────────────────────
router.get("/:id/comments", async (req, res) => {
  const since = req.query.since as string | undefined;
  const viewerId = optionalViewerId(req);
  try {
    const rows = await db.execute(sql`
      SELECT id, user_id, display_name, avatar_url, message, created_at
      FROM live_comments lc
      WHERE stream_id = ${req.params.id}::uuid
        AND removed_at IS NULL
        ${since ? sql`AND created_at > ${since}::timestamptz` : sql``}
        AND NOT EXISTS (
          SELECT 1 FROM users su WHERE su.clerk_id = lc.user_id AND su.suspended_at IS NOT NULL
        )
        ${viewerId ? sql`AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = lc.user_id)
             OR (b.blocker_id = lc.user_id AND b.blocked_id = ${viewerId})
        )` : sql``}
      ORDER BY created_at DESC
      LIMIT 80
    `);
    return res.json({ comments: rows.rows });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
