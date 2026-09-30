/**
 * Communities — topic group chats ("Graphic Design Community").
 *
 * Separate from DMs/requests on purpose: joining IS consent, so there is no
 * request flow, and the model has no member cap (see
 * lib/db/src/schema/communities.ts for the unlimited-member design: message
 * `seq` cursor, one `last_read_seq` per member, counters on the community row).
 *
 * Unauthenticated (read-only discovery + invite preview)
 *   GET    /api/communities/public                 list official + public groups
 *   GET    /api/communities/invite/:code           preview a group from its invite code
 *
 * Authenticated
 *   GET    /api/communities                        discover (q, offset, limit)
 *   GET    /api/communities/mine                   my groups (inbox rows)
 *   POST   /api/communities                        create a group (rate limited)
 *   POST   /api/communities/join-by-code           join / request via invite code
 *   POST   /api/communities/upload-photo           moderated photo upload (icon, cover, chat)
 *   GET    /api/communities/:id                    detail
 *   PATCH  /api/communities/:id                    edit (admin)        DELETE /:id  delete (owner)
 *   POST   /api/communities/:id/join | /leave
 *   PATCH  /api/communities/:id/mute               { muted }
 *   PATCH  /api/communities/:id/read               { seq? }  move my read cursor
 *   GET    /api/communities/:id/invite             invite link (admins / public members)
 *   POST   /api/communities/:id/invite/reset       new invite code (admin)
 *   GET    /api/communities/:id/members            paginated member list
 *   DELETE /api/communities/:id/members/:userId    remove (admin)
 *   POST   /api/communities/:id/members/:userId/ban | DELETE /:id/bans/:userId
 *   PATCH  /api/communities/:id/members/:userId/role
 *   GET    /api/communities/:id/requests           pending join requests (admin)
 *   POST   /api/communities/:id/requests/:userId/approve | /deny
 *   GET    /api/communities/:id/messages           cursor history (before / after seq)
 *   POST   /api/communities/:id/messages           send (text + moderated photos)
 *   DELETE /api/communities/:id/messages/:mid      delete own / admin removes
 *   PUT|DELETE /api/communities/:id/messages/:mid/reactions
 *
 * Reporting goes through the existing POST /api/reports with targetType
 * "community_message" | "community"; blocking through POST /api/social/block
 * (a blocked member's messages are hidden from the blocker's history here).
 */
import { Router } from "express";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import {
  db, users, blocks, communities, communityMembers, communityMessages,
  communityMessageReactions, communityBans, communityJoinRequests,
} from "@workspace/db";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { moderateMessage } from "../lib/contentModerator";
import { publishingRestriction, profilesById } from "../lib/safety";
import {
  IMAGE_REJECTED_MESSAGE, IMAGE_UNAVAILABLE_MESSAGE, moderateImage,
} from "../lib/imageModeration";
import {
  communityImageExtension, isModeratedCommunityImageUrl, storeCommunityImage, StorageNotConfiguredError,
} from "../lib/communityMedia";
import { broadcastToCommunity, closeCommunityRoom, kickFromCommunity } from "../ws/communityHub";
import { noteCommunityMessage } from "../lib/communityPush";
import { getWebOrigin } from "../lib/webOrigin";
import { logger } from "../lib/logger";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MIN = 3;
const NAME_MAX = 40;
const DESCRIPTION_MAX = 160;
const MAX_ATTACHMENTS = 5;
const MAX_BODY = 4000;
/** Abuse cap on top of the per-account creation rate limit. */
export const MAX_OWNED_GROUPS = 20;
const REACTION_TYPES = ["like", "love", "haha", "wow", "sad", "fire"] as const;
const AVATAR_GRAYS = ["#3A3A3C", "#48484A", "#636366", "#8E8E93", "#AEAEB2"];

type CommunityRow = typeof communities.$inferSelect;
type MemberRow = typeof communityMembers.$inferSelect;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(req: any): string {
  return req.clerkUserId as string;
}

