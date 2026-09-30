/**
 * Story @mentions (Instagram-style tagging in stories).
 *
 * GET  /api/social/mention-search?q=          — people picker for the @mention sticker (following first, then everyone)
 * GET  /api/social/stories/mentions           — the Activity "Story mentions" rail: active stories that tagged me
 * GET  /api/social/stories/:id                — one story, if I may see it (author, tagged, or follower)
 * POST /api/social/stories/:id/mention-dismiss — "Not now": mark the tag handled without resharing
 * POST /api/social/stories/:id/mention-reply  — find/create the reply conversation, routed to Inbox or Requests
 *
 * Creating a story with mention stickers and resharing one ("Add to your story")
 * happen in POST /api/social/stories (social.ts) so they share its moderation
 * and publishing checks.
 */
import { Router } from "express";
import {
  db, users, follows, stories, storyMentions, storyLikes, storyViews,
} from "@workspace/db";
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql, notInArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { blockRelation, blockedUserIds, profilesById, publishingRestriction } from "../lib/safety";
import { containsSearchPattern, normalizeSearchTerm } from "../lib/search";
import { ensureStoryReplyConversation, withOriginalInfo } from "../lib/storyMentions";

/** Brand palette is black/white/silver: every avatar without a photo is a white monogram on this. */
const MONOGRAM_COLOR = "#1C1C1E";

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Path params are plain `:id`; non-UUID ids fall through (so /stories/me etc. keep working).
router.param("id", (req, res, next, value) => {
  if (!UUID_RE.test(String(value))) { next("route"); return; }
  next();
});

function storyView(row: typeof stories.$inferSelect, likedByMe: boolean) {
  return {
    id: row.id,
    authorId: row.authorId,
    authorName: row.authorName,
    authorHandle: row.authorHandle ?? "",
    authorInitials: row.authorInitials ?? "",
    authorColor: row.authorColor ?? MONOGRAM_COLOR,
    authorAccountType: row.authorAccountType,
    media: (row.media as any[]) ?? [],
    repliesDisabled: row.repliesDisabled,
    privacy: {
      visibility: row.privacyVisibility,
      replyPermission: row.privacyReplyPerm,
      hiddenFromUserIds: [] as string[],
      closeFriendsOnly: row.privacyVisibility === "friends",
    },
    viewers: [] as unknown[],
    likesCount: row.likesCount,
    viewsCount: row.viewsCount,
    likedByMe,
    originalStoryId: row.originalStoryId ?? null,
    originalAuthorId: row.originalAuthorId ?? null,
    createdAt: new Date(row.createdAt).getTime(),
    expiresAt: new Date(row.expiresAt).getTime(),
  };
}

function thumbnailFor(media: unknown, slide: number): string | null {
  const items = Array.isArray(media) ? media : [];
  const pick = (m: any) => (typeof m?.imageUri === "string" ? m.imageUri : typeof m?.url === "string" ? m.url : null);
  return pick(items[slide]) ?? items.map(pick).find((u) => !!u) ?? null;
}

const isLive = (row: { expiresAt: Date; moderationStatus: string }) =>
  new Date(row.expiresAt).getTime() > Date.now() && row.moderationStatus !== "removed";

