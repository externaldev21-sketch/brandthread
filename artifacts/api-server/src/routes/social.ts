/**
 * Buyer-to-buyer social graph.
 *
 * POST   /api/social/follow              — follow a buyer   { userId }
 * DELETE /api/social/follow/:userId      — unfollow
 * GET    /api/social/following           — users I follow
 * GET    /api/social/followers           — users who follow me (isFollowingBack flag)
 * GET    /api/social/status/:userId      — { isFollowing, isFollowedBy, isMutual }
 * GET    /api/social/profile/:userId     — public buyer profile + follow counts
 * GET    /api/social/search?q=&limit=    — search buyers by name / username
 */
import { Router } from "express";
import { db, users, follows, stories, storyLikes, storyViews, blocks, posts, interactions } from "@workspace/db";
import { eq, and, or, ilike, ne, inArray, sql, gt, desc, count, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { publishNotification } from "./notifications-feed";
import { resolveToClerkId } from "./public";
import { evaluateContent, matchesMutedWords } from "../lib/contentModerator";
import { visibleCommentCounts } from "../lib/postVisibility";
import {
  authorInGoodStanding,
  blockRelation,
  mutedPhrasesFor,
  notBlockedWith,
  profilesById,
  publishingRestriction,
} from "../lib/safety";
import { actorFieldsFromProfile } from "../lib/activityEvents";
import { parsePagination, setPaginationHeaders } from "../lib/pagination";

const router = Router();
router.use(requireAuth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "#8B5CF6","#EC4899","#3B82F6","#10B981","#F59E0B",
  "#EF4444","#6366F1","#14B8A6","#F97316","#64748B",
];
function avatarColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return p.length >= 2
    ? `${p[0][0]}${p[p.length - 1][0]}`.toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

type UserRow = typeof users.$inferSelect;
function formatUser(u: UserRow) {
  const nm = u.displayName || u.name || "Unknown";
  return {
    userId:      u.clerkId,
    name:        nm,
    username:    u.username ?? null,
    displayName: u.displayName ?? null,
    bio:         u.bio ?? null,
    // Uploaded profile photos win over the Clerk avatar; private /objects/
    // storage paths are never exposed.
    avatarUrl:   (typeof u.profileImageUrl === "string" && u.profileImageUrl.startsWith("http")
      ? u.profileImageUrl
      : (u as any).avatarUrl) ?? null,
    accountType: u.accountType,
    initials:    initials(nm),
    color:       avatarColor(u.clerkId),
    handle:      u.username ? `@${u.username}` : `@${nm.toLowerCase().replace(/\s+/g, "")}`,
  };
}

function countOne(arr: { n: number }[] | undefined) {
  return arr?.[0]?.n ?? 0;
}

async function followerCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(follows)
    .where(eq(follows.followingId, userId));
  return row?.n ?? 0;
}

function relationshipLockKey(firstUserId: string, secondUserId: string): string {
  return JSON.stringify([firstUserId, secondUserId].sort());
}

async function buildBuyerPosts(
  viewerId: string,
  authorIds: string[],
  limit: number,
  offset: number,
  postId?: string,
) {
  if (authorIds.length === 0) return [];
  const pageRows = await db.select({
    id: posts.id,
    userId: posts.userId,
    mediaUrl: posts.mediaUrl,
    mediaType: posts.mediaType,
    caption: posts.caption,
    styleTags: posts.styleTags,
    createdAt: posts.createdAt,
    name: users.name,
    displayName: users.displayName,
    username: users.username,
  }).from(posts)
    .innerJoin(users, and(
      eq(users.clerkId, posts.userId),
      eq(users.accountType, "buyer"),
      inArray(posts.userId, authorIds),
    ))
    .where(and(
      sql`${posts.postStatus} NOT IN ('deleted', 'archived', 'draft')`,
      eq(posts.moderationStatus, "visible"),
      authorInGoodStanding(posts.userId),
      notBlockedWith(viewerId, posts.userId),
      ...(postId ? [eq(posts.id, postId)] : []),
    ))
    .orderBy(desc(posts.createdAt))
    .limit(limit)
    .offset(offset);

  const muted = await mutedPhrasesFor(viewerId);
  const rows = muted.length === 0
    ? pageRows
    : pageRows.filter((row) => row.userId === viewerId || !matchesMutedWords(row.caption, muted));
  if (rows.length === 0) return [];
  const postIds = rows.map((row) => row.id);
  const [likeRows, repostRows, commentRows, myRows] = await Promise.all([
    db.select({ postId: interactions.postId, n: count() }).from(interactions)
      .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "like")))
      .groupBy(interactions.postId),
    db.select({ postId: interactions.postId, n: count() }).from(interactions)
      .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "repost")))
      .groupBy(interactions.postId),
    visibleCommentCounts(postIds),
    db.select({ postId: interactions.postId, type: interactions.type }).from(interactions)
      .where(and(
        inArray(interactions.postId, postIds),
        eq(interactions.userId, viewerId),
        inArray(interactions.type, ["like", "repost"]),
      )),
  ]);
  const counts = (rows: Array<{ postId: string | null; n: number }>) =>
    new Map(rows.filter((row) => row.postId).map((row) => [row.postId as string, Number(row.n)]));
  const likes = counts(likeRows);
  const reposts = counts(repostRows);
  const comments = commentRows;
  const mine = new Map<string, Set<string>>();
  for (const row of myRows) {
    if (!row.postId) continue;
    if (!mine.has(row.postId)) mine.set(row.postId, new Set());
    mine.get(row.postId)!.add(row.type);
  }

  return rows.map((row) => {
    const name = row.displayName || row.name || "Buyer";
    return {
      id: row.id,
      authorId: row.userId,
      authorName: name,
      authorHandle: row.username ? `@${row.username}` : `@${name.toLowerCase().replace(/\s+/g, "")}`,
      authorInitials: initials(name),
      authorColor: avatarColor(row.userId),
      authorAccountType: "buyer",
      feedEligibility: "profile_only",
      profileVisibility: "friends_only",
      type: row.mediaType,
      mediaUrl: row.mediaUrl,
      caption: row.caption ?? "",
      hashtags: row.styleTags ?? [],
      mediaColors: [avatarColor(row.userId), "#07070f"],
      likesCount: likes.get(row.id) ?? 0,
      commentsCount: comments.get(row.id) ?? 0,
      repostsCount: reposts.get(row.id) ?? 0,
      likedByMe: mine.get(row.id)?.has("like") ?? false,
      repostedByMe: mine.get(row.id)?.has("repost") ?? false,
      savedByMe: false,
      isArchived: false,
      isDraft: false,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
    };
  });
}

