/**
 * Hashtag pages, trending and search.
 *
 * GET    /api/hashtags/trending?limit=      — trending tags (public, cached ~5 min)
 * GET    /api/hashtags/search?q=            — prefix search (public)
 * GET    /api/hashtags/following            — tags I follow (auth)
 * GET    /api/hashtags/:tag                 — header + first page of posts (public)
 * GET    /api/hashtags/:tag/posts?sort=&cursor=&limit=
 * POST   /api/hashtags/:tag/follow          — (auth)
 * DELETE /api/hashtags/:tag/follow          — (auth)
 *
 * Every read joins `posts` and applies publicPostCondition(), so drafts,
 * archived/deleted, held/removed and suspended-author posts never show, and
 * viewers never see posts from people they have a block with. Tags the content
 * moderator would reject or hold are treated as nonexistent (404, and never
 * surfaced by trending or search).
 */
import { Router } from "express";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { db, hashtagFollows, postHashtags, posts } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { matchesMutedWords } from "../lib/contentModerator";
import { isTagAllowedPublicly, normalizeHashtag } from "../lib/hashtags";
import { publicPostCondition, visibleCommentCounts } from "../lib/postVisibility";
import { mutedPhrasesFor, notBlockedWith, optionalViewerId, profilesById } from "../lib/safety";

const router = Router();

const PAGE_DEFAULT = 30;
const PAGE_MAX = 50;
const MAX_FOLLOWED_TAGS = 500;

export const TRENDING_WINDOW_HOURS = 72;
export const TRENDING_MIN_POSTS = 3;
export const TRENDING_MIN_AUTHORS = 2;
export const TRENDING_MAX = 20;
const TRENDING_TTL_MS = 5 * 60_000;

type SortMode = "top" | "recent";

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

function firstString(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" ? v : null;
}

/** Normalised, publicly-allowed tag from a path param, or null (→ 404). */
function tagParam(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 120) return null;
  const tag = normalizeHashtag(raw);
  return tag && isTagAllowedPublicly(tag) ? tag : null;
}

function encodeCursor(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
function decodeCursor(raw: string | null): string | null {
  if (!raw) return null;
  try { return Buffer.from(raw, "base64url").toString("utf8"); } catch { return null; }
}

function engagementScore() {
  return sql<number>`(
    (SELECT count(*) FROM interactions i WHERE i.post_id = ${posts.id} AND i.type = 'like')
    + 2 * (SELECT count(*) FROM interactions i WHERE i.post_id = ${posts.id} AND i.type = 'repost')
    + 2 * (SELECT count(*) FROM post_comments c WHERE c.post_id = ${posts.id} AND c.moderation_status = 'visible')
  )`;
}

async function tagPostCount(tag: string, viewerId: string | null): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(postHashtags)
    .innerJoin(posts, eq(posts.id, postHashtags.postId))
    .where(and(eq(postHashtags.tag, tag), publicPostCondition(), notBlockedWith(viewerId, posts.userId)));
  return Number(row?.n ?? 0);
}

