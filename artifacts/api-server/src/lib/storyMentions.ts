/**
 * Story @mentions + reshares: the server-side rules.
 *
 * - Size and position never decide whether a tag counts: a sticker pinched to
 *   near-invisible and parked off in a corner still registers (Instagram
 *   behaviour people use to tag without altering the photo's look).
 * - `sanitizeStoryMentions` turns the client's mention stickers (and "@name"
 *   typed into a text overlay) into verified mention rows. Anything that can't
 *   be tagged (yourself, a missing/deleted/suspended account, anyone blocked in
 *   either direction) is dropped silently — the sticker disappears from the
 *   published story and the tagger is never told why.
 * - `routeStoryReply` decides whether a reply to a mention story lands in the
 *   recipient's main inbox or in Requests (Dev's rule: the recipient follows the
 *   sender, OR the recipient is a seller and the sender has a paid order with
 *   them). Kept in its own function so the shared DM-routing implementation can
 *   replace it in one place.
 */
import {
  db, users, follows, blocks, orders, stories, storyMentions, conversations, conversationParticipants,
} from "@workspace/db";
import { and, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { extractMentions } from "./activityEvents";

/** Instagram allows up to 10 mentions on a story. */
export const MAX_STORY_MENTIONS = 10;

export const MENTION_STYLES = ["classic", "outline", "solid", "neon"] as const;
export type MentionStyle = (typeof MENTION_STYLES)[number];

export interface MentionSticker {
  overlayId: string;
  /** Index of the media slide the sticker sits on. */
  slide: number;
  /** 'mention' sticker, or '@name' typed into a 'text' overlay. */
  source: "sticker" | "text";
  x: number;
  y: number;
  scale: number;
  rotation: number;
  style: MentionStyle;
  /** Sticker opacity 0–1. */
  opacity: number;
}

export interface VerifiedMention {
  userId: string;
  sticker: MentionSticker;
}

const num = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Everyone who can't be tagged by `taggerId` — blocked in either direction. */
async function blockedEitherWay(taggerId: string): Promise<Set<string>> {
  const rows = await db
    .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, taggerId), eq(blocks.blockedId, taggerId)));
  return new Set(rows.map((row) => (row.blockerId === taggerId ? row.blockedId : row.blockerId)));
}

/**
 * Validate a story's media. Returns the media with unusable mention stickers
 * removed (and the rest normalised to the server's truth: handle and name come
 * from the users table) plus the verified, de-duplicated mentions.
 */
