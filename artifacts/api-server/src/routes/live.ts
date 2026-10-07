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
 *  POST   /api/live/:id/like            heart reactions (batched taps)
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
import { beginCloudRecording } from "../lib/liveReplay";
import { broadcastToRoom, roomUserIds } from "../ws/liveHub";
import { LiveProductTagError, resolveLiveProductTags } from "../lib/liveProductTags";
import { notifyFollowersSellerIsLive } from "../lib/liveGoLiveNotify";
import { endLiveStream } from "../lib/liveEnd";
import { MAX_LIVE_HOURS } from "../jobs/liveStaleStreams";

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
  /** Token lifetime; defaults to the whole stream (host + viewers). Co-hosts pass a short one. */
  expirySeconds: number = MAX_LIVE_HOURS * 3600,
): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
    // A live is ended by jobs/liveStaleStreams.ts once it reaches
    // MAX_LIVE_HOURS, so by default the media token covers the whole stream.
    const expireTs = Math.floor(Date.now() / 1000) + expirySeconds;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every :id route casts to uuid; a malformed id is a 404, never a 500. */
router.param("id", (req, res, next, id) => {
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }
  next();
});

async function blockedBetween(a: string, b: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM blocks
    WHERE (blocker_id = ${a} AND blocked_id = ${b}) OR (blocker_id = ${b} AND blocked_id = ${a})
    LIMIT 1
  `);
  return rows.rows.length > 0;
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

  let resolvedTags;
  try {
    resolvedTags = await resolveLiveProductTags(sellerId, productTags);
  } catch (err) {
    if (err instanceof LiveProductTagError) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  // Only one live stream per seller at a time. A seller can only broadcast
  // from one device, so a stream still marked live when they go live again
  // is a crashed/killed session: end it (viewers are told, its replay is
  // finalized) instead of locking the seller out with a 409.
  const existing = await db.execute(sql`
    SELECT id FROM live_streams
    WHERE seller_id = ${sellerId} AND status = 'live'
  `);
  for (const row of existing.rows as Array<{ id: string }>) {
    await endLiveStream(row.id, "restarted");
  }

  const channelName = randomChannelName();
  const agoraUid   = uidFromClerkId(sellerId);

  const token = generateToken(appId, appCert, channelName, agoraUid, 1 /* PUBLISHER */);

  const result = await db.execute(sql`
    INSERT INTO live_streams
      (seller_id, channel_name, title, description, status, product_tags,
       agora_uid, thumbnail_url, started_at, host_last_seen_at)
    VALUES
      (${sellerId}, ${channelName}, ${title.trim()},
       ${description ?? null}, 'live',
       ${JSON.stringify(resolvedTags)}::jsonb,
       ${agoraUid}, ${thumbnailUrl ?? null}, now(), now())
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

  // Followers hear about it now — the whole point of going live. Never
  // blocks or fails the start.
  notifyFollowersSellerIsLive({
    id: stream.id, sellerId, title: stream.title, thumbnailUrl: stream.thumbnail_url,
  }).catch((err) => logger.error({ err, streamId: stream.id }, "Go-live follower notification failed"));

  return res.status(201).json({
    stream: {
      id: stream.id,
      channelName: stream.channel_name,
      agoraUid:    stream.agora_uid,
      title:       stream.title,
      productTags: resolvedTags,
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
      SELECT id, seller_id, channel_name, status, agora_uid
      FROM live_streams WHERE id = ${id}::uuid
    `);
    if (!rows.rows.length) return res.status(404).json({ error: "Stream not found" });
    const stream = rows.rows[0] as any;
    if (stream.status !== "live") {
      return res.status(410).json({ error: "Stream has ended" });
    }
    if (stream.seller_id !== viewerId && await blockedBetween(viewerId, stream.seller_id)) {
      return res.status(404).json({ error: "Stream not found" });
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
    const [stream] = await db.execute(sql`
      SELECT seller_id, status FROM live_streams WHERE id = ${req.params.id}::uuid
    `).then((r) => r.rows as Array<{ seller_id: string; status: string }>);
    if (!stream) return res.status(404).json({ error: "Stream not found" });
    // An ended stream gets no new presence; the client stops on 410.
    if (stream.status !== "live") return res.status(410).json({ error: "Stream has ended", ended: true });
    if (stream.seller_id === viewerId) {
      // The host's fallback heartbeat keeps the stream from being swept as
      // abandoned; the host is never counted as a viewer.
      await db.execute(sql`UPDATE live_streams SET host_last_seen_at = now() WHERE id = ${req.params.id}::uuid`);
      return res.json({ ok: true });
    }
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
// No plan gate: a host whose plan lapsed mid-stream must still be able to
// end it (starting and re-tagging still require Pro).
router.post("/:id/end", requireAuth, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;

  try {
    const rows = await db.execute(sql`
      SELECT * FROM live_streams
      WHERE id = ${req.params.id}::uuid AND seller_id = ${sellerId}
    `);
    if (!rows.rows.length) return res.status(404).json({ error: "Not found or not your stream" });
    const stream = rows.rows[0] as any;
    if (stream.status === "ended") return res.json({ ok: true, message: "Already ended" });

    const result = await endLiveStream(stream.id, "host");
    const { replayPostId, replayStatus } = result;
    return res.json({ ok: true, replayPostId, replayStatus });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── PATCH /api/live/:id/products ────────────────────────────────────────────
router.patch("/:id/products", requireAuth, hostPlan, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { productTags } = req.body ?? {};
  if (!Array.isArray(productTags)) return res.status(400).json({ error: "productTags must be an array" });

  try {
    // Names, prices and images come from the seller's catalogue — never
    // from the request — so viewers can't be shown a made-up price.
    const resolved = await resolveLiveProductTags(sellerId, productTags);
    const result = await db.execute(sql`
      UPDATE live_streams
      SET product_tags = ${JSON.stringify(resolved)}::jsonb
      WHERE id = ${req.params.id}::uuid AND seller_id = ${sellerId} AND status = 'live'
      RETURNING product_tags
    `);
    if (!result.rows.length) {
      const [owned] = await db.execute(sql`
        SELECT status FROM live_streams WHERE id = ${req.params.id}::uuid AND seller_id = ${sellerId}
      `).then((r) => r.rows as Array<{ status: string }>);
      if (owned) return res.status(410).json({ error: "This live has ended." });
      return res.status(404).json({ error: "Not found" });
    }
    const updatedTags = (result.rows[0] as any).product_tags;
    broadcastToRoom(String(req.params.id), { type: "products", productTags: updatedTags });
    return res.json({ productTags: updatedTags });
  } catch (e: any) {
    if (e instanceof LiveProductTagError) return res.status(e.status).json({ error: e.message });
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

  const [stream] = await db.execute(sql`
    SELECT seller_id, status FROM live_streams WHERE id = ${req.params.id}::uuid
  `).then((r) => r.rows as Array<{ seller_id: string; status: string }>);
  if (!stream) return res.status(404).json({ error: "Stream not found" });
  if (stream.status !== "live") return res.status(410).json({ error: "This live has ended.", code: "LIVE_STREAM_ENDED" });
  if (stream.seller_id !== userId && await blockedBetween(userId, stream.seller_id)) {
    return res.status(403).json({ error: "You can't comment on this live.", code: "LIVE_COMMENT_BLOCKED" });
  }

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
    const result = await db.execute(sql`
      INSERT INTO live_comments (stream_id, user_id, display_name, avatar_url, message)
      VALUES (${req.params.id}::uuid, ${userId}, ${displayName ?? "Viewer"}, ${avatarUrl ?? null}, ${message.trim()})
      RETURNING *
    `);
    const comment = result.rows[0];
    // Same filter GET /comments applies per viewer: anyone in a block
    // relationship with the commenter never receives the line live either.
    const present = roomUserIds(String(req.params.id)).filter((id) => id !== userId);
    let skip: Set<string> | undefined;
    if (present.length > 0) {
      const presentList = sql.join(present.map((id) => sql`${id}`), sql`, `);
      const blocked = await db.execute(sql`
        SELECT CASE WHEN blocker_id = ${userId} THEN blocked_id ELSE blocker_id END AS other
        FROM blocks
        WHERE (blocker_id = ${userId} AND blocked_id IN (${presentList}))
           OR (blocked_id = ${userId} AND blocker_id IN (${presentList}))
      `);
      if (blocked.rows.length) skip = new Set((blocked.rows as Array<{ other: string }>).map((r) => r.other));
    }
    broadcastToRoom(String(req.params.id), { type: "comment", comment }, { skipUserIds: skip });
    return res.status(201).json({ comment });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/live/:id/like ──────────────────────────────────────────────────
// Body: { count?: 1..20 } — the client batches rapid heart taps. A per-user
// window caps how fast one viewer can inflate the total.
const LIKE_WINDOW_MS = 10_000;
const LIKES_PER_WINDOW = 60;
const likeWindows = new Map<string, { startedAt: number; used: number }>();

router.post("/:id/like", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const requested = Math.floor(Number(req.body?.count ?? 1));
  if (!Number.isFinite(requested) || requested < 1) return res.status(400).json({ error: "count must be at least 1" });

  const key = `${req.params.id}:${userId}`;
  const now = Date.now();
  let windowState = likeWindows.get(key);
  if (!windowState || now - windowState.startedAt > LIKE_WINDOW_MS) {
    windowState = { startedAt: now, used: 0 };
    likeWindows.set(key, windowState);
  }
  const count = Math.min(requested, 20, LIKES_PER_WINDOW - windowState.used);
  if (likeWindows.size > 50_000) {
    for (const [k, v] of likeWindows) if (now - v.startedAt > LIKE_WINDOW_MS) likeWindows.delete(k);
  }

  const [stream] = await db.execute(sql`
    SELECT seller_id, status, like_count FROM live_streams WHERE id = ${req.params.id}::uuid
  `).then((r) => r.rows as Array<{ seller_id: string; status: string; like_count: number }>);
  if (!stream) return res.status(404).json({ error: "Stream not found" });
  if (stream.status !== "live") return res.status(410).json({ error: "This live has ended." });
  if (count <= 0) return res.json({ likeCount: stream.like_count, accepted: 0 });
  windowState.used += count;

  const [row] = await db.execute(sql`
    UPDATE live_streams SET like_count = like_count + ${count}
    WHERE id = ${req.params.id}::uuid AND status = 'live'
    RETURNING like_count
  `).then((r) => r.rows as Array<{ like_count: number }>);
  const likeCount = row?.like_count ?? stream.like_count;
  broadcastToRoom(String(req.params.id), { type: "likes", likeCount, userId, added: count });
  return res.json({ likeCount, accepted: count });
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