async function postsForTag(tag: string, sort: SortMode, cursorRaw: string | null, limit: number, viewerId: string | null) {
  const cursor = decodeCursor(cursorRaw);
  const where = [
    eq(postHashtags.tag, tag),
    publicPostCondition(),
    notBlockedWith(viewerId, posts.userId),
  ];
  const score = engagementScore();
  let offset = 0;
  if (sort === "recent" && cursor) {
    const [ts, id] = cursor.split("|");
    const at = new Date(ts);
    if (!Number.isNaN(at.getTime()) && id) {
      where.push(or(
        lt(postHashtags.createdAt, at),
        and(eq(postHashtags.createdAt, at), lt(posts.id, id)),
      )!);
    }
  } else if (sort === "top" && cursor?.startsWith("o")) {
    offset = Math.max(0, Math.min(Number(cursor.slice(1)) || 0, 1000));
  }

  const rows = await db
    .select({
      id: posts.id,
      userId: posts.userId,
      mediaType: posts.mediaType,
      mediaUrl: posts.mediaUrl,
      mediaUrls: posts.mediaUrls,
      thumbnailUrl: posts.thumbnailUrl,
      aspectRatio: posts.aspectRatio,
      caption: posts.caption,
      hashtags: posts.hashtags,
      visibility: posts.visibility,
      createdAt: posts.createdAt,
      indexedAt: postHashtags.createdAt,
      score,
      likes: sql<number>`(SELECT count(*)::int FROM interactions i WHERE i.post_id = ${posts.id} AND i.type = 'like')`,
    })
    .from(postHashtags)
    .innerJoin(posts, eq(posts.id, postHashtags.postId))
    .where(and(...where))
    .orderBy(
      ...(sort === "top"
        ? [desc(score), desc(posts.createdAt), desc(posts.id)]
        : [desc(postHashtags.createdAt), desc(posts.id)]),
    )
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const muted = await mutedPhrasesFor(viewerId);
  const visibleRows = muted.length === 0
    ? pageRows
    : pageRows.filter((row) => !matchesMutedWords([row.caption ?? "", ...(row.hashtags ?? [])].join(" "), muted));

  const ids = visibleRows.map((row) => row.id);
  const [profiles, comments] = await Promise.all([
    profilesById(visibleRows.map((row) => row.userId)),
    visibleCommentCounts(ids),
  ]);

  const items = visibleRows.map((row) => {
    const author = profiles.get(row.userId);
    return {
      id: row.id,
      mediaType: row.mediaType,
      mediaUrl: row.mediaUrl,
      mediaUrls: row.mediaUrls,
      thumbnailUrl: row.thumbnailUrl,
      aspectRatio: row.aspectRatio,
      caption: row.caption,
      hashtags: row.hashtags,
      createdAt: row.createdAt,
      likesCount: row.visibility?.showLikeCount === false ? null : Number(row.likes ?? 0),
      commentsCount: comments.get(row.id) ?? 0,
      author: author
        ? { userId: author.userId, name: author.name, handle: author.handle, avatarUrl: author.avatarUrl, accountType: author.accountType }
        : { userId: row.userId, name: "Brandthread member", handle: "", avatarUrl: null, accountType: null },
    };
  });

  const last = pageRows[pageRows.length - 1];
  const nextCursor = !hasMore || !last
    ? null
    : sort === "top"
      ? encodeCursor(`o${offset + limit}`)
      : encodeCursor(`${last.indexedAt.toISOString()}|${last.id}`);
  return { items, nextCursor };
}

// ─── Trending ─────────────────────────────────────────────────────────────────

interface TrendingTag {
  tag: string;
  rank: number;
  postCount: number;
  recentPostCount: number;
  score: number;
}

let trendingCache: { at: number; tags: TrendingTag[] } | null = null;

/** Test/ops hook: drop the cached trending list. */
export function clearTrendingCache() {
  trendingCache = null;
}

/**
 * Score = (3 × posts in the last 72h + engagement on those posts) × velocity
 * factor, where velocity compares the last 72h to the 72h before it. A tag needs
 * at least TRENDING_MIN_POSTS recent posts from TRENDING_MIN_AUTHORS distinct
 * authors, so one account cannot trend a tag alone.
 */
