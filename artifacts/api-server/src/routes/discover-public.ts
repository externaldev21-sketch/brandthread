/**
 * GET /api/public/discover?cursor=&limit=&kind=forYou|fits
 *
 * The buyer Discover grid's one data source. Replaces composing the grid from
 * /api/public/trending, which (a) carried no image field at all, so every tile
 * rendered as an empty dark card, and (b) rejected limit > 50, so the
 * client's "grow the limit" paging 400'd on the second page and the grid was
 * replaced by the empty state.
 *
 * Contract:
 *  - Keyset-paged by (created_at, id). `nextCursor` is null ONLY at the real
 *    end of the data; a page never wraps back to the start.
 *  - First page leads with today's ranked (trending) posts, then fills with
 *    recent public posts from everyone (sellers, buyers, @brandthread) so a
 *    thin ranking never yields an empty grid. Later pages are recent posts,
 *    minus the ranked posts page one led with (each post shows exactly once).
 *  - Every item carries `imageUrl`: the post/video poster, the first carousel
 *    slide, or the photo itself. Posts with no still are left out (and a few
 *    missing video posters are generated in the background per request, see
 *    lib/videoPoster.ts) so a tile is never blank.
 *  - `limit` is clamped to 1..50, never rejected.
 */
import { Router } from "express";
import { and, desc, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import { db, posts, trendingCache, users } from "@workspace/db";
import { matchesMutedWords } from "../lib/contentModerator";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { setPublicCacheHeaders, setViewerScopedCacheHeaders } from "../lib/httpCache";
import { publicPostCondition, visibleCommentCounts } from "../lib/postVisibility";
import { mutedPhrasesFor, notBlockedWith, optionalViewerId, profilesById } from "../lib/safety";
import { ensureVideoPoster, mediaOrigin } from "../lib/videoPoster";

const router = Router();

export const DISCOVER_PAGE_DEFAULT = 24;
export const DISCOVER_PAGE_MAX = 50;
/** Missing video posters kicked off per request (best-effort self-heal). */
const POSTER_HEAL_PER_REQUEST = 3;

type Slide = { kind: "photo" | "video"; url: string; thumbnailUrl: string };

/** The still a grid tile shows for a post, or null when it has none. */
export function tileImage(row: {
  mediaType: string;
  mediaUrl: string;
  mediaUrls: string[] | null;
  thumbnailUrl: string | null;
  slides: Slide[] | null;
}): string | null {
  if (row.thumbnailUrl) return row.thumbnailUrl;
  const first = Array.isArray(row.slides) ? row.slides[0] : undefined;
  if (first) return (first.kind === "video" ? first.thumbnailUrl : first.url) || null;
  if (row.mediaType === "video") return null;
  return (Array.isArray(row.mediaUrls) ? row.mediaUrls.find(Boolean) : undefined) || row.mediaUrl || null;
}

const hasStill = sql<boolean>`(
  coalesce(${posts.thumbnailUrl}, '') <> ''
  OR jsonb_array_length(coalesce(${posts.slides}, '[]'::jsonb)) > 0
  OR (${posts.mediaType} <> 'video' AND coalesce(${posts.mediaUrl}, '') <> '')
)`;

function selection() {
  return {
    id: posts.id,
    userId: posts.userId,
    mediaType: posts.mediaType,
    mediaUrl: posts.mediaUrl,
    mediaUrls: posts.mediaUrls,
    thumbnailUrl: posts.thumbnailUrl,
    slides: posts.slides,
    aspectRatio: posts.aspectRatio,
    caption: posts.caption,
    hashtags: posts.hashtags,
    visibility: posts.visibility,
    createdAt: posts.createdAt,
    createdAtText: sql<string>`${posts.createdAt}::text`,
    // Qualified by hand: in a single-table select drizzle renders posts.id as
    // a bare "id", which would bind to i.id inside the subquery.
    likes: sql<number>`(SELECT count(*)::int FROM interactions i WHERE i.post_id = "posts"."id" AND i.type = 'like')`,
    views: sql<number>`(SELECT count(*)::int FROM interactions i WHERE i.post_id = "posts"."id" AND i.type = 'view')`,
  };
}

async function rankedIdsForToday(): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);
  const [row] = await db
    .select({ results: trendingCache.results })
    .from(trendingCache)
    .where(eq(trendingCache.cacheDate, today))
    .limit(1);
  const results = Array.isArray(row?.results) ? row.results : [];
  return results.map((r: any) => r?.id).filter((id: unknown): id is string => typeof id === "string");
}

function parseLimit(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return DISCOVER_PAGE_DEFAULT;
  return Math.min(n, DISCOVER_PAGE_MAX);
}