export async function sanitizeStoryMentions(
  media: any[],
  taggerId: string,
): Promise<{ media: any[]; mentions: VerifiedMention[] }> {
  type Candidate = { slide: number; overlay: any; userId?: string; handle?: string; source: "sticker" | "text" };
  const candidates: Candidate[] = [];
  media.forEach((item, slide) => {
    const overlays: any[] = Array.isArray(item?.overlays) ? item.overlays : [];
    for (const overlay of overlays) {
      if (overlay?.type === "mention") {
        const userId = typeof overlay.mentionUserId === "string" ? overlay.mentionUserId : undefined;
        const handle = typeof overlay.mentionHandle === "string"
          ? overlay.mentionHandle.replace(/^@/, "").toLowerCase() : undefined;
        candidates.push({ slide, overlay, userId, handle, source: "sticker" });
      } else if (overlay?.type === "text" && typeof overlay.text === "string") {
        for (const handle of extractMentions(overlay.text)) {
          candidates.push({ slide, overlay, handle, source: "text" });
        }
      }
    }
  });

  if (candidates.length === 0) return { media, mentions: [] };

  const ids = [...new Set(candidates.map((c) => c.userId).filter((v): v is string => !!v))];
  const handles = [...new Set(candidates.map((c) => c.handle).filter((v): v is string => !!v))];
  const conditions = [
    ...(ids.length ? [inArray(users.clerkId, ids)] : []),
    ...(handles.length ? [inArray(sql`lower(${users.username})`, handles)] : []),
  ];
  const found = conditions.length
    ? await db
      .select({
        clerkId: users.clerkId, username: users.username, name: users.name,
        displayName: users.displayName, suspendedAt: users.suspendedAt, deletedAt: users.deletedAt,
      })
      .from(users)
      .where(and(or(...conditions), isNull(users.deletedAt), isNull(users.suspendedAt)))
    : [];
  const byId = new Map(found.map((u) => [u.clerkId, u]));
  const byHandle = new Map(found.filter((u) => u.username).map((u) => [u.username!.toLowerCase(), u]));
  const blocked = await blockedEitherWay(taggerId);

  const mentions: VerifiedMention[] = [];
  const taken = new Set<string>();
  const droppedOverlays = new Set<any>();
  const keptOverlays = new Set<any>();

  for (const c of candidates) {
    const target = (c.userId && byId.get(c.userId)) || (c.handle ? byHandle.get(c.handle) : undefined);
    const ok = !!target && target.clerkId !== taggerId && !blocked.has(target.clerkId);
    if (!ok) {
      if (c.source === "sticker") droppedOverlays.add(c.overlay);
      continue;
    }
    if (c.source === "sticker") {
      // Normalise to server truth so a client can't forge the handle shown to viewers.
      c.overlay.mentionUserId = target.clerkId;
      c.overlay.mentionHandle = target.username ? `@${target.username}` : c.overlay.mentionHandle;
      c.overlay.mentionName = target.displayName || target.name;
      if (!MENTION_STYLES.includes(c.overlay.mentionStyle)) c.overlay.mentionStyle = "classic";
      keptOverlays.add(c.overlay);
    }
    if (taken.has(target.clerkId)) continue;
    if (mentions.length >= MAX_STORY_MENTIONS) {
      if (c.source === "sticker") { droppedOverlays.add(c.overlay); keptOverlays.delete(c.overlay); }
      continue;
    }
    taken.add(target.clerkId);
    mentions.push({
      userId: target.clerkId,
      sticker: {
        overlayId: String(c.overlay.id ?? ""),
        slide: c.slide,
        source: c.source,
        x: num(c.overlay.x, 0),
        y: num(c.overlay.y, 0),
        scale: num(c.overlay.scale, 1),
        rotation: num(c.overlay.rotation, 0),
        style: MENTION_STYLES.includes(c.overlay.mentionStyle) ? c.overlay.mentionStyle : "classic",
        opacity: Math.min(1, Math.max(0, num(c.overlay.opacity, 1))),
      },
    });
  }

  const cleaned = media.map((item) => {
    if (!Array.isArray(item?.overlays)) return item;
    return { ...item, overlays: item.overlays.filter((o: any) => !droppedOverlays.has(o)) };
  });
  return { media: cleaned, mentions };
}

// ─── Reply routing ────────────────────────────────────────────────────────────

export type ReplyRoute = "inbox" | "requests";

/**
 * Where a reply from `senderId` to `recipientId` lands. Main inbox when the
 * recipient follows the sender, or when the recipient is a seller and the
 * sender has a paid order with them on that account; Requests otherwise.
 */
export async function routeStoryReply(senderId: string, recipientId: string): Promise<ReplyRoute> {
  const [follow] = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(and(eq(follows.followerId, recipientId), eq(follows.followingId, senderId)))
    .limit(1);
  if (follow) return "inbox";

  const [recipient] = await db
    .select({ accountType: users.accountType })
    .from(users)
    .where(eq(users.clerkId, recipientId))
    .limit(1);
  if (recipient?.accountType === "seller") {
    const [paid] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(
        eq(orders.ownerId, recipientId),
        eq(orders.buyerId, senderId),
        isNotNull(orders.paidAt),
        ne(orders.status, "cancelled"),
      ))
      .limit(1);
    if (paid) return "inbox";
  }
  return "requests";
}

/**
 * Find or create the 1:1 conversation for a mention reply, routed per
 * `routeStoryReply`. An existing conversation is returned as-is (a thread that
 * was already accepted never drops back into Requests).
 */