// ─── POST /api/social/follow ──────────────────────────────────────────────────
router.post("/follow", rateLimit("follow"), async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const { userId } = req.body as { userId?: string };
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId required" }); return;
  }
  if (userId === myId) {
    res.status(400).json({ error: "Cannot follow yourself" }); return;
  }
  const [target] = await db.select({ clerkId: users.clerkId })
    .from(users).where(eq(users.clerkId, userId)).limit(1);
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${relationshipLockKey(myId, userId)}, 0)
      )
    `);
    const [blockRow] = await tx.select({ blockerId: blocks.blockerId }).from(blocks)
      .where(or(
        and(eq(blocks.blockerId, userId), eq(blocks.blockedId, myId)),
        and(eq(blocks.blockerId, myId), eq(blocks.blockedId, userId)),
      )).limit(1);
    if (blockRow) return { blocked: true as const, inserted: [], followersCount: 0 };

    const inserted = await tx.insert(follows)
      .values({ followerId: myId, followingId: userId })
      .onConflictDoNothing()
      .returning();
    const [countRow] = await tx
      .select({ n: sql<number>`cast(count(*) as int)` })
      .from(follows)
      .where(eq(follows.followingId, userId));
    return { blocked: false as const, inserted, followersCount: countRow?.n ?? 0 };
  });
  if (result.blocked) {
    res.status(403).json({ error: "Unable to follow this user.", code: "BLOCKED" }); return;
  }

  // Only notify when this is a genuinely new follow (not a duplicate/retry)
  if (result.inserted.length > 0) {
    (async () => {
      try {
        const profile = (await profilesById([myId])).get(myId);
        if (profile && !profile.deleted && !profile.suspended) {
          const actor = actorFieldsFromProfile(profile);
          // Offer "Follow back" only when the relationship is one-way.
          const [alreadyFollowing] = await db
            .select({ followerId: follows.followerId })
            .from(follows)
            .where(and(eq(follows.followerId, userId), eq(follows.followingId, myId)))
            .limit(1);
          await publishNotification({
            userId:        userId,
            category:      "social",
            type:          "new_follower",
            title:         `${actor.actorName} started following you`,
            ...actor,
            targetId:      myId,
            targetType:    "user",
            cta:           alreadyFollowing ? undefined : "Follow back",
          });
        }
      } catch { /* non-critical */ }
    })();
  }

  res.json({ ok: true, isFollowing: true, followersCount: result.followersCount });
});

// ─── DELETE /api/social/follow/:userId ───────────────────────────────────────
router.delete("/follow/:userId", rateLimit("follow"), async (req, res) => {
  const myId   = (req as any).clerkUserId as string;
  const target = req.params.userId as string;
  const followersCount = await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${relationshipLockKey(myId, target)}, 0)
      )
    `);
    await tx.delete(follows)
      .where(and(eq(follows.followerId, myId), eq(follows.followingId, target)));
    const [countRow] = await tx
      .select({ n: sql<number>`cast(count(*) as int)` })
      .from(follows)
      .where(eq(follows.followingId, target));
    return countRow?.n ?? 0;
  });
  res.json({ ok: true, isFollowing: false, followersCount });
});

