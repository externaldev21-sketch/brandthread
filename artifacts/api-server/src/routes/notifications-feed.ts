/**
 * In-app notification feed (separate from push token registration).
 * GET    /api/buyer/notifications               — list, newest first
 *        ?limit=&offset=  page through the feed (limit defaults to 30, max 100).
 *                         With neither param the legacy single page of 100 is
 *                         returned so existing callers keep their behaviour.
 *        ?filter=orders|social  Activity Center filter chips.
 * GET    /api/buyer/notifications/actors?ids=   — the people behind one merged Activity row
 * GET    /api/buyer/notifications/unread-count  — { count } for bell badges
 * PATCH  /api/buyer/notifications/read-all      — mark all as read
 * PATCH  /api/buyer/notifications/:id/read      — mark one as read
 * DELETE /api/buyer/notifications/:id           — delete one
 * POST   /api/internal/notifications            — publish a notification (server-to-user)
 */
import { Router } from "express";
import { db, notificationsFeed, conversationParticipants, users, blocks, activityMutes, follows } from "@workspace/db";
import { eq, and, desc, inArray, notInArray, or, isNull, sql, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";
import {
  normalizePushEventCategory,
  sendPushToUser,
  type PushEventCategory,
} from "../lib/push";

export const router = Router();

// ─── Buyer-facing routes (all require auth) ───────────────────────────────────
const buyerRouter = Router();
buyerRouter.use(requireAuth);

const objectStorage = new ObjectStorageService();
/** Signed thumbnail URLs outlive a normal browsing session. */
const THUMBNAIL_URL_TTL_SEC = 60 * 60;

type FeedRow = typeof notificationsFeed.$inferSelect;

export function adapt(
  n: FeedRow,
  targetImageUrl: string | null = n.targetImageUrl ?? null,
  actorAvatarUrl: string | null = null,
) {
  return {
    id:            n.id,
    category:      n.category,
    type:          n.type,
    title:         n.title,
    body:          n.body,
    isRead:        n.isRead,
    isMuted:       n.isMuted,
    actorId:       n.actorId      ?? undefined,
    actorName:     n.actorName    ?? undefined,
    actorHandle:   n.actorHandle  ?? undefined,
    actorInitials: n.actorInitials ?? undefined,
    actorColor:    n.actorColor   ?? undefined,
    actorAvatarUrl: actorAvatarUrl ?? undefined,
    targetId:      n.targetId     ?? undefined,
    targetType:    n.targetType   ?? undefined,
    targetImageUrl: targetImageUrl ?? undefined,
    cta:           n.cta          ?? undefined,
    commentId:     n.commentId    ?? undefined,
    createdAt:     n.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

/**
 * Real profile photos for the actors on a page of feed rows — mirrors
 * social.ts's formatUser() resolution (an uploaded photo wins over the Clerk
 * avatar; a private /objects/ storage path is never exposed here).
 */
async function resolveActorAvatars(actorIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(actorIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ clerkId: users.clerkId, profileImageUrl: users.profileImageUrl, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.clerkId, ids));
  const map = new Map<string, string>();
  for (const row of rows) {
    const url = typeof row.profileImageUrl === "string" && row.profileImageUrl.startsWith("http")
      ? row.profileImageUrl
      : row.avatarUrl;
    if (typeof url === "string" && url.startsWith("http")) map.set(row.clerkId, url);
  }
  return map;
}

/**
 * Thumbnails may be private object-storage paths (product photos). Sign them
 * per read so the client gets a working URL without the feed persisting an
 * expiring link. Any signing failure degrades to "no thumbnail".
 */
async function resolveTargetImage(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!value.startsWith("/objects/")) return null;
  try {
    return await objectStorage.getObjectEntityDownloadURL(value, THUMBNAIL_URL_TTL_SEC);
  } catch (err) {
    logger.debug({ err }, "Could not sign notification thumbnail");
    return null;
  }
}

/** Feed categories the Activity Center shows under "Orders". */
export const ORDER_ACTIVITY_CATEGORIES = ["orders", "order", "payout", "payouts", "payment", "production", "returns"] as const;
/** Inventory alerts are inserted without an orders category but belong there. */
export const ORDER_ACTIVITY_TYPES = ["low_stock", "out_of_stock"] as const;
/**
 * price_drop/back_in_stock/new_product are published under category "stock"
 * (artifacts/api-server/src/lib/stockNotifications.ts) or "social"
 * (activityEvents.ts), but are always a buyer "things you follow/saved"
 * event for the Activity Center's Social filter.
 */
export const SOCIAL_ACTIVITY_TYPES = ["price_drop", "back_in_stock", "waitlist_restock", "product_restocked", "new_product"] as const;

function filterCondition(filter: unknown): SQL | undefined {
  if (filter === "orders") {
    return or(
      inArray(notificationsFeed.category, [...ORDER_ACTIVITY_CATEGORIES]),
      inArray(notificationsFeed.type, [...ORDER_ACTIVITY_TYPES]),
    );
  }
  if (filter === "social") {
    return or(
      eq(notificationsFeed.category, "social"),
      inArray(notificationsFeed.type, [...SOCIAL_ACTIVITY_TYPES]),
    );
  }
  return undefined;
}

function parsePage(query: Record<string, unknown>): { limit: number; offset: number } {
  const hasLimit = query.limit !== undefined;
  const hasOffset = query.offset !== undefined;
  // Legacy callers (the original notifications screen) send no paging params
  // and expect the most recent 100 in one response.
  if (!hasLimit && !hasOffset) return { limit: 100, offset: 0 };
  const rawLimit = Number.parseInt(String(query.limit ?? ""), 10);
  const rawOffset = Number.parseInt(String(query.offset ?? ""), 10);
  return {
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 30,
    offset: Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0,
  };
}

/**
 * Clerk IDs blocked in either direction — a blocked (or blocking-me) user's
 * activity (follows, likes, comments) must stop showing up here the moment
 * the block exists, per Instagram's own block behavior.
 */
async function blockedCounterpartIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
  return rows.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId));
}