// ─── People picker ────────────────────────────────────────────────────────────
router.get("/mention-search", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const q = normalizeSearchTerm(((req.query.q as string) || "").trim().replace(/^@/, ""));
  const limit = Math.min(parseInt((req.query.limit as string) || "20", 10) || 20, 50);

  const blocked = [...(await blockedUserIds(myId))];
  const followingRows = await db.select({ id: follows.followingId }).from(follows)
    .where(eq(follows.followerId, myId)).orderBy(desc(follows.createdAt));
  const followingIds = followingRows.map((r) => r.id);
  const followingSet = new Set(followingIds);

  const usable = and(
    ne(users.clerkId, myId),
    isNull(users.deletedAt),
    isNull(users.suspendedAt),
    eq(users.isSystemAccount, false),
    inArray(users.accountType, ["buyer", "seller", "both"]),
    ...(blocked.length ? [notInArray(users.clerkId, blocked)] : []),
  );
  const nameMatch = q.length >= 1
    ? (() => {
      const pattern = containsSearchPattern(q);
      return or(
        sql`${users.username} ILIKE ${pattern}`, sql`${users.displayName} ILIKE ${pattern}`,
        sql`${users.name} ILIKE ${pattern}`, sql`${users.brandName} ILIKE ${pattern}`,
      );
    })()
    : undefined;

  const rows = await db.select().from(users)
    .where(and(usable, ...(nameMatch ? [nameMatch] : []), ...(q.length === 0 && followingIds.length ? [inArray(users.clerkId, followingIds)] : [])))
    .orderBy(asc(sql`COALESCE(${users.username}, ${users.displayName}, ${users.name})`))
    .limit(q.length === 0 ? limit : 200);

  const people = rows.map((u) => {
    const name = (u.accountType === "seller" ? u.brandName : null) || u.displayName || u.name || "Brandthread member";
    return {
      userId: u.clerkId,
      name,
      username: u.username ?? null,
      handle: u.username ? `@${u.username}` : "",
      avatarUrl: (typeof u.profileImageUrl === "string" && u.profileImageUrl.startsWith("http") ? u.profileImageUrl : u.avatarUrl) ?? null,
      initials: name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?",
      color: MONOGRAM_COLOR,
      isFollowing: followingSet.has(u.clerkId),
    };
  });
  // People I follow first, then everyone else.
  people.sort((a, b) => Number(b.isFollowing) - Number(a.isFollowing));
  res.json(people.slice(0, limit));
});

// ─── Activity rail ────────────────────────────────────────────────────────────
router.get("/stories/mentions", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const rows = await db
    .select({ story: stories, mention: storyMentions })
    .from(storyMentions)
    .innerJoin(stories, eq(stories.id, storyMentions.storyId))
    .where(and(
      eq(storyMentions.mentionedUserId, myId),
      gt(stories.expiresAt, new Date()),
      ne(stories.moderationStatus, "removed"),
    ))
    .orderBy(desc(stories.createdAt));

  const blocked = await blockedUserIds(myId);
  const visible = rows.filter((r) => !blocked.has(r.story.authorId));
  if (visible.length === 0) { res.json({ items: [], unseenCount: 0 }); return; }

  const storyIds = visible.map((r) => r.story.id);
  const [viewed, liked, profiles] = await Promise.all([
    db.select({ storyId: storyViews.storyId }).from(storyViews)
      .where(and(eq(storyViews.userId, myId), inArray(storyViews.storyId, storyIds))),
    db.select({ storyId: storyLikes.storyId }).from(storyLikes)
      .where(and(eq(storyLikes.userId, myId), inArray(storyLikes.storyId, storyIds))),
    profilesById(visible.map((r) => r.story.authorId)),
  ]);
  const viewedSet = new Set(viewed.map((v) => v.storyId));
  const likedSet = new Set(liked.map((v) => v.storyId));

  const shown = visible.filter((r) => {
    const p = profiles.get(r.story.authorId);
    return !p?.deleted && !p?.suspended;
  });
  const views = await withOriginalInfo(shown.map((r) => storyView(r.story, likedSet.has(r.story.id))));

  const items = shown.map((r, i) => {
    const p = profiles.get(r.story.authorId)!;
    const slide = Number((r.mention.sticker as any)?.slide ?? 0) || 0;
    return {
      storyId: r.story.id,
      tagger: {
        userId: p.userId,
        name: p.name,
        handle: p.handle,
        initials: p.initials,
        color: MONOGRAM_COLOR,
        avatarUrl: p.avatarUrl,
        accountType: p.accountType,
      },
      thumbnailUrl: thumbnailFor(r.story.media, slide),
      slide,
      seen: viewedSet.has(r.story.id),
      handled: !!r.mention.handledAt,
      handledAction: r.mention.handledAction,
      mentionedAt: new Date(r.mention.createdAt).getTime(),
      story: views[i],
    };
  });

  res.json({ items, unseenCount: items.filter((i) => !i.seen).length });
});

