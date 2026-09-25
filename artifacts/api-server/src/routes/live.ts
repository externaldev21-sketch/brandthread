/**
 * Live Shopping — Brandthread
 * Agora Interactive Live Streaming backend.
 *
 * Routes:
 *  POST   /api/live/start               seller starts a stream (host token)
 *  GET    /api/live/active              list active streams (for feed mixing)
 *  GET    /api/live/:id                 stream details (public, for viewer)
 *  POST   /api/live/:id/join            viewer gets token + increments count
 *  POST   /api/live/:id/leave           viewer decrements count
 *  POST   /api/live/:id/end             seller ends stream (saves replay)
 *  PATCH  /api/live/:id/products        update tagged products mid-stream
 *  POST   /api/live/:id/comment         add a chat comment
 *  GET    /api/live/:id/comments        poll recent comments
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { evaluateContent } from "../lib/contentModerator";
import { optionalViewerId, publishingRestriction } from "../lib/safety";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateToken(
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

function uidFromClerkId(clerkId: string): number {
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
router.post("/start", requireAuth, async (req, res) => {
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

// ─── GET /api/live/:id ────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT ls.*, u.display_name AS seller_name, u.brand_name, u.avatar_url
      FROM live_streams ls
      LEFT JOIN users u ON u.clerk_id = ls.seller_id
      WHERE ls.id = ${req.params.id}::uuid
    `);
    if (!rows.rows.length) return res.status(404).json({ error: "Not found" });
    return res.json({ stream: rows.rows[0] });
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
      SELECT id, channel_name, status, agora_uid
      FROM live_streams WHERE id = ${id}::uuid
    `);
    if (!rows.rows.length) return res.status(404).json({ error: "Stream not found" });
    const stream = rows.rows[0] as any;
    if (stream.status !== "live") {
      return res.status(410).json({ error: "Stream has ended" });
    }

    // Increment viewer count
    await db.execute(sql`
      UPDATE live_streams
      SET viewer_count      = viewer_count + 1,
          peak_viewer_count = GREATEST(peak_viewer_count, viewer_count + 1)
      WHERE id = ${id}::uuid
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
  try {
    await db.execute(sql`
      UPDATE live_streams
      SET viewer_count = GREATEST(0, viewer_count - 1)
      WHERE id = ${req.params.id}::uuid AND status = 'live'
    `);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/live/:id/end ───────────────────────────────────────────────────
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

    // Mark as ended
    await db.execute(sql`
      UPDATE live_streams
      SET status = 'ended', ended_at = now()
      WHERE id = ${req.params.id}::uuid
    `);

    // Save a replay post so the recording appears in the Thread feed
    const productTagIds = (stream.product_tags as any[])
      .map((t: any) => t.productId)
      .filter(Boolean);

    // Create a posts row as the replay
    const postResult = await db.execute(sql`
      INSERT INTO posts (user_id, media_url, media_type, caption, style_tags)
      VALUES (
        ${sellerId},
        ${stream.replay_url ?? ""},
        'video',
        ${"🔴 Live replay: " + stream.title + (stream.description ? " — " + stream.description : "")},
        '["live","replay"]'::json
      )
      RETURNING id
    `);
    const postId = (postResult.rows[0] as any).id;

    // Attach product tags to the post
    for (let i = 0; i < productTagIds.length; i++) {
      try {
        await db.execute(sql`
          INSERT INTO post_tagged_products (post_id, product_id, position)
          VALUES (${postId}::uuid, ${productTagIds[i]}::uuid, ${i})
          ON CONFLICT DO NOTHING
        `);
      } catch {}
    }

    // Update live_stream with replay_post_id
    await db.execute(sql`
      UPDATE live_streams SET replay_post_id = ${postId}::uuid
      WHERE id = ${req.params.id}::uuid
    `);

    return res.json({ ok: true, replayPostId: postId });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── PATCH /api/live/:id/products ────────────────────────────────────────────
router.patch("/:id/products", requireAuth, async (req, res) => {
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
    return res.json({ productTags: (result.rows[0] as any).product_tags });
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
    const result = await db.execute(sql`
      INSERT INTO live_comments (stream_id, user_id, display_name, avatar_url, message)
      VALUES (${req.params.id}::uuid, ${userId}, ${displayName ?? "Viewer"}, ${avatarUrl ?? null}, ${message.trim()})
      RETURNING *
    `);
    return res.status(201).json({ comment: result.rows[0] });
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