/** Which new-follower actors on this page the viewer already follows. */
async function viewerFollowingFollowers(userId: string, rows: FeedRow[]): Promise<Set<string>> {
  const actorIds = [...new Set(rows
    .filter((row) => row.type === "new_follower" && row.actorId)
    .map((row) => row.actorId!))];
  if (actorIds.length === 0) return new Set();
  const following = await db.select({ followingId: follows.followingId }).from(follows)
    .where(and(eq(follows.followerId, userId), inArray(follows.followingId, actorIds)));
  return new Set(following.map((row) => row.followingId));
}

buyerRouter.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { limit, offset } = parsePage(req.query as Record<string, unknown>);
  const filter = filterCondition(req.query.filter);
  const blockedIds = await blockedCounterpartIds(userId);
  const conditions = [eq(notificationsFeed.userId, userId)];
  if (filter) conditions.push(filter);
  if (blockedIds.length > 0) {
    conditions.push(or(isNull(notificationsFeed.actorId), notInArray(notificationsFeed.actorId, blockedIds))!);
  }
  const rows = await db.select().from(notificationsFeed)
    .where(and(...conditions))
    .orderBy(desc(notificationsFeed.createdAt), desc(notificationsFeed.id))
    .limit(limit)
    .offset(offset);
  const [images, avatars, followingActors] = await Promise.all([
    Promise.all(rows.map((row) => resolveTargetImage(row.targetImageUrl ?? null))),
    resolveActorAvatars(rows.map((row) => row.actorId).filter((id): id is string => !!id)),
    viewerFollowingFollowers(userId, rows),
  ]);
  return res.json(rows.map((row, index) => {
    const item = adapt(row, images[index], row.actorId ? avatars.get(row.actorId) ?? null : null);
    // Live follow state for follow rows: the stored `cta: "Follow back"` is
    // written once, at follow time, so it goes stale the moment the viewer
    // follows back (here or anywhere else) — the inline pill must read
    // "Following" after a reload, not offer "Follow back" again.
    if (row.type === "new_follower" && row.actorId) {
      return { ...item, isFollowingActor: followingActors.has(row.actorId) };
    }
    return item;
  }));
});

/** Most feed ids one grouped-row lookup accepts ("Jay and 99 others"). */
export const GROUP_ACTORS_MAX_IDS = 100;

