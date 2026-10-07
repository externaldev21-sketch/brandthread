/**
 * Live co-host: a host invites another seller onto their stream.
 *
 *  GET    /api/live/cohost-candidates?q=      host: sellers to invite (followed first)
 *  GET    /api/live/cohost-invites            me: pending invites addressed to me
 *  GET    /api/live/:id/cohosts               anyone: accepted co-hosts (badge / second tile)
 *  POST   /api/live/:id/cohost/invite         host: { userId }
 *  POST   /api/live/:id/cohost/cancel         host: { userId } cancels a pending invite
 *  POST   /api/live/:id/cohost/respond        invitee: { accept: boolean } -> publisher token on accept
 *  POST   /api/live/:id/cohost/token          accepted co-host: fresh publisher token (rejoin)
 *  POST   /api/live/:id/cohost/remove         host: { userId } removes an accepted co-host
 *  POST   /api/live/:id/cohost/leave          co-host leaves
 *
 * Plan: only the host needs Pro (they started the stream). A co-host only has
 * to be a seller account in good standing. State machine: lib/liveCohost.ts.
 * Realtime: a `cohosts` event with the accepted list is broadcast to the room.
 */
import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { broadcastToRoom } from "../ws/liveHub";
import { publishNotification } from "./notifications-feed";
import { generateToken, uidFromClerkId } from "./live";
import {
  checkInviteAllowed, transitionCohost, type CohostAction, type CohostActor, type CohostStatus,
} from "../lib/liveCohost";
import { logger } from "../lib/logger";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((e: any) => { if (!res.headersSent) res.status(500).json({ error: e?.message ?? "Server error" }); });
  };
}

async function loadStream(req: Request, res: Response): Promise<any | null> {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid stream id" }); return null; }
  const r = await db.execute(sql`
    SELECT id, seller_id, channel_name, status, title FROM live_streams WHERE id = ${id}::uuid LIMIT 1
  `);
  const stream = r.rows[0] as any;
  if (!stream) { res.status(404).json({ error: "Stream not found" }); return null; }
  return stream;
}

async function acceptedCohosts(streamId: string) {
  const r = await db.execute(sql`
    SELECT c.cohost_id, c.agora_uid,
           COALESCE(u.brand_name, u.display_name, 'Co-host') AS display_name,
           COALESCE(u.username, '') AS username, u.profile_image_url
    FROM live_cohosts c LEFT JOIN users u ON u.clerk_id = c.cohost_id
    WHERE c.stream_id = ${streamId}::uuid AND c.status = 'accepted'
    ORDER BY c.responded_at ASC
  `);
  return (r.rows as any[]).map((row) => ({
    userId: row.cohost_id, agoraUid: row.agora_uid, displayName: row.display_name,
    username: row.username, avatarUrl: row.profile_image_url ?? null,
  }));
}

async function broadcastCohosts(streamId: string) {
  try { broadcastToRoom(streamId, { type: "cohosts", cohosts: await acceptedCohosts(streamId) }); }
  catch (err) { logger.warn({ err, streamId }, "cohost broadcast failed"); }
}