// ─── GET /api/social/status/:userId ──────────────────────────────────────────
// Accepts users.clerkId or users.id (UUID) — resolves to canonical clerkId.
router.get("/status/:userId", async (req, res) => {
  const myId  = (req as any).clerkUserId as string;
  const rawId = req.params.userId;

  // Resolve UUID alias → canonical clerkId.
  const canonicalClerkId = await resolveToClerkId(rawId);
  if (!canonicalClerkId) {
    res.json({ isFollowing: false, isFollowedBy: false, isMutual: false, followersCount: 0 });
    return;
  }
  const other = canonicalClerkId;

  const [iFollowRow] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(follows)
    .where(and(eq(follows.followerId, myId), eq(follows.followingId, other)));
  const [theyFollowRow] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(follows)
    .where(and(eq(follows.followerId, other), eq(follows.followingId, myId)));

  const isFollowing  = (iFollowRow?.n   ?? 0) > 0;
  const isFollowedBy = (theyFollowRow?.n ?? 0) > 0;
  res.json({
    isFollowing,
    isFollowedBy,
    isMutual: isFollowing && isFollowedBy,
    followersCount: await followerCount(other),
  });
});

// ─── GET /api/social/profile/:userId ─────────────────────────────────────────
// Accepts users.clerkId or users.id (UUID) — resolves to canonical clerkId
// before applying block/privacy/follow checks.
router.get("/profile/:userId", async (req, res) => {
  const myId  = (req as any).clerkUserId as string;
  const rawId = req.params.userId;

  // Resolve UUID alias → canonical clerkId.
  const canonicalClerkId = await resolveToClerkId(rawId);
  if (!canonicalClerkId) { res.status(404).json({ error: "User not found" }); return; }
  const other = canonicalClerkId;

  const [user] = await db.select().from(users).where(eq(users.clerkId, other)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (user.deletedAt || user.suspendedAt) { res.status(404).json({ error: "User not found" }); return; }

  // If the target has blocked the viewer, the profile is invisible (404).
  // If the viewer blocked them, show only enough to recognise and unblock.
  const relation = other === myId ? "none" : await blockRelation(myId, other);
  if (relation === "blocked_me" || relation === "mutual") {
    res.status(404).json({ error: "User not found" }); return;
  }
  if (relation === "blocked_by_me") {
    res.json({
      ...formatUser(user),
      bio: null,
      followersCount: 0,
      followingCount: 0,
      postsCount: 0,
      isFollowing: false,
      isFollowedBy: false,
      isMutual: false,
      iBlockedThem: true,
    });
    return;
  }
  const iBlockedThem = false;

  const [follsRow] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(follows).where(eq(follows.followingId, other));
  const [fingRow] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(follows).where(eq(follows.followerId, other));
  const [iFollowRow] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(follows).where(and(eq(follows.followerId, myId), eq(follows.followingId, other)));
  const [theyFollowRow] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(follows).where(and(eq(follows.followerId, other), eq(follows.followingId, myId)));

  const isFollowing  = (iFollowRow?.n   ?? 0) > 0;
  const isFollowedBy = (theyFollowRow?.n ?? 0) > 0;

  const [postsRow] = await db.select({ n: sql<number>`cast(count(*) as int)` })
    .from(posts)
    .innerJoin(users, and(eq(users.clerkId, posts.userId), eq(users.accountType, "buyer")))
    .where(eq(posts.userId, other));

  res.json({
    ...formatUser(user),
    followersCount: follsRow?.n ?? 0,
    followingCount: fingRow?.n  ?? 0,
    postsCount:     postsRow?.n ?? 0,
    isFollowing,
    isFollowedBy,
    isMutual: isFollowing && isFollowedBy,
    iBlockedThem,
  });
});

// ─── GET /api/social/posts/:postId ───────────────────────────────────────────
// A single post by id, in the same normalized BuyerPost shape as
// /profile/:userId/posts — for opening a specific post (e.g. from a saved
// item or collection) without knowing the author in advance. Applies the
// same visibility rule as the list route: viewable if it's the viewer's own
// post, or the author is a mutual friend.
router.get("/posts/:postId", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const { postId } = req.params;

  const [row] = await db.select({ userId: posts.userId }).from(posts)
    .where(eq(posts.id, postId)).limit(1);
  if (!row) { res.status(404).json({ error: "Post not found" }); return; }
  const authorId = row.userId;

  if (authorId !== myId) {
    if ((await blockRelation(myId, authorId)) !== "none") {
      res.status(404).json({ error: "Post not found" }); return;
    }
    const mutual = await db.execute(sql`
      SELECT 1
      FROM follows mine
      JOIN follows theirs
        ON theirs.follower_id = mine.following_id
       AND theirs.following_id = ${myId}
      WHERE mine.follower_id = ${myId}
        AND mine.following_id = ${authorId}
      LIMIT 1
    `);
    if ((((mutual as any).rows ?? []) as any[]).length === 0) {
      res.status(403).json({ error: "Posts are available to friends only" }); return;
    }
  }

  const [found] = await buildBuyerPosts(myId, [authorId], 1, 0, postId);
  if (!found) { res.status(404).json({ error: "Post not found" }); return; }
  res.json(found);
});