export async function computeTrending(now = new Date()): Promise<TrendingTag[]> {
  const windowMs = TRENDING_WINDOW_HOURS * 3_600_000;
  const cutoff = new Date(now.getTime() - windowMs);
  const prevCutoff = new Date(now.getTime() - 2 * windowMs);
  const postedAt = sql`coalesce(${posts.publishedAt}, ${posts.createdAt})`;
  const score = engagementScore();

  const rows = await db
    .select({
      tag: postHashtags.tag,
      cur: sql<number>`count(DISTINCT ${posts.id}) FILTER (WHERE ${postedAt} >= ${cutoff})::int`,
      prev: sql<number>`count(DISTINCT ${posts.id}) FILTER (WHERE ${postedAt} < ${cutoff})::int`,
      authors: sql<number>`count(DISTINCT ${posts.userId}) FILTER (WHERE ${postedAt} >= ${cutoff})::int`,
      engagement: sql<number>`coalesce(sum(${score}) FILTER (WHERE ${postedAt} >= ${cutoff}), 0)::int`,
    })
    .from(postHashtags)
    .innerJoin(posts, eq(posts.id, postHashtags.postId))
    .where(and(publicPostCondition(now), sql`${postedAt} >= ${prevCutoff}`))
    .groupBy(postHashtags.tag)
    .having(sql`count(DISTINCT ${posts.id}) FILTER (WHERE ${postedAt} >= ${cutoff}) >= ${TRENDING_MIN_POSTS}
      AND count(DISTINCT ${posts.userId}) FILTER (WHERE ${postedAt} >= ${cutoff}) >= ${TRENDING_MIN_AUTHORS}`)
    .orderBy(desc(sql`count(DISTINCT ${posts.id}) FILTER (WHERE ${postedAt} >= ${cutoff})`))
    .limit(120);

  const ranked = rows
    .filter((row) => isTagAllowedPublicly(row.tag))
    .map((row) => {
      const velocity = (row.cur + 1) / (row.prev + 1);
      const factor = Math.min(1.5, Math.max(0.5, 1 + 0.25 * Math.log(velocity)));
      return { tag: row.tag, recent: row.cur, value: (3 * row.cur + row.engagement) * factor };
    })
    .sort((a, b) => b.value - a.value || a.tag.localeCompare(b.tag))
    .slice(0, TRENDING_MAX);
  if (ranked.length === 0) return [];

  const totals = await db
    .select({ tag: postHashtags.tag, n: sql<number>`count(*)::int` })
    .from(postHashtags)
    .innerJoin(posts, eq(posts.id, postHashtags.postId))
    .where(and(publicPostCondition(now), sql`${postHashtags.tag} IN (${sql.join(ranked.map((r) => sql`${r.tag}`), sql`, `)})`))
    .groupBy(postHashtags.tag);
  const totalByTag = new Map(totals.map((row) => [row.tag, Number(row.n)]));

  return ranked.map((row, index) => ({
    tag: row.tag,
    rank: index + 1,
    postCount: totalByTag.get(row.tag) ?? row.recent,
    recentPostCount: row.recent,
    score: Math.round(row.value * 100) / 100,
  }));
}

router.get("/trending", rateLimit("public-read"), async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 10, TRENDING_MAX);
    if (!trendingCache || Date.now() - trendingCache.at > TRENDING_TTL_MS) {
      trendingCache = { at: Date.now(), tags: await computeTrending() };
    }
    const muted = await mutedPhrasesFor(optionalViewerId(req));
    const tags = trendingCache.tags
      .filter((row) => muted.length === 0 || !matchesMutedWords(row.tag, muted))
      .slice(0, limit);
    res.set("Cache-Control", "public, max-age=60");
    return res.json({ tags });
  } catch (err) {
    req.log.error({ err }, "Trending hashtags failed");
    return res.status(500).json({ error: "Could not load trending hashtags" });
  }
});

// ─── Search ───────────────────────────────────────────────────────────────────

router.get("/search", rateLimit("public-read"), async (req, res) => {
  try {
    const q = normalizeHashtag(firstString(req.query.q) ?? "");
    if (!q) return res.json({ tags: [] });
    const limit = parseLimit(req.query.limit, 12, 25);
    const viewerId = optionalViewerId(req);
    const rows = await db
      .select({ tag: postHashtags.tag, n: sql<number>`count(DISTINCT ${posts.id})::int` })
      .from(postHashtags)
      .innerJoin(posts, eq(posts.id, postHashtags.postId))
      .where(and(
        sql`${postHashtags.tag} LIKE ${q.replace(/[\\%_]/g, "\\$&") + "%"}`,
        publicPostCondition(),
        notBlockedWith(viewerId, posts.userId),
      ))
      .groupBy(postHashtags.tag)
      .orderBy(desc(sql`count(DISTINCT ${posts.id})`), postHashtags.tag)
      .limit(limit * 2);
    const muted = await mutedPhrasesFor(viewerId);
    const tags = rows
      .filter((row) => isTagAllowedPublicly(row.tag) && (muted.length === 0 || !matchesMutedWords(row.tag, muted)))
      .slice(0, limit)
      .map((row) => ({ tag: row.tag, postCount: Number(row.n) }));
    return res.json({ tags });
  } catch (err) {
    req.log.error({ err }, "Hashtag search failed");
    return res.status(500).json({ error: "Could not search hashtags" });
  }
});

// ─── Following ────────────────────────────────────────────────────────────────