/**
 * GET /api/buyer/notifications/actors?ids=a,b,c
 *
 * The individual people behind one merged Activity row ("Jay and 12 others
 * liked your post"), for the pushed people list the row opens — Instagram's
 * "View likes" pattern (Mobbin: https://mobbin.com/flows/c575ad7c-8644-4b26-a3d0-ae737f855c13).
 * `ids` are the row's own feed item ids (ActivityRow.ids on the client), so
 * the list always matches the row's count exactly and works for every merged
 * type (likes, comments, reposts, story likes, follows) and for buyers and
 * sellers alike — it's the same per-user feed. Read-only; only the caller's
 * own feed rows are ever read, blocked people are dropped, and each actor
 * carries whether the caller already follows them for the Follow pill.
 */
buyerRouter.get("/actors", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const ids = [...new Set(String(req.query.ids ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean))]
    .slice(0, GROUP_ACTORS_MAX_IDS);
  if (ids.length === 0) return res.status(400).json({ error: "ids required" });

  const blockedIds = await blockedCounterpartIds(userId);
  const conditions = [eq(notificationsFeed.userId, userId), inArray(notificationsFeed.id, ids)];
  if (blockedIds.length > 0) {
    conditions.push(or(isNull(notificationsFeed.actorId), notInArray(notificationsFeed.actorId, blockedIds))!);
  }
  const rows = await db.select().from(notificationsFeed)
    .where(and(...conditions))
    .orderBy(desc(notificationsFeed.createdAt), desc(notificationsFeed.id));

  // Distinct actors, newest first — the same order the row's avatars use.
  const seen = new Set<string>();
  const actorRows = rows.filter((row) => {
    if (!row.actorId || seen.has(row.actorId)) return false;
    seen.add(row.actorId);
    return true;
  });
  const actorIds = actorRows.map((row) => row.actorId!);
  const [avatars, followingRows] = await Promise.all([
    resolveActorAvatars(actorIds),
    actorIds.length > 0
      ? db.select({ followingId: follows.followingId }).from(follows)
        .where(and(eq(follows.followerId, userId), inArray(follows.followingId, actorIds)))
      : Promise.resolve([] as { followingId: string }[]),
  ]);
  const followingSet = new Set(followingRows.map((row) => row.followingId));

  return res.json({
    actors: actorRows.map((row) => ({
      id: row.actorId!,
      name: row.actorName ?? "Someone",
      handle: row.actorHandle ?? undefined,
      initials: row.actorInitials ?? (row.actorName ?? "?").slice(0, 2).toUpperCase(),
      color: row.actorColor ?? undefined,
      avatarUrl: avatars.get(row.actorId!) ?? undefined,
      isFollowing: followingSet.has(row.actorId!),
      createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    })),
  });
});

/**
 * Cheap enough to short-poll every ~1.5s while a screen is focused (bell
 * badge, Activity Center) — the codebase has no websocket/SSE layer, so this
 * plus ETag/304 is how "real-time" delivery is approximated. `latestId`
 * changes on every new event (read/dismiss don't touch it), so the client
 * can tell "count changed" apart from "something new arrived" if it wants to.
 */
buyerRouter.get("/unread-count", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const [[countRow], [latestRow]] = await Promise.all([
    db.select({ count: sql<number>`cast(count(*) as int)` })
      .from(notificationsFeed)
      .where(and(
        eq(notificationsFeed.userId, userId),
        eq(notificationsFeed.isRead, false),
        eq(notificationsFeed.isMuted, false),
      )),
    db.select({ id: notificationsFeed.id })
      .from(notificationsFeed)
      .where(eq(notificationsFeed.userId, userId))
      .orderBy(desc(notificationsFeed.createdAt), desc(notificationsFeed.id))
      .limit(1),
  ]);
  const count = countRow?.count ?? 0;
  const etag = `"${count}-${latestRow?.id ?? "none"}"`;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("ETag", etag);
  if (req.headers["if-none-match"] === etag) { res.status(304).end(); return; }
  return res.json({ count, latestId: latestRow?.id ?? null });
});

buyerRouter.patch("/read-all", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  await db.update(notificationsFeed).set({ isRead: true })
    .where(eq(notificationsFeed.userId, userId));
  return res.json({ ok: true });
});

buyerRouter.patch("/:id/read", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  await db.update(notificationsFeed).set({ isRead: true })
    .where(and(eq(notificationsFeed.id, req.params.id), eq(notificationsFeed.userId, userId)));
  return res.json({ ok: true });
});