// Accepts users.clerkId or users.id (UUID) — resolves before block/friend checks.
router.get("/profile/:userId/posts", async (req, res) => {
  const myId  = (req as any).clerkUserId as string;
  const rawId = req.params.userId;
  const limit  = Math.min(Math.max(parseInt(String(req.query.limit  ?? "30"), 10) || 30, 1), 50);
  const offset = Math.max(parseInt(String(req.query.offset ?? "0"),  10) || 0, 0);

  // Resolve UUID alias → canonical clerkId.
  const canonicalClerkId = await resolveToClerkId(rawId);
  if (!canonicalClerkId) { res.status(404).json({ error: "User not found" }); return; }
  const other = canonicalClerkId;

  if (other !== myId && (await blockRelation(myId, other)) !== "none") {
    res.status(404).json({ error: "User not found" }); return;
  }
  if (other !== myId) {
    const mutual = await db.execute(sql`
      SELECT 1
      FROM follows mine
      JOIN follows theirs
        ON theirs.follower_id = mine.following_id
       AND theirs.following_id = ${myId}
      WHERE mine.follower_id = ${myId}
        AND mine.following_id = ${other}
      LIMIT 1
    `);
    if ((((mutual as any).rows ?? []) as any[]).length === 0) {
      res.status(403).json({ error: "Posts are available to friends only" }); return;
    }
  }
  res.json(await buildBuyerPosts(myId, [other], limit, offset));
});

router.get("/friends/activity", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "30"), 10) || 30, 1), 50);
  const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
  const mutualRows = await db.execute(sql`
    SELECT f1.following_id
    FROM follows f1
    JOIN follows f2
      ON f2.follower_id = f1.following_id
     AND f2.following_id = ${myId}
    JOIN users u ON u.clerk_id = f1.following_id AND u.account_type = 'buyer'
    WHERE f1.follower_id = ${myId}
  `);
  const authorIds = (((mutualRows as any).rows ?? []) as any[])
    .map((row: any) => String(row.following_id));
  res.json(await buildBuyerPosts(myId, authorIds, limit, offset));
});

/**
 * Whose follower/following list is being read: the viewer by default, or the
 * profile named by `?userId=` (Clerk ID or users.id alias). Another person's
 * list is hidden (404) when either side has blocked the other. Returns null
 * after sending the error response.
 */
async function resolveListOwner(req: any, res: any, myId: string): Promise<string | null> {
  const raw = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
  if (!raw || raw === myId) return myId;
  const owner = await resolveToClerkId(raw);
  if (!owner) { res.status(404).json({ error: "User not found" }); return null; }
  if (owner !== myId && (await blockRelation(myId, owner)) !== "none") {
    res.status(404).json({ error: "User not found" }); return null;
  }
  return owner;
}

/** Which of `ids` the viewer follows — drives the list's Follow / Following state. */
async function viewerFollowsSet(myId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ followingId: follows.followingId })
    .from(follows)
    .where(and(eq(follows.followerId, myId), inArray(follows.followingId, ids)));
  return new Set(rows.map(r => r.followingId));
}

// ─── GET /api/social/following ────────────────────────────────────────────────
// Query params: ?userId=&limit=&offset= (default 100, capped at MAX_PAGE_LIMIT).
// Without userId the list is the viewer's own.
router.get("/following", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const page = parsePagination(req.query, { limit: 100 });
  if (!page.success) { res.status(400).json({ error: "Invalid pagination", code: "VALIDATION_ERROR" }); return; }
  const ownerId = await resolveListOwner(req, res, myId);
  if (!ownerId) return;
  const { limit, offset } = page.data;
  const rows = await db
    .select({ followingId: follows.followingId, createdAt: follows.createdAt })
    .from(follows).where(eq(follows.followerId, ownerId))
    .orderBy(desc(follows.createdAt))
    .limit(limit).offset(offset);
  setPaginationHeaders(res, page.data, rows.length);
  if (!rows.length) { res.json([]); return; }

  const ids      = rows.map(r => r.followingId);
  const userRows = await db.select().from(users).where(inArray(users.clerkId, ids));
  const byId     = Object.fromEntries(userRows.map(u => [u.clerkId, u]));
  const iFollow  = ownerId === myId ? new Set(ids) : await viewerFollowsSet(myId, ids);

  res.json(rows.map(r => ({
    ...(byId[r.followingId] ? formatUser(byId[r.followingId]) : {
      userId: r.followingId, name: "Unknown", username: null, displayName: null,
      bio: null, avatarUrl: null, accountType: "buyer",
      initials: "?", color: avatarColor(r.followingId), handle: "@unknown",
    }),
    followedAt: r.createdAt,
    isFollowing: iFollow.has(r.followingId),
  })));
});