router.get("/following", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  try {
    const follows = await db
      .select({ tag: hashtagFollows.tag, followedAt: hashtagFollows.createdAt })
      .from(hashtagFollows)
      .where(eq(hashtagFollows.userId, userId))
      .orderBy(desc(hashtagFollows.createdAt))
      .limit(MAX_FOLLOWED_TAGS);
    const tags = await Promise.all(
      follows
        .filter((row) => isTagAllowedPublicly(row.tag))
        .map(async (row) => ({ tag: row.tag, followedAt: row.followedAt, postCount: await tagPostCount(row.tag, userId) })),
    );
    return res.json({ tags });
  } catch (err) {
    req.log.error({ err, userId }, "Followed hashtags failed");
    return res.status(500).json({ error: "Could not load followed hashtags" });
  }
});

router.post("/:tag/follow", requireAuth, rateLimit("follow"), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const tag = tagParam(req.params.tag);
  if (!tag) return res.status(404).json({ error: "Hashtag not found" });
  try {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(hashtagFollows)
      .where(eq(hashtagFollows.userId, userId));
    if (Number(n) >= MAX_FOLLOWED_TAGS) {
      return res.status(409).json({ error: `You can follow up to ${MAX_FOLLOWED_TAGS} hashtags.`, code: "HASHTAG_FOLLOW_LIMIT" });
    }
    await db.insert(hashtagFollows).values({ userId, tag }).onConflictDoNothing();
    return res.json({ tag, isFollowing: true });
  } catch (err) {
    req.log.error({ err, userId, tag }, "Follow hashtag failed");
    return res.status(500).json({ error: "Could not follow hashtag" });
  }
});

router.delete("/:tag/follow", requireAuth, rateLimit("follow"), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const tag = normalizeHashtag(req.params.tag);
  if (!tag) return res.status(404).json({ error: "Hashtag not found" });
  try {
    await db.delete(hashtagFollows).where(and(eq(hashtagFollows.userId, userId), eq(hashtagFollows.tag, tag)));
    return res.json({ tag, isFollowing: false });
  } catch (err) {
    req.log.error({ err, userId, tag }, "Unfollow hashtag failed");
    return res.status(500).json({ error: "Could not unfollow hashtag" });
  }
});

// ─── Tag page ─────────────────────────────────────────────────────────────────

router.get("/:tag/posts", rateLimit("public-read"), async (req, res) => {
  const tag = tagParam(req.params.tag);
  if (!tag) return res.status(404).json({ error: "Hashtag not found" });
  try {
    const sort: SortMode = firstString(req.query.sort) === "recent" ? "recent" : "top";
    const limit = parseLimit(req.query.limit, PAGE_DEFAULT, PAGE_MAX);
    const page = await postsForTag(tag, sort, firstString(req.query.cursor), limit, optionalViewerId(req));
    return res.json({ tag, sort, ...page });
  } catch (err) {
    req.log.error({ err, tag }, "Hashtag posts failed");
    return res.status(500).json({ error: "Could not load hashtag posts" });
  }
});

router.get("/:tag", rateLimit("public-read"), async (req, res) => {
  const tag = tagParam(req.params.tag);
  if (!tag) return res.status(404).json({ error: "Hashtag not found" });
  try {
    const viewerId = optionalViewerId(req);
    const sort: SortMode = firstString(req.query.sort) === "recent" ? "recent" : "top";
    const limit = parseLimit(req.query.limit, PAGE_DEFAULT, PAGE_MAX);
    const [postCount, page, followerRow, myFollow] = await Promise.all([
      tagPostCount(tag, viewerId),
      postsForTag(tag, sort, null, limit, viewerId),
      db.select({ n: sql<number>`count(*)::int` }).from(hashtagFollows).where(eq(hashtagFollows.tag, tag)),
      viewerId
        ? db.select({ tag: hashtagFollows.tag }).from(hashtagFollows)
            .where(and(eq(hashtagFollows.userId, viewerId), eq(hashtagFollows.tag, tag))).limit(1)
        : Promise.resolve([]),
    ]);
    return res.json({
      tag,
      postCount,
      followerCount: Number(followerRow[0]?.n ?? 0),
      isFollowing: myFollow.length > 0,
      sort,
      posts: page,
    });
  } catch (err) {
    req.log.error({ err, tag }, "Hashtag page failed");
    return res.status(500).json({ error: "Could not load hashtag" });
  }
});

export default router;
