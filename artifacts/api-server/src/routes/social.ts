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
import { eq, and, or, ilike, ne, inArray, sql, gt, desc, count } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { publishNotification } from "./notifications-feed";

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
    avatarUrl:   (u as any).avatarUrl ?? null,
    accountType: u.accountType,
    initials:    initials(nm),
    color:       avatarColor(u.clerkId),
    handle:      u.username ? `@${u.username}` : `@${nm.toLowerCase().replace(/\s+/g, "")}`,
  };
}

function countOne(arr: { n: number }[] | undefined) {
  return arr?.[0]?.n ?? 0;
}

async function buildBuyerPosts(viewerId: string, authorIds: string[], limit: number, offset: number) {
  if (authorIds.length === 0) return [];
  const rows = await db.select({
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
    .orderBy(desc(posts.createdAt))
    .limit(limit)
    .offset(offset);

  if (rows.length === 0) return [];
  const postIds = rows.map((row) => row.id);
  const [likeRows, repostRows, commentRows, myRows] = await Promise.all([
    db.select({ postId: interactions.postId, n: count() }).from(interactions)
      .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "like")))
      .groupBy(interactions.postId),
    db.select({ postId: interactions.postId, n: count() }).from(interactions)
      .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "repost")))
      .groupBy(interactions.postId),
    db.select({ postId: interactions.postId, n: count() }).from(interactions)
      .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "comment")))
      .groupBy(interactions.postId),
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
  const comments = counts(commentRows);
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
router.post("/follow", async (req, res) => {
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

  // Cannot follow someone who has blocked you
  const [blockRow] = await db.select({ blockerId: blocks.blockerId }).from(blocks)
    .where(and(eq(blocks.blockerId, userId), eq(blocks.blockedId, myId))).limit(1);
  if (blockRow) { res.status(403).json({ error: "Unable to follow this user.", code: "BLOCKED" }); return; }

  const inserted = await db.insert(follows).values({ followerId: myId, followingId: userId })
    .onConflictDoNothing().returning();

  // Only notify when this is a genuinely new follow (not a duplicate/retry)
  if (inserted.length > 0) {
    (async () => {
      try {
        const [follower] = await db
          .select({ name: users.name, displayName: users.displayName, username: users.username })
          .from(users).where(eq(users.clerkId, myId)).limit(1);
        if (follower) {
          const displayName = follower.displayName || follower.name || "Someone";
          const handle = follower.username ? `@${follower.username}` : undefined;
          const inits = displayName.split(" ").slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? "").join("") || "?";
          await publishNotification({
            userId:        userId,
            category:      "social",
            type:          "new_follower",
            title:         `${displayName} started following you`,
            actorName:     displayName,
            actorHandle:   handle,
            actorInitials: inits,
            actorColor:    "#8B5CF6",
            targetId:      myId,
            targetType:    "user",
          });
        }
      } catch { /* non-critical */ }
    })();
  }

  res.json({ ok: true });
});

// ─── DELETE /api/social/follow/:userId ───────────────────────────────────────
router.delete("/follow/:userId", async (req, res) => {
  const myId   = (req as any).clerkUserId as string;
  const target = req.params.userId;
  await db.delete(follows)
    .where(and(eq(follows.followerId, myId), eq(follows.followingId, target)));
  res.json({ ok: true });
});

// ─── GET /api/social/status/:userId ──────────────────────────────────────────
router.get("/status/:userId", async (req, res) => {
  const myId  = (req as any).clerkUserId as string;
  const other = req.params.userId;

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
  res.json({ isFollowing, isFollowedBy, isMutual: isFollowing && isFollowedBy });
});

// ─── GET /api/social/profile/:userId ─────────────────────────────────────────
router.get("/profile/:userId", async (req, res) => {
  const myId  = (req as any).clerkUserId as string;
  const other = req.params.userId;

  const [user] = await db.select().from(users).where(eq(users.clerkId, other)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // If the target has blocked the viewer, return 404 (profile invisible)
  const [blockedRow] = await db.select({ blockerId: blocks.blockerId }).from(blocks)
    .where(or(
      and(eq(blocks.blockerId, other), eq(blocks.blockedId, myId)),
      and(eq(blocks.blockerId, myId), eq(blocks.blockedId, other)),
    )).limit(1);
  if (blockedRow) { res.status(404).json({ error: "User not found" }); return; }

  // Check if I have blocked them (viewer can still see profile, but flag is set)
  const [iBlockedRow] = await db.select({ blockerId: blocks.blockerId }).from(blocks)
    .where(and(eq(blocks.blockerId, myId), eq(blocks.blockedId, other))).limit(1);
  const iBlockedThem = !!iBlockedRow;

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

router.get("/profile/:userId/posts", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const other = req.params.userId;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "30"), 10) || 30, 1), 50);
  const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
  const [blockedRow] = await db.select({ blockerId: blocks.blockerId }).from(blocks)
    .where(and(eq(blocks.blockerId, other), eq(blocks.blockedId, myId))).limit(1);
  if (blockedRow) { res.status(404).json({ error: "User not found" }); return; }
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

// ─── GET /api/social/following ────────────────────────────────────────────────
router.get("/following", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const rows = await db
    .select({ followingId: follows.followingId, createdAt: follows.createdAt })
    .from(follows).where(eq(follows.followerId, myId));
  if (!rows.length) { res.json([]); return; }

  const ids      = rows.map(r => r.followingId);
  const userRows = await db.select().from(users).where(inArray(users.clerkId, ids));
  const byId     = Object.fromEntries(userRows.map(u => [u.clerkId, u]));

  res.json(rows.map(r => ({
    ...(byId[r.followingId] ? formatUser(byId[r.followingId]) : {
      userId: r.followingId, name: "Unknown", username: null, displayName: null,
      bio: null, avatarUrl: null, accountType: "buyer",
      initials: "?", color: avatarColor(r.followingId), handle: "@unknown",
    }),
    followedAt: r.createdAt,
  })));
});