async function blockedEitherWay(a: string, b: string): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT 1 FROM blocks
    WHERE (blocker_id = ${a} AND blocked_id = ${b}) OR (blocker_id = ${b} AND blocked_id = ${a})
    LIMIT 1
  `);
  return r.rows.length > 0;
}

function cohostUid(streamId: string, userId: string): number {
  return uidFromClerkId(`${userId}_cohost_${streamId}`);
}

function publisherCreds(stream: any, userId: string) {
  const appId = process.env.AGORA_APP_ID ?? "";
  const appCert = process.env.AGORA_APP_CERTIFICATE ?? "";
  const uid = cohostUid(stream.id, userId);
  return {
    channelName: stream.channel_name,
    agoraUid: uid,
    agoraAppId: appId,
    token: generateToken(appId, appCert, stream.channel_name, uid, 1 /* PUBLISHER */),
  };
}

// ─── Host: find sellers to invite ────────────────────────────────────────────
router.get("/cohost-candidates", requireAuth, wrap(async (req, res) => {
  const me = (req as any).clerkUserId as string;
  const q = String(req.query.q ?? "").trim().toLowerCase().slice(0, 60);
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = await db.execute(sql`
    SELECT u.clerk_id, COALESCE(u.username, '') AS username,
           COALESCE(u.brand_name, u.display_name, '') AS display_name, u.profile_image_url,
           EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${me} AND f.following_id = u.clerk_id) AS followed
    FROM users u
    WHERE u.clerk_id <> ${me}
      AND u.account_type IN ('seller', 'both')
      AND u.suspended_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = ${me} AND b.blocked_id = u.clerk_id) OR (b.blocker_id = u.clerk_id AND b.blocked_id = ${me})
      )
      ${q ? sql`AND (LOWER(COALESCE(u.username, '')) LIKE ${like} OR LOWER(COALESCE(u.brand_name, '')) LIKE ${like} OR LOWER(COALESCE(u.display_name, '')) LIKE ${like})` : sql``}
    ORDER BY followed DESC, display_name ASC
    LIMIT 25
  `);
  return res.json({
    sellers: (rows.rows as any[]).map((r) => ({
      userId: r.clerk_id, username: r.username, displayName: r.display_name,
      avatarUrl: r.profile_image_url ?? null, followed: !!r.followed,
    })),
  });
}));

// ─── Invitee: my pending invites ─────────────────────────────────────────────
router.get("/cohost-invites", requireAuth, wrap(async (req, res) => {
  const me = (req as any).clerkUserId as string;
  const rows = await db.execute(sql`
    SELECT c.stream_id, c.created_at, ls.title,
           COALESCE(u.brand_name, u.display_name, 'A seller') AS host_name, COALESCE(u.username, '') AS host_username,
           u.profile_image_url AS host_avatar
    FROM live_cohosts c
    JOIN live_streams ls ON ls.id = c.stream_id AND ls.status = 'live'
    LEFT JOIN users u ON u.clerk_id = c.host_id
    WHERE c.cohost_id = ${me} AND c.status = 'invited'
    ORDER BY c.created_at DESC
  `);
  return res.json({
    invites: (rows.rows as any[]).map((r) => ({
      streamId: r.stream_id, title: r.title, hostName: r.host_name, hostUsername: r.host_username,
      hostAvatarUrl: r.host_avatar ?? null, createdAt: r.created_at,
    })),
  });
}));

// ─── Anyone: accepted co-hosts ───────────────────────────────────────────────
router.get("/:id/cohosts", wrap(async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid stream id" });
  return res.json({ cohosts: await acceptedCohosts(id) });
}));

// ─── Host: invite ────────────────────────────────────────────────────────────
router.post("/:id/cohost/invite", requireAuth, wrap(async (req, res) => {
  const me = (req as any).clerkUserId as string;
  const stream = await loadStream(req, res);
  if (!stream) return;
  if (stream.seller_id !== me) return res.status(403).json({ error: "Only the host can invite co-hosts" });
  const inviteeId = req.body?.userId;
  if (typeof inviteeId !== "string" || !inviteeId) return res.status(400).json({ error: "userId required" });

  const [invitee] = await db.execute(sql`
    SELECT account_type, (suspended_at IS NOT NULL) AS suspended FROM users WHERE clerk_id = ${inviteeId} LIMIT 1
  `).then((r) => r.rows as any[]);
  if (!invitee) return res.status(404).json({ error: "Seller not found" });
  const [{ blocked }] = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM blocks b WHERE (b.blocker_id = ${me} AND b.blocked_id = ${inviteeId})
                                OR (b.blocker_id = ${inviteeId} AND b.blocked_id = ${me})
    ) AS blocked
  `).then((r) => r.rows as any[]);
  const open = await db.execute(sql`
    SELECT cohost_id FROM live_cohosts WHERE stream_id = ${stream.id}::uuid AND status IN ('invited', 'accepted')
  `);
  const openIds = (open.rows as any[]).map((r) => r.cohost_id);

  const verdict = checkInviteAllowed({
    hostId: me, inviteeId, streamStatus: stream.status,
    inviteeAccountType: invitee.account_type, inviteeSuspended: !!invitee.suspended,
    blocked: !!blocked, openCohostCount: openIds.length, alreadyOpen: openIds.includes(inviteeId),
  });
  if (!verdict.ok) return res.status(verdict.status).json({ error: verdict.error });

  await db.execute(sql`
    INSERT INTO live_cohosts (stream_id, host_id, cohost_id, status)
    VALUES (${stream.id}::uuid, ${me}, ${inviteeId}, 'invited')
  `);

  const [host] = await db.execute(sql`
    SELECT COALESCE(brand_name, display_name, 'A seller') AS name, COALESCE(username, '') AS username
    FROM users WHERE clerk_id = ${me} LIMIT 1
  `).then((r) => r.rows as any[]);
  try {
    await publishNotification({
      userId: inviteeId, category: "social", type: "live_cohost_invite",
      title: `${host?.name ?? "A seller"} invited you to co-host their live`,
      body: stream.title, actorName: host?.name, actorHandle: host?.username, actorId: me,
      targetId: stream.id, targetType: "live_cohost", cta: "Respond",
    });
  } catch (err) {
    logger.warn({ err, streamId: stream.id }, "co-host invite notification failed");
  }
  return res.status(201).json({ ok: true });
}));