// ─── GET /api/social/followers ────────────────────────────────────────────────
// Query params: ?userId=&limit=&offset= (default 100, capped at MAX_PAGE_LIMIT).
// Without userId the list is the viewer's own.
router.get("/followers", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const page = parsePagination(req.query, { limit: 100 });
  if (!page.success) { res.status(400).json({ error: "Invalid pagination", code: "VALIDATION_ERROR" }); return; }
  const ownerId = await resolveListOwner(req, res, myId);
  if (!ownerId) return;
  const { limit, offset } = page.data;
  const rows = await db
    .select({ followerId: follows.followerId, createdAt: follows.createdAt })
    .from(follows).where(eq(follows.followingId, ownerId))
    .orderBy(desc(follows.createdAt))
    .limit(limit).offset(offset);
  setPaginationHeaders(res, page.data, rows.length);
  if (!rows.length) { res.json([]); return; }

  const ids      = rows.map(r => r.followerId);
  const userRows = await db.select().from(users).where(inArray(users.clerkId, ids));
  const byId     = Object.fromEntries(userRows.map(u => [u.clerkId, u]));

  // Who the viewer already follows (on their own list: who they follow back)
  const iFollowBack = await viewerFollowsSet(myId, ids);

  res.json(rows.map(r => ({
    ...(byId[r.followerId] ? formatUser(byId[r.followerId]) : {
      userId: r.followerId, name: "Unknown", username: null, displayName: null,
      bio: null, avatarUrl: null, accountType: "buyer",
      initials: "?", color: avatarColor(r.followerId), handle: "@unknown",
    }),
    followedAt:       r.createdAt,
    isFollowingBack:  iFollowBack.has(r.followerId),
    isFollowing:      iFollowBack.has(r.followerId),
  })));
});

// ─── GET /api/social/search?q=&limit= ────────────────────────────────────────
router.get("/search", async (req, res) => {
  const myId  = (req as any).clerkUserId as string;
  const q     = ((req.query.q as string) || "").trim();
  const limit = Math.min(parseInt((req.query.limit as string) || "20", 10), 50);
  if (q.length < 1) { res.json([]); return; }

  const pattern = `%${q}%`;
  const rows = await db.select().from(users)
    .where(
      and(
        eq(users.accountType, "buyer"),
        ne(users.clerkId, myId),
        isNull(users.suspendedAt),
        isNull(users.deletedAt),
        notBlockedWith(myId, users.clerkId),
        or(
          ilike(users.name,        pattern),
          ilike(users.displayName, pattern),
          ilike(users.username,    pattern),
        )
      )
    )
    .limit(limit);

  if (!rows.length) { res.json([]); return; }

  const ids = rows.map(u => u.clerkId);
  const followingSet = new Set(
    (await db
      .select({ followingId: follows.followingId })
      .from(follows)
      .where(and(eq(follows.followerId, myId), inArray(follows.followingId, ids)))
    ).map(r => r.followingId)
  );

  res.json(rows.map(u => ({ ...formatUser(u), isFollowing: followingSet.has(u.clerkId) })));
});

// ═══════════════════════════════════════════════════════════════════════════════
// STORIES
// ═══════════════════════════════════════════════════════════════════════════════

function buildStoryView(row: typeof stories.$inferSelect, likedByMe: boolean) {
  return {
    id:                row.id,
    authorId:          row.authorId,
    authorName:        row.authorName,
    authorHandle:      row.authorHandle  ?? "",
    authorInitials:    row.authorInitials ?? "",
    authorColor:       row.authorColor   ?? "#8B5CF6",
    authorAccountType: row.authorAccountType,
    media:             (row.media as any[]) ?? [],
    repliesDisabled:   row.repliesDisabled,
    privacy: {
      visibility:        row.privacyVisibility,
      replyPermission:   row.privacyReplyPerm,
      hiddenFromUserIds: [],
      closeFriendsOnly:  false,
    },
    viewers:    [],          // viewer list omitted for listing; fetch separately if needed
    likesCount: row.likesCount,
    viewsCount: row.viewsCount,
    likedByMe,
    createdAt: new Date(row.createdAt).getTime(),
    expiresAt: new Date(row.expiresAt).getTime(),
  };
}

async function isFollowing(followerId: string, followingId: string): Promise<boolean> {
  const [row] = await db.select({ followerId: follows.followerId }).from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
    .limit(1);
  return !!row;
}

/** Loads {id, moderationStatus, expiresAt} for an active (non-expired, visible) story. */
async function loadActiveStory(storyId: string) {
  const [row] = await db.select().from(stories).where(eq(stories.id, storyId)).limit(1);
  if (!row) return null;
  if (row.moderationStatus === "removed") return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
  return row;
}