router.get("/", async (req, res) => {
  try {
    const viewerId = optionalViewerId(req);
    if (viewerId) setViewerScopedCacheHeaders(res, viewerId);
    else setPublicCacheHeaders(res, { maxAgeSeconds: 30, staleWhileRevalidateSeconds: 120 });

    const limit = parseLimit(req.query.limit);
    const kind = req.query.kind === "fits" ? "fits" : "forYou";
    const cursorRaw = typeof req.query.cursor === "string" && req.query.cursor ? req.query.cursor : null;
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
    // A cursor we did not produce is a client bug, not "start over" — the
    // grid would silently restart from page one and look like a reset.
    if (cursorRaw && !cursor) return res.status(400).json({ error: "Invalid cursor", code: "VALIDATION_ERROR" });

    const base: Array<SQL | undefined> = [publicPostCondition(new Date(), viewerId), notBlockedWith(viewerId, posts.userId), hasStill];
    if (kind === "fits") {
      // "posts"."user_id" spelled out: drizzle renders a bare "user_id" in a
      // single-table select, which inside this subquery must not bind to u.
      base.push(sql`EXISTS (SELECT 1 FROM ${users} u WHERE u.clerk_id = "posts"."user_id" AND u.account_type = 'buyer')`);
    }

    const rankedIds = kind === "forYou" ? await rankedIdsForToday() : [];

    // ── Ranked lead ─────────────────────────────────────────────────────────
    // The top `limit / 2` eligible ranked posts lead page one. Every page
    // recomputes that same set (deterministic for a given day, viewer and
    // limit) so later pages exclude exactly what page one showed — ranked
    // posts beyond the lead still appear later, in recency order.
    let leadRanked: Array<Awaited<ReturnType<typeof queryRows>>[number]> = [];
    const cap = Math.floor(limit / 2);
    if (rankedIds.length > 0 && cap > 0) {
      const rows = await queryRows(and(...base, inArray(posts.id, rankedIds.slice(0, 100)))!, 100);
      const order = new Map(rankedIds.map((id, i) => [id, i]));
      leadRanked = rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).slice(0, cap);
    }
    const ranked = cursor ? [] : leadRanked;

    // ── Recent fill / later pages ──────────────────────────────────────────
    const recentWhere: Array<SQL | undefined> = [...base];
    if (leadRanked.length > 0) recentWhere.push(notInArray(posts.id, leadRanked.map((r) => r.id)));
    if (cursor) recentWhere.push(sql`(${posts.createdAt}, ${posts.id}) < (${cursor.ts}::timestamp, ${cursor.id}::uuid)`);
    const want = limit - ranked.length;
    const recentRows = await queryRows(and(...recentWhere)!, want + 1);
    const hasMore = recentRows.length > want;
    const recent = hasMore ? recentRows.slice(0, want) : recentRows;
    const lastRecent = recent[recent.length - 1];
    const nextCursor = hasMore && lastRecent ? encodeCursor({ ts: lastRecent.createdAtText, id: lastRecent.id }) : null;

    const pageRows = [...ranked.map((r) => ({ ...r, ranked: true })), ...recent.map((r) => ({ ...r, ranked: false }))];
    const muted = await mutedPhrasesFor(viewerId);
    const visible = muted.length === 0
      ? pageRows
      : pageRows.filter((row) => !matchesMutedWords([row.caption ?? "", ...(row.hashtags ?? [])].join(" "), muted));

    const [profiles, comments] = await Promise.all([
      profilesById(visible.map((row) => row.userId)),
      visibleCommentCounts(visible.map((row) => row.id)),
    ]);

    const items = visible.flatMap((row) => {
      const imageUrl = tileImage(row as any);
      if (!imageUrl) return [];
      const author = profiles.get(row.userId);
      const showLikes = row.visibility?.showLikeCount !== false;
      return [{
        id: row.id,
        mediaType: row.mediaType,
        imageUrl,
        mediaUrl: row.mediaUrl,
        aspectRatio: row.aspectRatio,
        caption: row.caption,
        createdAt: row.createdAt,
        likesCount: showLikes ? Number(row.likes ?? 0) : null,
        viewsCount: Number(row.views ?? 0),
        commentsCount: comments.get(row.id) ?? 0,
        ranked: row.ranked,
        author: author
          ? { userId: author.userId, name: author.name, handle: author.handle, avatarUrl: author.avatarUrl, accountType: author.accountType }
          : { userId: row.userId, name: "Brandthread member", handle: "", avatarUrl: null, accountType: null },
      }];
    });

    void healMissingPosters(`${req.protocol}://${req.get("host")}`, req.log);
    return res.json({ items, nextCursor });
  } catch (err) {
    req.log.error({ err }, "Failed to load public discover page");
    return res.status(500).json({ error: "Failed to load discover" });
  }
});

function queryRows(where: SQL, limit: number) {
  return db
    .select(selection())
    .from(posts)
    .where(where)
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit);
}

let lastHealAt = 0;
/** Kicks off poster generation for a few recent public videos that lack one. */
async function healMissingPosters(origin: string, log: { warn: (o: object, m: string) => void }): Promise<void> {
  const now = Date.now();
  if (now - lastHealAt < 60_000) return;
  lastHealAt = now;
  try {
    const rows = await db
      .select({ id: posts.id, userId: posts.userId, mediaType: posts.mediaType, mediaUrl: posts.mediaUrl, thumbnailUrl: posts.thumbnailUrl })
      .from(posts)
      .where(and(
        publicPostCondition(),
        eq(posts.mediaType, "video"),
        sql`coalesce(${posts.thumbnailUrl}, '') = ''`,
        sql`jsonb_array_length(coalesce(${posts.slides}, '[]'::jsonb)) = 0`,
      ))
      .orderBy(desc(posts.createdAt))
      .limit(POSTER_HEAL_PER_REQUEST);
    for (const row of rows) {
      // Same origin the API itself uses for /api/posts/media URLs (post-video.ts mediaUrl()).
      void ensureVideoPoster(row, { origin: mediaOrigin(row.mediaUrl) ?? origin });
    }
  } catch (err) {
    log.warn({ err }, "discover: poster self-heal skipped");
  }
}

export default router;