function slugify(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${base || "group"}-${randomBytes(3).toString("hex")}`;
}

function newInviteCode(): string {
  return randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 10).toLowerCase();
}

async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.clerkId, userId)).limit(1);
  return row?.role === "admin";
}

function isGroupAdmin(member: Pick<MemberRow, "role"> | undefined | null): boolean {
  return member?.role === "owner" || member?.role === "admin";
}

function grayFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_GRAYS[h % AVATAR_GRAYS.length];
}

function previewOf(body: string, attachments: unknown[]): string {
  const text = body.trim();
  if (text) return text.slice(0, 100);
  return attachments.length > 0 ? (attachments.length > 1 ? "Photos" : "Photo") : "Message";
}

function communityView(c: CommunityRow, m?: MemberRow | null) {
  const unread = m ? Math.max(0, Number(c.lastSeq) - Number(m.lastReadSeq)) : 0;
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    iconKey: c.iconKey ?? undefined,
    iconUrl: c.iconUrl ?? undefined,
    coverUrl: c.coverUrl ?? undefined,
    kind: c.kind as "official" | "user",
    verified: c.kind === "official",
    visibility: c.visibility as "public" | "private",
    requireApproval: c.requireApproval,
    memberCount: c.memberCount,
    joined: !!m,
    role: (m?.role ?? null) as "owner" | "admin" | "member" | null,
    muted: m?.muted ?? false,
    unreadCount: unread,
    lastMessage: c.lastMessagePreview ?? undefined,
    lastMessageSenderName: c.lastMessageSenderName ?? undefined,
    lastMessageTs: c.lastMessageAt ? c.lastMessageAt.getTime() : undefined,
    createdAt: c.createdAt.toISOString(),
  };
}

async function loadCommunity(id: string): Promise<CommunityRow | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db.select().from(communities).where(and(eq(communities.id, id), isNull(communities.deletedAt))).limit(1);
  return row ?? null;
}

async function loadMember(communityId: string, userId: string): Promise<MemberRow | null> {
  const [row] = await db.select().from(communityMembers)
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId))).limit(1);
  return row ?? null;
}

/** Shared gate: community exists + caller is a member. Sends the error response itself. */
async function requireMember(req: any, res: any): Promise<{ community: CommunityRow; member: MemberRow; userId: string } | null> {
  const userId = uid(req);
  const community = await loadCommunity(String(req.params.id));
  if (!community) { res.status(404).json({ error: "Group not found", code: "NOT_FOUND" }); return null; }
  const member = await loadMember(community.id, userId);
  if (!member) { res.status(403).json({ error: "Join this group to do that.", code: "NOT_A_MEMBER" }); return null; }
  return { community, member, userId };
}

/** Group admin (owner/admin) or platform moderator. Sends the error response itself. */
async function requireAdmin(req: any, res: any): Promise<{ community: CommunityRow; member: MemberRow | null; userId: string } | null> {
  const userId = uid(req);
  const community = await loadCommunity(String(req.params.id));
  if (!community) { res.status(404).json({ error: "Group not found", code: "NOT_FOUND" }); return null; }
  const member = await loadMember(community.id, userId);
  if (isGroupAdmin(member) && community.kind !== "official") return { community, member, userId };
  if (await isPlatformAdmin(userId)) return { community, member, userId };
  return res.status(403).json({ error: "Only group admins can do that.", code: "FORBIDDEN" });
  return null;
}

async function addMember(c: CommunityRow, userId: string, role: "member" | "owner" = "member"): Promise<boolean> {
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(communityMembers)
      .values({ communityId: c.id, userId, role, lastReadSeq: Number(c.lastSeq) })
      .onConflictDoNothing()
      .returning({ userId: communityMembers.userId });
    if (inserted.length === 0) return false;
    await tx.update(communities)
      .set({ memberCount: sql`${communities.memberCount} + 1`, updatedAt: new Date() })
      .where(eq(communities.id, c.id));
    await tx.delete(communityJoinRequests)
      .where(and(eq(communityJoinRequests.communityId, c.id), eq(communityJoinRequests.userId, userId)));
    return true;
  });
}

async function removeMember(communityId: string, userId: string): Promise<boolean> {
  const removed = await db.transaction(async (tx) => {
    const rows = await tx.delete(communityMembers)
      .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)))
      .returning({ userId: communityMembers.userId });
    if (rows.length === 0) return false;
    await tx.update(communities)
      .set({ memberCount: sql`GREATEST(${communities.memberCount} - 1, 0)`, updatedAt: new Date() })
      .where(eq(communities.id, communityId));
    return true;
  });
  if (removed) {
    broadcastToCommunity(communityId, { type: "member.removed", userId });
    kickFromCommunity(communityId, userId);
  }
  return removed;
}

async function isBanned(communityId: string, userId: string): Promise<boolean> {
  const [row] = await db.select({ u: communityBans.userId }).from(communityBans)
    .where(and(eq(communityBans.communityId, communityId), eq(communityBans.userId, userId))).limit(1);
  return !!row;
}

/** Text in a group's name/description goes through the same harmful-content block as messages. */
function checkGroupText(...parts: (string | null | undefined)[]): string | null {
  for (const part of parts) {
    if (!part) continue;
    const r = moderateMessage(part);
    if (r.blocked) return r.reason ?? "That text isn't allowed on Brandthread.";
  }
  return null;
}

// ─── Message adaptation ───────────────────────────────────────────────────────

type ReactionView = { userId: string; reactionType: string; createdAt: string };

async function adaptMessages(rows: (typeof communityMessages.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const profiles = await profilesById(rows.map((r) => r.senderId));
  const memberRoles = new Map<string, string>();
  const communityId = rows[0].communityId;
  const roleRows = await db.select({ userId: communityMembers.userId, role: communityMembers.role })
    .from(communityMembers)
    .where(and(eq(communityMembers.communityId, communityId), inArray(communityMembers.userId, [...new Set(rows.map((r) => r.senderId))])));
  for (const r of roleRows) memberRoles.set(r.userId, r.role);

  const reactionRows = await db.select().from(communityMessageReactions)
    .where(inArray(communityMessageReactions.messageId, rows.map((r) => r.id)));
  const reactionsByMessage = new Map<string, ReactionView[]>();
  for (const r of reactionRows) {
    const list = reactionsByMessage.get(r.messageId) ?? [];
    list.push({ userId: r.userId, reactionType: r.reactionType, createdAt: r.createdAt.toISOString() });
    reactionsByMessage.set(r.messageId, list);
  }

  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((v): v is string => !!v))];
  const replyById = new Map<string, { text: string; authorName: string }>();
  if (replyIds.length > 0) {
    const replied = await db.select().from(communityMessages).where(inArray(communityMessages.id, replyIds));
    const replyProfiles = await profilesById(replied.map((r) => r.senderId));
    for (const r of replied) {
      replyById.set(r.id, {
        text: r.deletedAt ? "Message removed" : previewOf(r.body, (r.attachments as unknown[]) ?? []),
        authorName: replyProfiles.get(r.senderId)?.name ?? "",
      });
    }
  }

  return rows.map((m) => {
    const p = profiles.get(m.senderId);
    const reply = m.replyToId ? replyById.get(m.replyToId) : undefined;
    return {
      id: m.id,
      communityId: m.communityId,
      seq: Number(m.seq),
      fromId: m.senderId,
      fromName: p?.name ?? "Brandthread member",
      fromHandle: p?.handle ?? "",
      fromInitials: p?.initials ?? "BM",
      fromColor: grayFor(m.senderId),
      fromAvatarUrl: p?.avatarUrl ?? undefined,
      fromAccountType: p?.accountType ?? undefined,
      fromMemberRole: memberRoles.get(m.senderId) ?? undefined,
      text: m.body,
      attachments: (m.attachments as unknown[]) ?? [],
      replyToId: m.replyToId ?? undefined,
      replyPreview: reply?.text,
      replyToAuthorName: reply?.authorName,
      reactions: reactionsByMessage.get(m.id) ?? [],
      ts: m.createdAt.getTime(),
    };
  });
}

async function blockedByMe(userId: string): Promise<string[]> {
  const rows = await db.select({ id: blocks.blockedId }).from(blocks).where(eq(blocks.blockerId, userId));
  return rows.map((r) => r.id);
}

// ─── Discovery ────────────────────────────────────────────────────────────────

function parsePage(query: any, defaults = { limit: 30, max: 50 }) {
  const limit = Math.min(Math.max(parseInt(String(query.limit ?? defaults.limit), 10) || defaults.limit, 1), defaults.max);
  const offset = Math.max(parseInt(String(query.offset ?? 0), 10) || 0, 0);
  return { limit, offset };
}

async function discover(viewerId: string | null, q: string, limit: number, offset: number) {
  const search = q.trim();
  const listed = and(
    isNull(communities.deletedAt),
    eq(communities.visibility, "public"),
    search ? or(ilike(communities.name, `%${search}%`), ilike(communities.description, `%${search}%`)) : undefined,
  );
  const rows = await db.select().from(communities).where(listed)
    .orderBy(sql`(${communities.kind} = 'official') DESC`, desc(communities.memberCount), desc(communities.createdAt))
    .limit(limit + 1).offset(offset);
  const page = rows.slice(0, limit);
  const mine = new Map<string, MemberRow>();
  if (viewerId && page.length > 0) {
    const ms = await db.select().from(communityMembers)
      .where(and(eq(communityMembers.userId, viewerId), inArray(communityMembers.communityId, page.map((c) => c.id))));
    for (const m of ms) mine.set(m.communityId, m);
  }
  return {
    communities: page.map((c) => communityView(c, mine.get(c.id))),
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}

router.get("/public", rateLimit("public-read"), async (req, res) => {
  const { limit, offset } = parsePage(req.query);
  const out = await discover(null, typeof req.query.q === "string" ? req.query.q : "", limit, offset);
  return res.json(out);
});

router.get("/invite/:code", rateLimit("public-read"), async (req, res) => {
  const code = String(String(req.params.code) ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]{6,16}$/.test(code)) return res.status(404).json({ error: "This invite link isn't valid.", code: "INVITE_INVALID" });
  const [c] = await db.select().from(communities)
    .where(and(eq(communities.inviteCode, code), isNull(communities.deletedAt))).limit(1);
  if (!c) return res.status(404).json({ error: "This invite link isn't valid anymore.", code: "INVITE_INVALID" });
  return res.json({
    id: c.id, name: c.name, description: c.description, iconKey: c.iconKey ?? undefined,
    iconUrl: c.iconUrl ?? undefined, coverUrl: c.coverUrl ?? undefined, kind: c.kind, verified: c.kind === "official",
    visibility: c.visibility, requireApproval: c.requireApproval, memberCount: c.memberCount,
  });
});

// ─── Everything below needs a signed-in user ──────────────────────────────────
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { limit, offset } = parsePage(req.query);
  return res.json(await discover(uid(req), typeof req.query.q === "string" ? req.query.q : "", limit, offset));
});

router.get("/mine", async (req, res) => {
  const userId = uid(req);
  const { limit, offset } = parsePage(req.query, { limit: 100, max: 200 });
  const rows = await db
    .select({ c: communities, m: communityMembers })
    .from(communityMembers)
    .innerJoin(communities, eq(communities.id, communityMembers.communityId))
    .where(and(eq(communityMembers.userId, userId), isNull(communities.deletedAt)))
    .orderBy(sql`${communities.lastMessageAt} DESC NULLS LAST`, desc(communityMembers.joinedAt))
    .limit(limit).offset(offset);
  return res.json(rows.map((r) => communityView(r.c, r.m)));
});

// ─── Photo upload (moderated) ─────────────────────────────────────────────────

router.post("/upload-photo", rateLimit("messaging"), async (req, res) => {
  const userId = uid(req);
  const { data, mimeType = "image/jpeg" } = (req.body ?? {}) as { data?: unknown; mimeType?: unknown };
  if (typeof data !== "string" || !data) return res.status(400).json({ error: "data (base64) is required", code: "VALIDATION_ERROR" });
  const mime = typeof mimeType === "string" ? mimeType.toLowerCase() : "";
  if (!communityImageExtension(mime) || mime === "image/gif") {
    return res.status(400).json({ error: "Photos must be JPEG, PNG or WebP.", code: "VALIDATION_ERROR" });
  }
  let b64 = data;
  const m = /^data:([^;]+);base64,(.+)$/.exec(data);
  if (m) b64 = m[2];
  if (b64.length > 20 * 1024 * 1024) return res.status(413).json({ error: "That photo is too large.", code: "TOO_LARGE" });
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) return res.status(400).json({ error: "data must be base64-encoded", code: "VALIDATION_ERROR" });

  // Re-encode: proves it is a real image, strips EXIF/GPS, and caps dimensions.
  let clean: Buffer;
  try {
    clean = await sharp(Buffer.from(b64, "base64"))
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 86 })
      .toBuffer();
  } catch {
    return res.status(400).json({ error: "That file doesn't look like a photo.", code: "NOT_AN_IMAGE" });
  }

  const verdict = await moderateImage(clean, "image/jpeg");
  if (verdict.status === "rejected") {
    logger.info({ userId, categories: verdict.categories }, "Community photo rejected by image moderation");
    return res.status(422).json({ error: IMAGE_REJECTED_MESSAGE, code: "IMAGE_REJECTED" });
  }
  if (verdict.status === "unavailable") {
    return res.status(503).json({ error: IMAGE_UNAVAILABLE_MESSAGE, code: "IMAGE_CHECK_UNAVAILABLE" });
  }

  try {
    const url = await storeCommunityImage({ buffer: clean, mimeType: "image/jpeg", userId });
    return res.json({ url });
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return res.status(503).json({ error: "Photo upload isn't available right now." });
    logger.error({ err, userId }, "Failed to store community photo");
    return res.status(500).json({ error: "Upload failed" });
  }
});

// ─── Create ───────────────────────────────────────────────────────────────────

router.post("/", rateLimit("community-create"), async (req, res) => {
  const userId = uid(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const visibility = body.visibility === "private" ? "private" : "public";
  const requireApproval = visibility === "private" && body.requireApproval === true;
  const iconUrl = body.iconUrl ?? null;
  const coverUrl = body.coverUrl ?? null;

  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return res.status(400).json({ error: `Group names are ${NAME_MIN}–${NAME_MAX} characters.`, code: "VALIDATION_ERROR" });
  }
  if (description.length > DESCRIPTION_MAX) {
    return res.status(400).json({ error: `Descriptions can be up to ${DESCRIPTION_MAX} characters.`, code: "VALIDATION_ERROR" });
  }
  for (const url of [iconUrl, coverUrl]) {
    if (url !== null && !isModeratedCommunityImageUrl(url)) {
      return res.status(400).json({ error: "Upload the photo through Brandthread first.", code: "VALIDATION_ERROR" });
    }
  }
  const blockedText = checkGroupText(name, description);
  if (blockedText) return res.status(422).json({ error: blockedText, code: "MODERATED" });

  // Official names / "Brandthread" are reserved so a user group can't pass as ours.
  const flat = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (flat.includes("brandthread") || flat.includes("official")) {
    return res.status(422).json({ error: "That name is reserved. Pick another.", code: "NAME_RESERVED" });
  }
  const officials = await db.select({ name: communities.name }).from(communities).where(eq(communities.kind, "official"));
  if (officials.some((o) => o.name.toLowerCase().replace(/[^a-z0-9]/g, "") === flat)) {
    return res.status(422).json({ error: "That name is reserved. Pick another.", code: "NAME_RESERVED" });
  }

  const restriction = await publishingRestriction(userId);
  if (restriction) return res.status(restriction.status).json(restriction.body);

  const [{ owned }] = await db.select({ owned: sql<number>`count(*)::int` }).from(communities)
    .where(and(eq(communities.ownerId, userId), isNull(communities.deletedAt)));
  if (owned >= MAX_OWNED_GROUPS) {
    return res.status(429).json({ error: "You've reached the limit of groups you can own. Delete one to create another.", code: "GROUP_LIMIT" });
  }

  const created = await db.transaction(async (tx) => {
    const [c] = await tx.insert(communities).values({
      name, slug: slugify(name), description, iconUrl: iconUrl as string | null, coverUrl: coverUrl as string | null,
      kind: "user", visibility, requireApproval, ownerId: userId, inviteCode: newInviteCode(), memberCount: 1,
    }).returning();
    await tx.insert(communityMembers).values({ communityId: c.id, userId, role: "owner", lastReadSeq: 0 });
    return c;
  });
  const member = await loadMember(created.id, userId);
  return res.status(201).json(communityView(created, member));
});

// ─── Join by invite code ──────────────────────────────────────────────────────

router.post("/join-by-code", rateLimit("mutation"), async (req, res) => {
  const userId = uid(req);
  const code = typeof req.body?.code === "string" ? req.body.code.trim().toLowerCase() : "";
  if (!/^[a-z0-9]{6,16}$/.test(code)) return res.status(404).json({ error: "This invite link isn't valid.", code: "INVITE_INVALID" });
  const [c] = await db.select().from(communities)
    .where(and(eq(communities.inviteCode, code), isNull(communities.deletedAt))).limit(1);
  if (!c) return res.status(404).json({ error: "This invite link isn't valid anymore.", code: "INVITE_INVALID" });
  if (await isBanned(c.id, userId)) return res.status(403).json({ error: "You can't join this group.", code: "BANNED" });
  const existing = await loadMember(c.id, userId);
  if (existing) return res.json({ status: "joined", community: communityView(c, existing) });
  if (c.visibility === "private" && c.requireApproval) {
    await db.insert(communityJoinRequests).values({ communityId: c.id, userId }).onConflictDoNothing();
    return res.status(202).json({ status: "requested" });
  }
  await addMember(c, userId);
  const fresh = (await loadCommunity(c.id)) ?? c;
  return res.json({ status: "joined", community: communityView(fresh, await loadMember(c.id, userId)) });
});

// ─── Detail / edit / delete ───────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const userId = uid(req);
  const c = await loadCommunity(String(req.params.id));
  if (!c) return res.status(404).json({ error: "Group not found", code: "NOT_FOUND" });
  const member = await loadMember(c.id, userId);
  if (c.visibility === "private" && !member) return res.status(404).json({ error: "Group not found", code: "NOT_FOUND" });
  return res.json(communityView(c, member));
});

router.patch("/:id", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const patch: Partial<typeof communities.$inferInsert> = { updatedAt: new Date() };
  if (b.name !== undefined) {
    const name = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ") : "";
    if (name.length < NAME_MIN || name.length > NAME_MAX) return res.status(400).json({ error: `Group names are ${NAME_MIN}–${NAME_MAX} characters.`, code: "VALIDATION_ERROR" });
    if (ctx.community.kind !== "official") {
      const flat = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (flat.includes("brandthread") || flat.includes("official")) return res.status(422).json({ error: "That name is reserved. Pick another.", code: "NAME_RESERVED" });
    }
    patch.name = name;
  }
  if (b.description !== undefined) {
    const d = typeof b.description === "string" ? b.description.trim() : "";
    if (d.length > DESCRIPTION_MAX) return res.status(400).json({ error: `Descriptions can be up to ${DESCRIPTION_MAX} characters.`, code: "VALIDATION_ERROR" });
    patch.description = d;
  }
  for (const key of ["iconUrl", "coverUrl"] as const) {
    if (b[key] === undefined) continue;
    if (b[key] !== null && !isModeratedCommunityImageUrl(b[key])) return res.status(400).json({ error: "Upload the photo through Brandthread first.", code: "VALIDATION_ERROR" });
    patch[key] = b[key] as string | null;
  }
  if (b.visibility !== undefined) {
    if (b.visibility !== "public" && b.visibility !== "private") return res.status(400).json({ error: "Invalid visibility", code: "VALIDATION_ERROR" });
    patch.visibility = b.visibility;
  }
  if (b.requireApproval !== undefined) patch.requireApproval = b.requireApproval === true;
  const blockedText = checkGroupText(patch.name, patch.description);
  if (blockedText) return res.status(422).json({ error: blockedText, code: "MODERATED" });
  const [updated] = await db.update(communities).set(patch).where(eq(communities.id, ctx.community.id)).returning();
  return res.json(communityView(updated, ctx.member));
});

router.delete("/:id", async (req, res) => {
  const userId = uid(req);
  const c = await loadCommunity(String(req.params.id));
  if (!c) return res.status(404).json({ error: "Group not found", code: "NOT_FOUND" });
  const platformAdmin = await isPlatformAdmin(userId);
  const owner = c.kind === "user" && c.ownerId === userId;
  if (!owner && !platformAdmin) return res.status(403).json({ error: "Only the owner can delete this group.", code: "FORBIDDEN" });
  await db.update(communities).set({ deletedAt: new Date(), inviteCode: null, updatedAt: new Date() }).where(eq(communities.id, c.id));
  broadcastToCommunity(c.id, { type: "community.deleted" });
  closeCommunityRoom(c.id);
  return res.json({ ok: true });
});

// ─── Join / leave / mute / read ───────────────────────────────────────────────

router.post("/:id/join", rateLimit("mutation"), async (req, res) => {
  const userId = uid(req);
  const c = await loadCommunity(String(req.params.id));
  if (!c) return res.status(404).json({ error: "Group not found", code: "NOT_FOUND" });
  if (await isBanned(c.id, userId)) return res.status(403).json({ error: "You can't join this group.", code: "BANNED" });
  const existing = await loadMember(c.id, userId);
  if (existing) return res.json(communityView(c, existing));
  if (c.visibility === "private") return res.status(403).json({ error: "This group is invite-only.", code: "PRIVATE" });
  await addMember(c, userId);
  const fresh = (await loadCommunity(c.id)) ?? c;
  return res.json(communityView(fresh, await loadMember(c.id, userId)));
});

router.post("/:id/leave", async (req, res) => {
  const ctx = await requireMember(req, res);
  if (!ctx) return;
  if (ctx.member.role === "owner" && ctx.community.kind === "user") {
    return res.status(409).json({ error: "Transfer ownership or delete the group before leaving.", code: "OWNER_CANNOT_LEAVE" });
  }
  await removeMember(ctx.community.id, ctx.userId);
  return res.json({ ok: true });
});

router.patch("/:id/mute", async (req, res) => {
  const ctx = await requireMember(req, res);
  if (!ctx) return;
  if (typeof req.body?.muted !== "boolean") return res.status(400).json({ error: "muted must be a boolean", code: "VALIDATION_ERROR" });
  await db.update(communityMembers).set({ muted: req.body.muted })
    .where(and(eq(communityMembers.communityId, ctx.community.id), eq(communityMembers.userId, ctx.userId)));
  return res.json({ muted: req.body.muted });
});

router.patch("/:id/read", async (req, res) => {
  const ctx = await requireMember(req, res);
  if (!ctx) return;
  const seq = Number.isFinite(Number(req.body?.seq)) ? Number(req.body.seq) : Number(ctx.community.lastSeq);
  // Monotonic: the cursor only ever moves forward, and never past the head.
  await db.execute(sql`
    UPDATE community_members
    SET last_read_seq = GREATEST(last_read_seq, LEAST(${seq}::bigint, ${Number(ctx.community.lastSeq)}::bigint))
    WHERE community_id = ${ctx.community.id}::uuid AND user_id = ${ctx.userId}
  `);
  return res.json({ ok: true });
});

// ─── Invite link ──────────────────────────────────────────────────────────────

function inviteUrl(code: string): string {
  return `${getWebOrigin()}/community-join?code=${code}`;
}

router.get("/:id/invite", async (req, res) => {
  const ctx = await requireMember(req, res);
  if (!ctx) return;
  if (ctx.community.visibility === "private" && !isGroupAdmin(ctx.member)) {
    return res.status(403).json({ error: "Only admins can share this group's invite link.", code: "FORBIDDEN" });
  }
  if (!ctx.community.inviteCode) return res.status(404).json({ error: "This group has no invite link.", code: "NOT_FOUND" });
  return res.json({ code: ctx.community.inviteCode, url: inviteUrl(ctx.community.inviteCode) });
});

router.post("/:id/invite/reset", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const code = newInviteCode();
  await db.update(communities).set({ inviteCode: code, updatedAt: new Date() }).where(eq(communities.id, ctx.community.id));
  return res.json({ code, url: inviteUrl(code) });
});

// ─── Members & moderation tools ───────────────────────────────────────────────

router.get("/:id/members", async (req, res) => {
  const ctx = await requireMember(req, res);
  if (!ctx) return;
  const { limit, offset } = parsePage(req.query, { limit: 50, max: 100 });
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const roleRank = sql`CASE ${communityMembers.role} WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END`;
  const where = q
    ? and(
        eq(communityMembers.communityId, ctx.community.id),
        sql`${communityMembers.userId} IN (SELECT clerk_id FROM users WHERE name ILIKE ${`%${q}%`} OR display_name ILIKE ${`%${q}%`} OR username ILIKE ${`%${q}%`})`,
      )
    : eq(communityMembers.communityId, ctx.community.id);
  const rows = await db.select().from(communityMembers).where(where)
    .orderBy(roleRank, asc(communityMembers.joinedAt), asc(communityMembers.userId))
    .limit(limit + 1).offset(offset);
  const page = rows.slice(0, limit);
  const profiles = await profilesById(page.map((r) => r.userId));
  return res.json({
    memberCount: ctx.community.memberCount,
    members: page.map((r) => {
      const p = profiles.get(r.userId);
      return {
        userId: r.userId,
        name: p?.name ?? "Brandthread member",
        handle: p?.handle ?? "",
        initials: p?.initials ?? "BM",
        avatarUrl: p?.avatarUrl ?? undefined,
        accountType: p?.accountType ?? undefined,
        role: r.role,
        joinedAt: r.joinedAt.toISOString(),
      };
    }),
    nextOffset: rows.length > limit ? offset + limit : null,
  });
});

/** Can `actor` act on `target`? Owner > admin > member; platform admins can act on anyone but an owner. */
async function canManage(ctx: { community: CommunityRow; member: MemberRow | null; userId: string }, targetId: string) {
  const target = await loadMember(ctx.community.id, targetId);
  if (!target) return { ok: false as const, status: 404, error: "Member not found" };
  if (targetId === ctx.userId) return { ok: false as const, status: 400, error: "You can't do that to yourself." };
  if (target.role === "owner") return { ok: false as const, status: 403, error: "The owner can't be removed." };
  const platform = !isGroupAdmin(ctx.member) && (await isPlatformAdmin(ctx.userId));
  if (!platform && target.role === "admin" && ctx.member?.role !== "owner") {
    return { ok: false as const, status: 403, error: "Only the owner can remove an admin." };
  }
  return { ok: true as const, target };
}

router.delete("/:id/members/:userId", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const check = await canManage(ctx, String(req.params.userId));
  if (!check.ok) return res.status(check.status).json({ error: check.error, code: "FORBIDDEN" });
  await removeMember(ctx.community.id, String(req.params.userId));
  return res.json({ ok: true });
});

router.post("/:id/members/:userId/ban", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const targetId = String(req.params.userId);
  if (targetId === ctx.userId) return res.status(400).json({ error: "You can't ban yourself.", code: "FORBIDDEN" });
  const target = await loadMember(ctx.community.id, targetId);
  if (target) {
    const check = await canManage(ctx, targetId);
    if (!check.ok) return res.status(check.status).json({ error: check.error, code: "FORBIDDEN" });
  }
  await db.insert(communityBans).values({ communityId: ctx.community.id, userId: targetId, bannedBy: ctx.userId }).onConflictDoNothing();
  await removeMember(ctx.community.id, targetId);
  await db.delete(communityJoinRequests)
    .where(and(eq(communityJoinRequests.communityId, ctx.community.id), eq(communityJoinRequests.userId, targetId)));
  return res.json({ ok: true });
});

router.delete("/:id/bans/:userId", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  await db.delete(communityBans)
    .where(and(eq(communityBans.communityId, ctx.community.id), eq(communityBans.userId, String(req.params.userId))));
  return res.json({ ok: true });
});

router.get("/:id/bans", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const rows = await db.select().from(communityBans).where(eq(communityBans.communityId, ctx.community.id))
    .orderBy(desc(communityBans.createdAt)).limit(100);
  const profiles = await profilesById(rows.map((r) => r.userId));
  return res.json(rows.map((r) => ({ userId: r.userId, name: profiles.get(r.userId)?.name ?? "Brandthread member", bannedAt: r.createdAt.toISOString() })));
});

router.patch("/:id/members/:userId/role", async (req, res) => {
  const userId = uid(req);
  const c = await loadCommunity(String(req.params.id));
  if (!c) return res.status(404).json({ error: "Group not found", code: "NOT_FOUND" });
  const me = await loadMember(c.id, userId);
  if (c.kind !== "user" || me?.role !== "owner") {
    return res.status(403).json({ error: "Only the owner can change roles.", code: "FORBIDDEN" });
  }
  const role = req.body?.role;
  if (role !== "admin" && role !== "member" && role !== "owner") return res.status(400).json({ error: "Invalid role", code: "VALIDATION_ERROR" });
  const targetId = String(req.params.userId);
  if (targetId === userId) return res.status(400).json({ error: "You can't change your own role.", code: "FORBIDDEN" });
  const target = await loadMember(c.id, targetId);
  if (!target) return res.status(404).json({ error: "Member not found", code: "NOT_FOUND" });
  await db.transaction(async (tx) => {
    await tx.update(communityMembers).set({ role })
      .where(and(eq(communityMembers.communityId, c.id), eq(communityMembers.userId, targetId)));
    if (role === "owner") {
      await tx.update(communityMembers).set({ role: "admin" })
        .where(and(eq(communityMembers.communityId, c.id), eq(communityMembers.userId, userId)));
      await tx.update(communities).set({ ownerId: targetId, updatedAt: new Date() }).where(eq(communities.id, c.id));
    }
  });
  return res.json({ ok: true, role });
});

router.get("/:id/requests", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const rows = await db.select().from(communityJoinRequests).where(eq(communityJoinRequests.communityId, ctx.community.id))
    .orderBy(asc(communityJoinRequests.createdAt)).limit(100);
  const profiles = await profilesById(rows.map((r) => r.userId));
  return res.json(rows.map((r) => {
    const p = profiles.get(r.userId);
    return { userId: r.userId, name: p?.name ?? "Brandthread member", handle: p?.handle ?? "", initials: p?.initials ?? "BM", avatarUrl: p?.avatarUrl ?? undefined, requestedAt: r.createdAt.toISOString() };
  }));
});

router.post("/:id/requests/:userId/approve", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const [pending] = await db.select().from(communityJoinRequests)
    .where(and(eq(communityJoinRequests.communityId, ctx.community.id), eq(communityJoinRequests.userId, String(req.params.userId)))).limit(1);
  if (!pending) return res.status(404).json({ error: "No pending request", code: "NOT_FOUND" });
  if (await isBanned(ctx.community.id, String(req.params.userId))) return res.status(403).json({ error: "That person is banned.", code: "BANNED" });
  await addMember(ctx.community, String(req.params.userId));
  return res.json({ ok: true });
});

router.post("/:id/requests/:userId/deny", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  await db.delete(communityJoinRequests)
    .where(and(eq(communityJoinRequests.communityId, ctx.community.id), eq(communityJoinRequests.userId, String(req.params.userId))));
  return res.json({ ok: true });
});

// ─── Messages ─────────────────────────────────────────────────────────────────

router.get("/:id/messages", async (req, res) => {
  const ctx = await requireMember(req, res);
  if (!ctx) return;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? 50), 10) || 50, 1), 100);
  const before = req.query.before !== undefined ? Number(req.query.before) : null;
  const after = req.query.after !== undefined ? Number(req.query.after) : null;
  if ((before !== null && !Number.isFinite(before)) || (after !== null && !Number.isFinite(after))) {
    return res.status(400).json({ error: "Invalid cursor", code: "VALIDATION_ERROR" });
  }
  const hidden = await blockedByMe(ctx.userId);
  const base = and(
    eq(communityMessages.communityId, ctx.community.id),
    isNull(communityMessages.deletedAt),
    hidden.length > 0 ? notInArray(communityMessages.senderId, hidden) : undefined,
  );

  let rows: (typeof communityMessages.$inferSelect)[];
  let hasMore: boolean;
  if (after !== null) {
    // Catch-up after a reconnect: everything newer than the client's last seq, oldest first.
    const r = await db.select().from(communityMessages).where(and(base, gt(communityMessages.seq, after)))
      .orderBy(asc(communityMessages.seq)).limit(limit + 1);
    hasMore = r.length > limit;
    rows = r.slice(0, limit);
  } else {
    const r = await db.select().from(communityMessages)
      .where(before !== null ? and(base, lt(communityMessages.seq, before)) : base)
      .orderBy(desc(communityMessages.seq)).limit(limit + 1);
    hasMore = r.length > limit;
    rows = r.slice(0, limit).reverse();
  }
  return res.json({
    messages: await adaptMessages(rows),
    hasMore,
    // Pass as `before` for the next older page.
    nextBefore: after === null && hasMore && rows.length > 0 ? Number(rows[0].seq) : null,
    lastSeq: Number(ctx.community.lastSeq),
  });
});

router.post("/:id/messages", rateLimit("messaging"), async (req, res) => {
  const ctx = await requireMember(req, res);
  if (!ctx) return;
  const { userId, community } = ctx;
  const { text, attachments, replyToId } = (req.body ?? {}) as { text?: unknown; attachments?: unknown; replyToId?: unknown };
  const body = typeof text === "string" ? text.trim() : "";
  if (body.length > MAX_BODY) return res.status(400).json({ error: "That message is too long.", code: "VALIDATION_ERROR" });
  if (attachments !== undefined && !Array.isArray(attachments)) return res.status(400).json({ error: "attachments must be an array.", code: "VALIDATION_ERROR" });
  const items = (attachments as any[] | undefined) ?? [];
  if (items.length > MAX_ATTACHMENTS) return res.status(400).json({ error: `A message can include up to ${MAX_ATTACHMENTS} photos.`, code: "VALIDATION_ERROR" });
  if (!body && items.length === 0) return res.status(400).json({ error: "text or a photo is required", code: "VALIDATION_ERROR" });

  // Photos must be ones our moderated upload route stored — never a pasted URL.
  const cleanAttachments: unknown[] = [];
  for (const item of items) {
    const url = item?.url ?? item?.uri;
    if (item?.type !== "image" || !isModeratedCommunityImageUrl(url)) {
      return res.status(400).json({ error: "Photos have to be uploaded through Brandthread.", code: "INVALID_ATTACHMENT" });
    }
    cleanAttachments.push({ type: "image", url, uri: url, ...(Number(item.width) > 0 ? { width: Number(item.width) } : {}), ...(Number(item.height) > 0 ? { height: Number(item.height) } : {}) });
  }

  // Text is NOT filtered (Dev's call) beyond the existing harmful-content
  // block (threats / doxxing / etc.) the DM pipeline already applies.
  if (body) {
    const mod = moderateMessage(body);
    if (mod.blocked) {
      return res.status(422).json({ error: mod.reason ?? "Message was flagged by safety filters.", category: mod.category, code: "MODERATED" });
    }
  }
  const restriction = await publishingRestriction(userId);
  if (restriction) return res.status(restriction.status).json(restriction.body);

  let replyTo: string | null = null;
  if (typeof replyToId === "string" && UUID_RE.test(replyToId)) {
    const [orig] = await db.select({ id: communityMessages.id }).from(communityMessages)
      .where(and(eq(communityMessages.id, replyToId), eq(communityMessages.communityId, community.id))).limit(1);
    replyTo = orig?.id ?? null;
  }

  const preview = previewOf(body, cleanAttachments);
  const profile = (await profilesById([userId])).get(userId);
  const senderName = profile?.name ?? "Someone";

  // One row insert + one counter bump — no per-member writes, however big the group.
  const msg = await db.transaction(async (tx) => {
    const head = await tx.execute(sql`
      UPDATE communities
      SET last_seq = last_seq + 1,
          last_message_preview = ${preview},
          last_message_sender_name = ${senderName},
          last_message_at = now(),
          updated_at = now()
      WHERE id = ${community.id}::uuid
      RETURNING last_seq
    `);
    const seq = Number((head as any).rows[0].last_seq);
    const [row] = await tx.insert(communityMessages).values({
      communityId: community.id, seq, senderId: userId, body, attachments: cleanAttachments, replyToId: replyTo,
    }).returning();
    // Sending means you've caught up to your own message.
    await tx.update(communityMembers).set({ lastReadSeq: seq })
      .where(and(eq(communityMembers.communityId, community.id), eq(communityMembers.userId, userId)));
    return row;
  });

  const [adapted] = await adaptMessages([msg]);
  broadcastToCommunity(community.id, { type: "message.created", message: adapted });
  void noteCommunityMessage({ communityId: community.id, senderName, preview })
    .catch((err) => logger.warn({ err, communityId: community.id }, "Community push batching failed"));
  return res.status(201).json(adapted);
});

router.delete("/:id/messages/:mid", async (req, res) => {
  const ctx = await requireMember(req, res);
  if (!ctx) return;
  if (!UUID_RE.test(String(req.params.mid))) return res.status(404).json({ error: "Message not found", code: "NOT_FOUND" });
  const [msg] = await db.select().from(communityMessages)
    .where(and(eq(communityMessages.id, String(req.params.mid)), eq(communityMessages.communityId, ctx.community.id))).limit(1);
  if (!msg || msg.deletedAt) return res.status(404).json({ error: "Message not found", code: "NOT_FOUND" });
  const mine = msg.senderId === ctx.userId;
  const moderator = (isGroupAdmin(ctx.member) && ctx.community.kind !== "official") || (await isPlatformAdmin(ctx.userId));
  if (!mine && !moderator) return res.status(403).json({ error: "You can only delete your own messages.", code: "FORBIDDEN" });
  await db.update(communityMessages).set({ deletedAt: new Date(), deletedBy: ctx.userId }).where(eq(communityMessages.id, msg.id));
  // Keep the inbox preview honest if the newest message just went away.
  const [latest] = await db.select().from(communityMessages)
    .where(and(eq(communityMessages.communityId, ctx.community.id), isNull(communityMessages.deletedAt)))
    .orderBy(desc(communityMessages.seq)).limit(1);
  if (Number(msg.seq) === Number(ctx.community.lastSeq)) {
    const p = latest ? (await profilesById([latest.senderId])).get(latest.senderId) : undefined;
    await db.update(communities).set({
      lastMessagePreview: latest ? previewOf(latest.body, (latest.attachments as unknown[]) ?? []) : null,
      lastMessageSenderName: latest ? (p?.name ?? null) : null,
      lastMessageAt: latest ? latest.createdAt : null,
    }).where(eq(communities.id, ctx.community.id));
  }
  broadcastToCommunity(ctx.community.id, { type: "message.deleted", messageId: msg.id });
  return res.json({ ok: true });
});

async function reactionsFor(messageId: string): Promise<ReactionView[]> {
  const rows = await db.select().from(communityMessageReactions).where(eq(communityMessageReactions.messageId, messageId));
  return rows.map((r) => ({ userId: r.userId, reactionType: r.reactionType, createdAt: r.createdAt.toISOString() }));
}

async function messageInCommunity(communityId: string, mid: string) {
  if (!UUID_RE.test(mid)) return null;
  const [m] = await db.select({ id: communityMessages.id, deletedAt: communityMessages.deletedAt }).from(communityMessages)
    .where(and(eq(communityMessages.id, mid), eq(communityMessages.communityId, communityId))).limit(1);
  return m && !m.deletedAt ? m : null;
}

router.put("/:id/messages/:mid/reactions", rateLimit("mutation"), async (req, res) => {
  const ctx = await requireMember(req, res);
  if (!ctx) return;
  const reactionType = req.body?.reactionType;
  if (!REACTION_TYPES.includes(reactionType)) return res.status(400).json({ error: "Invalid reaction", code: "VALIDATION_ERROR" });
  if (!(await messageInCommunity(ctx.community.id, String(req.params.mid)))) return res.status(404).json({ error: "Message not found", code: "NOT_FOUND" });
  await db.insert(communityMessageReactions)
    .values({ messageId: String(req.params.mid), userId: ctx.userId, reactionType })
    .onConflictDoUpdate({ target: [communityMessageReactions.messageId, communityMessageReactions.userId], set: { reactionType, createdAt: new Date() } });
  const reactions = await reactionsFor(String(req.params.mid));
  broadcastToCommunity(ctx.community.id, { type: "reaction.updated", messageId: String(req.params.mid), reactions });
  return res.json({ reactions });
});

router.delete("/:id/messages/:mid/reactions", async (req, res) => {
  const ctx = await requireMember(req, res);
  if (!ctx) return;
  if (!(await messageInCommunity(ctx.community.id, String(req.params.mid)))) return res.status(404).json({ error: "Message not found", code: "NOT_FOUND" });
  await db.delete(communityMessageReactions)
    .where(and(eq(communityMessageReactions.messageId, String(req.params.mid)), eq(communityMessageReactions.userId, ctx.userId)));
  const reactions = await reactionsFor(String(req.params.mid));
  broadcastToCommunity(ctx.community.id, { type: "reaction.updated", messageId: String(req.params.mid), reactions });
  return res.json({ reactions });
});

export default router;