// ─── Shared transition helper ────────────────────────────────────────────────
async function applyTransition(
  req: Request, res: Response, stream: any, cohostId: string, action: CohostAction, actor: CohostActor,
): Promise<CohostStatus | null> {
  const r = await db.execute(sql`
    SELECT id, status FROM live_cohosts
    WHERE stream_id = ${stream.id}::uuid AND cohost_id = ${cohostId} AND status IN ('invited', 'accepted')
    LIMIT 1
  `);
  const row = r.rows[0] as any;
  if (!row) { res.status(404).json({ error: "No open invite" }); return null; }
  const t = transitionCohost(row.status, action, actor);
  if (!t.ok) { res.status(t.status).json({ error: t.error }); return null; }
  // Compare-and-set on the previous status so two racing requests can't both win.
  const updated = await db.execute(sql`
    UPDATE live_cohosts
    SET status = ${t.to},
        responded_at = CASE WHEN ${t.to} IN ('accepted', 'declined') THEN now() ELSE responded_at END,
        ended_at = CASE WHEN ${t.to} IN ('declined', 'cancelled', 'removed', 'left') THEN now() ELSE ended_at END,
        agora_uid = CASE WHEN ${t.to} = 'accepted' THEN ${cohostUid(stream.id, cohostId)} ELSE agora_uid END
    WHERE id = ${row.id}::uuid AND status = ${row.status}
    RETURNING id
  `);
  if (!updated.rows.length) { res.status(409).json({ error: "Invite changed, try again" }); return null; }
  return t.to;
}

router.post("/:id/cohost/cancel", requireAuth, wrap(async (req, res) => {
  const me = (req as any).clerkUserId as string;
  const stream = await loadStream(req, res);
  if (!stream) return;
  if (stream.seller_id !== me) return res.status(403).json({ error: "Only the host can do that" });
  if (typeof req.body?.userId !== "string") return res.status(400).json({ error: "userId required" });
  if (await applyTransition(req, res, stream, req.body.userId, "cancel", "host")) return res.json({ ok: true });
  return undefined;
}));

router.post("/:id/cohost/respond", requireAuth, wrap(async (req, res) => {
  const me = (req as any).clerkUserId as string;
  const stream = await loadStream(req, res);
  if (!stream) return;
  const accept = req.body?.accept === true;
  if (accept && stream.status !== "live") return res.status(410).json({ error: "Stream has ended" });
  // A block placed after the invite went out (either way) means no joining.
  if (accept && await blockedEitherWay(me, stream.seller_id)) {
    return res.status(403).json({ error: "You can't join this live" });
  }
  const to = await applyTransition(req, res, stream, me, accept ? "accept" : "decline", "cohost");
  if (!to) return;
  if (accept) {
    await broadcastCohosts(stream.id);
    return res.json({ ok: true, status: to, ...publisherCreds(stream, me) });
  }
  return res.json({ ok: true, status: to });
}));

router.post("/:id/cohost/token", requireAuth, wrap(async (req, res) => {
  const me = (req as any).clerkUserId as string;
  const stream = await loadStream(req, res);
  if (!stream) return;
  if (stream.status !== "live") return res.status(410).json({ error: "Stream has ended" });
  const r = await db.execute(sql`
    SELECT 1 FROM live_cohosts WHERE stream_id = ${stream.id}::uuid AND cohost_id = ${me} AND status = 'accepted' LIMIT 1
  `);
  if (!r.rows.length) return res.status(403).json({ error: "You are not a co-host of this live" });
  if (await blockedEitherWay(me, stream.seller_id)) return res.status(403).json({ error: "You can't join this live" });
  return res.json(publisherCreds(stream, me));
}));

router.post("/:id/cohost/remove", requireAuth, wrap(async (req, res) => {
  const me = (req as any).clerkUserId as string;
  const stream = await loadStream(req, res);
  if (!stream) return;
  if (stream.seller_id !== me) return res.status(403).json({ error: "Only the host can remove a co-host" });
  if (typeof req.body?.userId !== "string") return res.status(400).json({ error: "userId required" });
  if (await applyTransition(req, res, stream, req.body.userId, "remove", "host")) {
    broadcastToRoom(stream.id, { type: "cohost_removed", userId: req.body.userId });
    await broadcastCohosts(stream.id);
    res.json({ ok: true });
  }
  return undefined;
}));

router.post("/:id/cohost/leave", requireAuth, wrap(async (req, res) => {
  const me = (req as any).clerkUserId as string;
  const stream = await loadStream(req, res);
  if (!stream) return;
  if (await applyTransition(req, res, stream, me, "leave", "cohost")) {
    await broadcastCohosts(stream.id);
    res.json({ ok: true });
  }
  return undefined;
}));

export default router;