buyerRouter.delete("/:id", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  await db.delete(notificationsFeed)
    .where(and(eq(notificationsFeed.id, req.params.id), eq(notificationsFeed.userId, userId)));
  return res.json({ ok: true });
});

// ─── Internal publisher (used by other routes, e.g. order status webhooks) ───

export async function publishNotification(n: {
  userId:       string;
  category:     string;
  type:         string;
  title:        string;
  body?:        string;
  actorName?:   string;
  actorHandle?: string;
  actorInitials?: string;
  actorColor?:  string;
  targetId?:    string;
  targetType?:  string;
  cta?:         string;
  /** The specific comment (post_comment / comment_reply / mention). */
  commentId?:   string;
  actorId?:     string;
  targetImageUrl?: string | null;
  analyticsOwnerId?: string;
  pushCategory?: PushEventCategory;
  pushSound?: string | null;
  pushChannelId?: string;
  /** Promotional vs transactional override (see lib/pushPolicy.ts). */
  pushKind?: "transactional" | "promotional";
  /** The recipient asked for this exact alert (e.g. per-drop "notify me"). */
  pushExplicitRequest?: boolean;
}): Promise<void> {
  const pushCategory = n.pushCategory ?? normalizePushEventCategory(n.category);

  // "See less" preferences (Activity "..." menu) — a muted type or a muted
  // actor keeps future matching events out of the recipient's unread feed,
  // without silently dropping the row entirely (still fetchable, just muted).
  const muteKeys = [`type:${n.type}`, ...(n.actorId ? [`actor:${n.actorId}`] : [])];
  const muted = await db.select({ muteKey: activityMutes.muteKey }).from(activityMutes)
    .where(and(eq(activityMutes.userId, n.userId), inArray(activityMutes.muteKey, muteKeys)));
  const isMuted = muted.length > 0;

  const [notification] = await db
    .insert(notificationsFeed)
    .values({
      userId:       n.userId,
      category:     n.category,
      type:         n.type,
      title:        n.title,
      body:         n.body   ?? "",
      isMuted,
      actorName:    n.actorName    ?? null,
      actorHandle:  n.actorHandle  ?? null,
      actorInitials: n.actorInitials ?? null,
      actorColor:   n.actorColor   ?? null,
      targetId:     n.targetId     ?? null,
      targetType:   n.targetType   ?? null,
      cta:          n.cta          ?? null,
      actorId:      n.actorId      ?? null,
      targetImageUrl: n.targetImageUrl ?? null,
      commentId:    n.commentId    ?? null,
    })
    // Order alerts are unique by seller, type, and order target. The
    // database partial unique index is the concurrency-safe idempotency
    // boundary for webhook retries.
    .onConflictDoNothing()
    .returning({ id: notificationsFeed.id });

  // Do not send a second push when the in-app notification already existed,
  // and don't push a muted ("see less") event either — it's still visible if
  // the recipient goes looking, just not worth interrupting them for.
  if (!notification || isMuted) return;

  if (pushCategory) {
    // A muted conversation (conversation_participants.muted_until in the
    // future) only suppresses device delivery; the feed row above is kept and
    // unread state is unchanged.
    if (n.targetType === "conversation" && n.targetId) {
      const [participant] = await db.select({ mutedUntil: conversationParticipants.mutedUntil })
        .from(conversationParticipants)
        .where(and(
          eq(conversationParticipants.conversationId, n.targetId),
          eq(conversationParticipants.userId, n.userId),
        ))
        .limit(1);
      if (participant?.mutedUntil && participant.mutedUntil.getTime() > Date.now()) return;
    }

    await sendPushToUser(n.userId, {
      title: n.title,
      body: n.body ?? "",
      data: {
        notificationId: notification.id,
        type: n.type,
        category: n.category,
        targetId: n.targetId,
        targetType: n.targetType,
        cta: n.cta,
        commentId: n.commentId,
      },
      sound: n.pushSound,
      channelId: n.pushChannelId,
      kind: n.pushKind,
      explicitRequest: n.pushExplicitRequest,
    }, pushCategory, n.analyticsOwnerId);
  }
}

export default buyerRouter;