// ─── POST /api/social/stories — create a story ───────────────────────────────
router.post("/stories", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const { media, repliesDisabled, privacy } = req.body as {
    media:              any[];
    repliesDisabled?:   boolean;
    privacy?: { visibility?: string; replyPermission?: string; };
  };

  if (!Array.isArray(media) || media.length === 0) {
    res.status(400).json({ error: "media[] required" }); return;
  }

  const restriction = await publishingRestriction(myId);
  if (restriction) { res.status(restriction.status).json(restriction.body); return; }

  // Author identity is derived server-side from the users table — the client
  // cannot spoof its display name, handle, or (critically) account type by
  // sending arbitrary authorName/authorAccountType fields.
  const [me] = await db.select({
    name: users.name, displayName: users.displayName, username: users.username,
    accountType: users.accountType,
  }).from(users).where(eq(users.clerkId, myId)).limit(1);
  if (!me) { res.status(403).json({ error: "Account not found" }); return; }
  const myName = me.displayName || me.name || "Brandthread member";

  // Slurs and threats are filtered everywhere, including story text.
  const storyText = media
    .flatMap((item: any) => [item?.caption, item?.text, ...(Array.isArray(item?.textOverlays) ? item.textOverlays.map((o: any) => o?.text) : [])])
    .filter((value: unknown): value is string => typeof value === "string")
    .join(" ");
  const storyDecision = evaluateContent(storyText, "dm");
  if (storyDecision.action === "reject" && (storyDecision.category === "hate_speech" || storyDecision.category === "harassment")) {
    res.status(422).json({ error: storyDecision.reason, category: storyDecision.category, code: "CONTENT_REJECTED" }); return;
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const visibility = privacy?.visibility === "friends" ? "friends" : "public";

  const [row] = await db.insert(stories).values({
    authorId:           myId,
    authorName:         myName,
    authorHandle:        me.username ? `@${me.username}` : `@${myName.toLowerCase().replace(/\s+/g, "")}`,
    authorInitials:      initials(myName),
    authorColor:         avatarColor(myId),
    authorAccountType:   me.accountType ?? "buyer",
    media,
    repliesDisabled:    repliesDisabled ?? false,
    privacyVisibility:  visibility,
    privacyReplyPerm:   privacy?.replyPermission ?? "everyone",
    expiresAt,
  }).returning();

  res.status(201).json(buildStoryView(row, false));
});

// ─── GET /api/social/stories/me — my active stories ─────────────────────────
router.get("/stories/me", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const now  = new Date();
  const rows = await db.select().from(stories)
    .where(and(eq(stories.authorId, myId), gt(stories.expiresAt, now), ne(stories.moderationStatus, "removed")));

  const likedSet = rows.length
    ? new Set(
        (await db.select({ storyId: storyLikes.storyId }).from(storyLikes)
          .where(and(eq(storyLikes.userId, myId),
                     inArray(storyLikes.storyId, rows.map(r => r.id)))))
        .map(r => r.storyId)
      )
    : new Set<string>();

  res.json(rows.map(r => buildStoryView(r, likedSet.has(r.id))));
});

// ─── GET /api/social/stories/user/:userId — another user's active stories ────
// Stories are visible only to the author's followers (spec: "24h stories
// visible to their followers"); a 'friends' privacy setting additionally
// requires the relationship to be mutual.
router.get("/stories/user/:userId", async (req, res) => {
  const myId    = (req as any).clerkUserId as string;
  const authorId = req.params.userId;
  const now     = new Date();

  if (authorId !== myId) {
    if ((await blockRelation(myId, authorId)) !== "none") { res.json([]); return; }
    if (!(await isFollowing(myId, authorId))) { res.json([]); return; }
  }

  const rows = await db.select().from(stories)
    .where(and(eq(stories.authorId, authorId), gt(stories.expiresAt, now), ne(stories.moderationStatus, "removed")));

  if (!rows.length) { res.json([]); return; }

  const visibleRows = authorId === myId
    ? rows
    : rows.filter((r) => r.privacyVisibility !== "friends");
  const needsMutualCheck = authorId !== myId && rows.some((r) => r.privacyVisibility === "friends");
  const finalRows = needsMutualCheck && await isFollowing(authorId, myId)
    ? rows
    : visibleRows;

  if (!finalRows.length) { res.json([]); return; }

  const likedSet = new Set(
    (await db.select({ storyId: storyLikes.storyId }).from(storyLikes)
      .where(and(eq(storyLikes.userId, myId),
                 inArray(storyLikes.storyId, finalRows.map(r => r.id)))))
    .map(r => r.storyId)
  );

  res.json(finalRows.map(r => buildStoryView(r, likedSet.has(r.id))));
});