// ─── One story ────────────────────────────────────────────────────────────────
router.get("/stories/:id", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const [row] = await db.select().from(stories).where(eq(stories.id, String(req.params.id))).limit(1);
  const gone = () => res.status(404).json({ error: "Story unavailable", code: "STORY_UNAVAILABLE" });
  if (!row || !isLive(row)) { gone(); return; }

  if (row.authorId !== myId) {
    if ((await blockRelation(myId, row.authorId)) !== "none") { gone(); return; }
    const [tagged] = await db.select({ storyId: storyMentions.storyId }).from(storyMentions)
      .where(and(eq(storyMentions.storyId, row.id), eq(storyMentions.mentionedUserId, myId))).limit(1);
    if (!tagged) {
      const [follow] = await db.select({ f: follows.followerId }).from(follows)
        .where(and(eq(follows.followerId, myId), eq(follows.followingId, row.authorId))).limit(1);
      if (!follow) { gone(); return; }
      if (row.privacyVisibility === "friends") {
        const [mutual] = await db.select({ f: follows.followerId }).from(follows)
          .where(and(eq(follows.followerId, row.authorId), eq(follows.followingId, myId))).limit(1);
        if (!mutual) { gone(); return; }
      }
    }
  }
  const [liked] = await db.select({ s: storyLikes.storyId }).from(storyLikes)
    .where(and(eq(storyLikes.storyId, row.id), eq(storyLikes.userId, myId))).limit(1);
  const [view] = await withOriginalInfo([storyView(row, !!liked)]);
  res.json(view);
});

// ─── "Not now" ────────────────────────────────────────────────────────────────
router.post("/stories/:id/mention-dismiss", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const updated = await db.update(storyMentions)
    .set({ handledAt: new Date(), handledAction: "dismissed" })
    .where(and(
      eq(storyMentions.storyId, String(req.params.id)),
      eq(storyMentions.mentionedUserId, myId),
      isNull(storyMentions.handledAt),
    ))
    .returning({ storyId: storyMentions.storyId });
  if (updated.length === 0) {
    const [existing] = await db.select({ storyId: storyMentions.storyId }).from(storyMentions)
      .where(and(eq(storyMentions.storyId, String(req.params.id)), eq(storyMentions.mentionedUserId, myId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Story unavailable", code: "STORY_UNAVAILABLE" }); return; }
  }
  res.json({ ok: true });
});

// ─── Reply routing ────────────────────────────────────────────────────────────
// Replies to a mention story go to the tagger. The server picks the bucket:
// Inbox when the tagger follows me, or I'm a seller they have a paid order
// with; otherwise Requests. The client then sends the message into the
// returned conversation through the normal messages endpoint.
router.post("/stories/:id/mention-reply", rateLimit("messaging"), async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const restriction = await publishingRestriction(myId);
  if (restriction) { res.status(restriction.status).json(restriction.body); return; }

  const [story] = await db.select().from(stories).where(eq(stories.id, String(req.params.id))).limit(1);
  if (!story || !isLive(story)) { res.status(404).json({ error: "Story unavailable", code: "STORY_UNAVAILABLE" }); return; }
  const [tagged] = await db.select({ storyId: storyMentions.storyId }).from(storyMentions)
    .where(and(eq(storyMentions.storyId, story.id), eq(storyMentions.mentionedUserId, myId))).limit(1);
  if (!tagged) { res.status(403).json({ error: "Only people tagged in a story can reply this way", code: "NOT_TAGGED" }); return; }

  const relation = await blockRelation(myId, story.authorId);
  if (relation === "blocked_by_me") { res.status(403).json({ error: "You blocked this account. Unblock them to send a message.", code: "BLOCKED_BY_ME" }); return; }
  if (relation !== "none") { res.status(403).json({ error: "Unable to send message.", code: "BLOCKED" }); return; }

  // The tagger sees who is replying to the story they tagged, so the
  // routing decision is always from the replier (me) to the tagger.
  const result = await ensureStoryReplyConversation(myId, story.authorId);
  if (!result) { res.status(404).json({ error: "Account not found" }); return; }
  res.json({
    conversationId: result.conversation.id,
    route: result.conversation.isRequest ? "requests" : "inbox",
    isRequest: result.conversation.isRequest,
    requestedBy: result.conversation.requestedBy ?? null,
  });
});

export default router;