export async function ensureStoryReplyConversation(senderId: string, recipientId: string) {
  const route = await routeStoryReply(senderId, recipientId);

  const mine = db.select({ id: conversationParticipants.conversationId })
    .from(conversationParticipants).where(eq(conversationParticipants.userId, senderId));
  const existing = await db
    .select({ conv: conversations })
    .from(conversationParticipants)
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
    .where(and(
      eq(conversationParticipants.userId, recipientId),
      inArray(conversationParticipants.conversationId, mine),
      ne(conversations.type, "group"),
      isNull(conversations.contextOrderId),
      isNull(conversations.deletedAt),
    ))
    .limit(1);
  if (existing[0]) return { conversation: existing[0].conv, route, created: false };

  const people = await db
    .select({
      clerkId: users.clerkId, name: users.name, displayName: users.displayName,
      brandName: users.brandName, username: users.username, accountType: users.accountType,
    })
    .from(users)
    .where(inArray(users.clerkId, [senderId, recipientId]));
  const sender = people.find((p) => p.clerkId === senderId);
  const recipient = people.find((p) => p.clerkId === recipientId);
  if (!sender || !recipient) return null;

  const sellerCount = [sender, recipient].filter((p) => p.accountType === "seller").length;
  const [conv] = await db.insert(conversations).values({
    type: sellerCount === 1 ? "buyer_to_seller" : "buyer_to_buyer",
    isRequest: route === "requests",
    requestedBy: route === "requests" ? senderId : null,
  }).returning();

  const participant = (p: typeof sender) => {
    const name = (p.accountType === "seller" ? p.brandName : null) || p.displayName || p.name;
    const parts = name.trim().split(/\s+/);
    return {
      conversationId: conv.id,
      userId: p.clerkId,
      name,
      handle: p.username ? `@${p.username}` : "",
      initials: (parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2)).toUpperCase(),
      color: "#8B5CF6",
      accountType: p.accountType ?? "buyer",
    };
  };
  await db.insert(conversationParticipants).values([participant(sender), participant(recipient)]);
  return { conversation: conv, route, created: true };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export async function recordStoryMentions(storyId: string, taggerId: string, mentions: VerifiedMention[]) {
  if (mentions.length === 0) return;
  await db.insert(storyMentions).values(mentions.map((m) => ({
    storyId, taggerId, mentionedUserId: m.userId, sticker: m.sticker as unknown as Record<string, unknown>,
  }))).onConflictDoNothing();
}

// ─── Reshare credit ───────────────────────────────────────────────────────────

export interface OriginalStoryInfo {
  storyId: string;
  authorId: string;
  authorHandle: string;
  authorName: string;
  /** False once the original expired, was removed or deleted → "Story unavailable". */
  available: boolean;
}

/**
 * Attach `original` (credit + availability) to story views that are reshares.
 * The credit always comes from the server-side columns, never from the media
 * the client uploaded.
 */
export async function withOriginalInfo<T extends { originalStoryId?: string | null; originalAuthorId?: string | null }>(
  views: T[],
): Promise<Array<T & { original: OriginalStoryInfo | null }>> {
  const reshares = views.filter((v) => v.originalStoryId && v.originalAuthorId);
  if (reshares.length === 0) return views.map((v) => ({ ...v, original: null }));

  const storyIds = [...new Set(reshares.map((v) => v.originalStoryId!))];
  const authorIds = [...new Set(reshares.map((v) => v.originalAuthorId!))];
  const [liveRows, authorRows] = await Promise.all([
    db.select({ id: stories.id }).from(stories)
      .where(and(inArray(stories.id, storyIds), gt(stories.expiresAt, new Date()), ne(stories.moderationStatus, "removed"))),
    db.select({ clerkId: users.clerkId, username: users.username, name: users.name, displayName: users.displayName, deletedAt: users.deletedAt })
      .from(users).where(inArray(users.clerkId, authorIds)),
  ]);
  const live = new Set(liveRows.map((r) => r.id));
  const authors = new Map(authorRows.map((a) => [a.clerkId, a]));

  return views.map((v) => {
    if (!v.originalStoryId || !v.originalAuthorId) return { ...v, original: null };
    const author = authors.get(v.originalAuthorId);
    return {
      ...v,
      original: {
        storyId: v.originalStoryId,
        authorId: v.originalAuthorId,
        authorHandle: author?.username ? `@${author.username}` : "",
        authorName: author?.displayName || author?.name || "Brandthread member",
        available: live.has(v.originalStoryId) && !author?.deletedAt,
      },
    };
  });
}