// ─── GET /api/social/stories/following — stories tray ────────────────────────
// One entry per followed author (plus myself, if I have an active story),
// each with `seen` = true only once every one of that author's active
// stories has been viewed by me — this drives the ring color in the tray.
router.get("/stories/following", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const now  = new Date();

  const followingRows = await db.select({ followingId: follows.followingId })
    .from(follows).where(eq(follows.followerId, myId));
  const authorIds = Array.from(new Set([myId, ...followingRows.map((r) => r.followingId)]));

  const rows = await db.select().from(stories)
    .where(and(inArray(stories.authorId, authorIds), gt(stories.expiresAt, now), ne(stories.moderationStatus, "removed")))
    .orderBy(desc(stories.createdAt));
  if (!rows.length) { res.json([]); return; }

  const blockedIds = new Set(
    (await db.select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId }).from(blocks)
      .where(or(eq(blocks.blockerId, myId), eq(blocks.blockedId, myId))))
      .flatMap((b) => [b.blockerId === myId ? b.blockedId : b.blockerId]),
  );

  const visibleRows = rows.filter((r) => {
    if (r.authorId === myId) return true;
    if (blockedIds.has(r.authorId)) return false;
    if (r.privacyVisibility === "friends") return false; // mutual-only check omitted from the tray for simplicity; per-user fetch still enforces it
    return true;
  });
  if (!visibleRows.length) { res.json([]); return; }

  const viewedRows = await db.select({ storyId: storyViews.storyId }).from(storyViews)
    .where(and(eq(storyViews.userId, myId), inArray(storyViews.storyId, visibleRows.map((r) => r.id))));
  const viewedSet = new Set(viewedRows.map((r) => r.storyId));

  const byAuthor = new Map<string, typeof visibleRows>();
  for (const row of visibleRows) {
    if (!byAuthor.has(row.authorId)) byAuthor.set(row.authorId, []);
    byAuthor.get(row.authorId)!.push(row);
  }

  const result = Array.from(byAuthor.entries()).map(([authorId, authorStories]) => {
    const latest = authorStories[0];
    return {
      authorId,
      authorName:        latest.authorName,
      authorHandle:      latest.authorHandle ?? "",
      authorInitials:    latest.authorInitials ?? "",
      authorColor:       latest.authorColor ?? "#8B5CF6",
      authorAccountType: latest.authorAccountType,
      isMe:              authorId === myId,
      storyIds:          authorStories.map((s) => s.id),
      seen:              authorStories.every((s) => viewedSet.has(s.id)),
      latestCreatedAt:   new Date(latest.createdAt).getTime(),
    };
  });

  result.sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    if (a.seen !== b.seen) return a.seen ? 1 : -1;
    return b.latestCreatedAt - a.latestCreatedAt;
  });

  res.json(result);
});

// ─── GET /api/social/stories/:id/viewers — seen-by list (owner only) ─────────
router.get("/stories/:id/viewers", async (req, res) => {
  const myId    = (req as any).clerkUserId as string;
  const storyId = req.params.id;

  const [story] = await db.select({ authorId: stories.authorId }).from(stories)
    .where(eq(stories.id, storyId)).limit(1);
  if (!story) { res.status(404).json({ error: "Story not found" }); return; }
  if (story.authorId !== myId) { res.status(403).json({ error: "Only the author can see who viewed this story" }); return; }

  const viewRows = await db.select({ userId: storyViews.userId, viewedAt: storyViews.viewedAt })
    .from(storyViews).where(eq(storyViews.storyId, storyId))
    .orderBy(desc(storyViews.viewedAt));
  if (!viewRows.length) { res.json([]); return; }

  const profiles = await profilesById(viewRows.map((r) => r.userId));
  res.json(viewRows.map((r) => {
    const p = profiles.get(r.userId);
    return {
      userId:    r.userId,
      name:      p?.deleted ? "Deleted account" : p?.name ?? "Brandthread member",
      handle:    p?.handle ?? "",
      initials:  p?.initials ?? "BM",
      avatarUrl: p?.avatarUrl ?? null,
      viewedAt:  r.viewedAt,
    };
  }));
});

// ─── DELETE /api/social/stories/:id — author removes their own story early ───
router.delete("/stories/:id", async (req, res) => {
  const myId    = (req as any).clerkUserId as string;
  const storyId = req.params.id;
  const [deleted] = await db.delete(stories)
    .where(and(eq(stories.id, storyId), eq(stories.authorId, myId)))
    .returning({ id: stories.id });
  if (!deleted) { res.status(404).json({ error: "Story not found" }); return; }
  res.json({ id: deleted.id, deleted: true });
});