// ─── GET /api/social/followers ────────────────────────────────────────────────
router.get("/followers", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const rows = await db
    .select({ followerId: follows.followerId, createdAt: follows.createdAt })
    .from(follows).where(eq(follows.followingId, myId));
  if (!rows.length) { res.json([]); return; }

  const ids      = rows.map(r => r.followerId);
  const userRows = await db.select().from(users).where(inArray(users.clerkId, ids));
  const byId     = Object.fromEntries(userRows.map(u => [u.clerkId, u]));

  // Who I already follow back
  const iFollowBack = new Set(
    (await db
      .select({ followingId: follows.followingId })
      .from(follows)
      .where(and(eq(follows.followerId, myId), inArray(follows.followingId, ids)))
    ).map(r => r.followingId)
  );

  res.json(rows.map(r => ({
    ...(byId[r.followerId] ? formatUser(byId[r.followerId]) : {
      userId: r.followerId, name: "Unknown", username: null, displayName: null,
      bio: null, avatarUrl: null, accountType: "buyer",
      initials: "?", color: avatarColor(r.followerId), handle: "@unknown",
    }),
    followedAt:       r.createdAt,
    isFollowingBack:  iFollowBack.has(r.followerId),
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

// ─── POST /api/social/stories — create a story ───────────────────────────────
router.post("/stories", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const { authorName, authorHandle, authorInitials, authorColor, authorAccountType,
          media, repliesDisabled, privacy } = req.body as {
    authorName:         string;
    authorHandle?:      string;
    authorInitials?:    string;
    authorColor?:       string;
    authorAccountType?: string;
    media:              any[];
    repliesDisabled?:   boolean;
    privacy?: { visibility?: string; replyPermission?: string; };
  };

  if (!authorName || !Array.isArray(media) || media.length === 0) {
    res.status(400).json({ error: "authorName and media[] required" }); return;
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const [row] = await db.insert(stories).values({
    authorId:           myId,
    authorName,
    authorHandle:       authorHandle   ?? null,
    authorInitials:     authorInitials ?? null,
    authorColor:        authorColor    ?? null,
    authorAccountType:  authorAccountType ?? "buyer",
    media,
    repliesDisabled:    repliesDisabled ?? false,
    privacyVisibility:  privacy?.visibility      ?? "public",
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
    .where(and(eq(stories.authorId, myId), gt(stories.expiresAt, now)));

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
// Visible to ALL authenticated users regardless of follow status.
router.get("/stories/user/:userId", async (req, res) => {
  const myId    = (req as any).clerkUserId as string;
  const authorId = req.params.userId;
  const now     = new Date();

  const rows = await db.select().from(stories)
    .where(and(eq(stories.authorId, authorId), gt(stories.expiresAt, now)));

  if (!rows.length) { res.json([]); return; }

  const likedSet = new Set(
    (await db.select({ storyId: storyLikes.storyId }).from(storyLikes)
      .where(and(eq(storyLikes.userId, myId),
                 inArray(storyLikes.storyId, rows.map(r => r.id)))))
    .map(r => r.storyId)
  );

  res.json(rows.map(r => buildStoryView(r, likedSet.has(r.id))));
});

// ─── POST /api/social/stories/:id/like — toggle like ─────────────────────────
router.post("/stories/:id/like", async (req, res) => {
  const myId    = (req as any).clerkUserId as string;
  const storyId = req.params.id;

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
  const { userId } = req.body as { userId?: string };
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId required" }); return;
  }
  if (userId === myId) {
    res.status(400).json({ error: "Cannot block yourself" }); return;
  }

  // Upsert block record
  await db.insert(blocks).values({ blockerId: myId, blockedId: userId })
    .onConflictDoNothing();

  // Remove any mutual follow relationship in both directions
  await Promise.all([
    db.delete(follows).where(and(eq(follows.followerId, myId),    eq(follows.followingId, userId))),
    db.delete(follows).where(and(eq(follows.followerId, userId),  eq(follows.followingId, myId))),
  ]);

  res.json({ ok: true });
});

// DELETE /api/social/block/:userId — unblock
router.delete("/block/:userId", async (req, res) => {
  const myId   = (req as any).clerkUserId as string;
  const target = req.params.userId;
  await db.delete(blocks)
    .where(and(eq(blocks.blockerId, myId), eq(blocks.blockedId, target)));
  res.json({ ok: true });
});

// GET /api/social/blocks — list users I have blocked
router.get("/blocks", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const rows = await db
    .select({ blockedId: blocks.blockedId, createdAt: blocks.createdAt })
    .from(blocks)
    .where(eq(blocks.blockerId, myId));

  if (rows.length === 0) { res.json([]); return; }

  const ids = rows.map(r => r.blockedId);
  const profiles = await db
    .select({
      clerkId:     users.clerkId,
      name:        users.name,
      username:    users.username,
      displayName: users.displayName,
    })
    .from(users)
    .where(inArray(users.clerkId, ids));

  const profileMap = new Map(profiles.map(p => [p.clerkId, p]));

  res.json(rows.map(r => {
    const p = profileMap.get(r.blockedId);
    const displayName = p?.displayName || p?.name || r.blockedId;
    // Derive initials from display name (first two words)
    const initials = displayName.split(' ').slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? '').join('') || '??';
    return {
      userId:    r.blockedId,
      name:      displayName,
      handle:    p?.username ? `@${p.username}` : r.blockedId,
      initials,
      color:     '#8B5CF6',  // users table has no color column; use brand default
      blockedAt: r.createdAt,
    };
  }));
});

export default router;