// ─── POST /api/social/stories/:id/like — toggle like ─────────────────────────
router.post("/stories/:id/like", async (req, res) => {
  const myId    = (req as any).clerkUserId as string;
  const storyId = req.params.id;

  const story = await loadActiveStory(storyId);
  if (!story) { res.status(404).json({ error: "Story not found" }); return; }
  if (story.authorId !== myId && (await blockRelation(myId, story.authorId)) !== "none") {
    res.status(404).json({ error: "Story not found" }); return;
  }

  const [existing] = await db.select({ storyId: storyLikes.storyId })
    .from(storyLikes)
    .where(and(eq(storyLikes.storyId, storyId), eq(storyLikes.userId, myId)))
    .limit(1);

  let liked: boolean;
  if (existing) {
    await db.delete(storyLikes)
      .where(and(eq(storyLikes.storyId, storyId), eq(storyLikes.userId, myId)));
    await db.update(stories)
      .set({ likesCount: sql`GREATEST(likes_count - 1, 0)` })
      .where(eq(stories.id, storyId));
    liked = false;
  } else {
    await db.insert(storyLikes).values({ storyId, userId: myId }).onConflictDoNothing();
    await db.update(stories)
      .set({ likesCount: sql`likes_count + 1` })
      .where(eq(stories.id, storyId));
    liked = true;
  }

  const [row] = await db.select({ likesCount: stories.likesCount })
    .from(stories).where(eq(stories.id, storyId)).limit(1);
  res.json({ liked, likesCount: row?.likesCount ?? 0 });
});

// ─── POST /api/social/stories/:id/view — record a view ───────────────────────
router.post("/stories/:id/view", async (req, res) => {
  const myId    = (req as any).clerkUserId as string;
  const storyId = req.params.id;

  const story = await loadActiveStory(storyId);
  if (!story) { res.status(404).json({ error: "Story not found" }); return; }
  if (story.authorId !== myId && (await blockRelation(myId, story.authorId)) !== "none") {
    res.status(404).json({ error: "Story not found" }); return;
  }

  const [existing] = await db.select({ storyId: storyViews.storyId })
    .from(storyViews)
    .where(and(eq(storyViews.storyId, storyId), eq(storyViews.userId, myId)))
    .limit(1);

  if (!existing) {
    await db.insert(storyViews).values({ storyId, userId: myId }).onConflictDoNothing();
    await db.update(stories)
      .set({ viewsCount: sql`views_count + 1` })
      .where(eq(stories.id, storyId));
  } else {
    // Update viewedAt
    await db.update(storyViews)
      .set({ viewedAt: new Date() })
      .where(and(eq(storyViews.storyId, storyId), eq(storyViews.userId, myId)));
  }

  res.json({ ok: true });
});

// ─── Block CRUD ───────────────────────────────────────────────────────────────

// POST /api/social/block — block a user; also removes any mutual follows
router.post("/block", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const { userId: rawUserId } = req.body as { userId?: string };
  if (!rawUserId || typeof rawUserId !== "string") {
    res.status(400).json({ error: "userId required" }); return;
  }
  // Accept a users.id alias as well as a Clerk ID.
  const userId = (await resolveToClerkId(rawUserId)) ?? rawUserId;
  if (userId === myId) {
    res.status(400).json({ error: "Cannot block yourself" }); return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${relationshipLockKey(myId, userId)}, 0)
      )
    `);
    await tx.insert(blocks).values({ blockerId: myId, blockedId: userId })
      .onConflictDoNothing();
    await tx.delete(follows).where(or(
      and(eq(follows.followerId, myId), eq(follows.followingId, userId)),
      and(eq(follows.followerId, userId), eq(follows.followingId, myId)),
    ));
  });

  res.json({ ok: true });
});

// DELETE /api/social/block/:userId — unblock
router.delete("/block/:userId", async (req, res) => {
  const myId   = (req as any).clerkUserId as string;
  const target = (await resolveToClerkId(req.params.userId)) ?? req.params.userId;
  await db.delete(blocks)
    .where(and(eq(blocks.blockerId, myId), eq(blocks.blockedId, target)));
  res.json({ ok: true });
});

// GET /api/social/blocks — list users I have blocked
router.get("/blocks", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const page = parsePagination(req.query, { limit: 100 });
  if (!page.success) { res.status(400).json({ error: "Invalid pagination", code: "VALIDATION_ERROR" }); return; }
  const { limit, offset } = page.data;
  const rows = await db
    .select({ blockedId: blocks.blockedId, createdAt: blocks.createdAt })
    .from(blocks)
    .where(eq(blocks.blockerId, myId))
    .orderBy(desc(blocks.createdAt)).limit(limit).offset(offset);
  setPaginationHeaders(res, page.data, rows.length);

  if (rows.length === 0) { res.json([]); return; }

  const profiles = await profilesById(rows.map((r) => r.blockedId));
  res.json(rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => {
      const p = profiles.get(r.blockedId);
      return {
        userId:      r.blockedId,
        name:        p?.deleted ? "Deleted account" : p?.name ?? "Brandthread member",
        handle:      p?.handle ?? "",
        initials:    p?.initials ?? "BM",
        avatarUrl:   p?.avatarUrl ?? null,
        accountType: p?.accountType ?? null,
        color:       "#3F3F46",
        blockedAt:   r.createdAt,
      };
    }));
});

export default router;
