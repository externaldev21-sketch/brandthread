/**
 * Places and location pages.
 *
 * GET  /api/places/search?q=&lat=&lng=   — autocomplete over existing places, plus Google
 *                                          Places suggestions when GOOGLE_PLACES_API_KEY is set
 * GET  /api/places/:id                   — place + public post count
 * GET  /api/places/:id/posts?sort=&cursor= — public posts at a place (block + muted-word filtering)
 * POST /api/places                       — find-or-create a place (auth)
 *
 * Reads join `posts` and apply publicPostCondition(), so drafts, archived/deleted,
 * held/removed and suspended-author posts never show.
 */
import { Router } from "express";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { db, places, posts } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { matchesMutedWords } from "../lib/contentModerator";
import {
  findOrCreatePlace, getPlace, isUuid, normalizePlaceName, parsePlaceInput, placesProviderEnabled,
  providerAutocomplete, type PlaceDto,
} from "../lib/places";
import { publicPostCondition, visibleCommentCounts } from "../lib/postVisibility";
import { mutedPhrasesFor, notBlockedWith, optionalViewerId, profilesById } from "../lib/safety";

const router = Router();
const PAGE_DEFAULT = 30;
const PAGE_MAX = 50;

type SortMode = "top" | "recent";

const first = (raw: unknown): string | null => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" ? v : null;
};
const parseLimit = (raw: unknown, fallback: number, max: number) => {
  const n = Number(first(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), max) : fallback;
};
const parseCoord = (raw: unknown, limit: number): number | null => {
  const s = first(raw);
  if (s === null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};
const encodeCursor = (v: string) => Buffer.from(v, "utf8").toString("base64url");
const decodeCursor = (raw: string | null) => {
  if (!raw) return null;
  try { return Buffer.from(raw, "base64url").toString("utf8"); } catch { return null; }
};

function publicCount(viewerId: string | null) {
  return sql<number>`(
    SELECT count(*)::int FROM posts
    WHERE posts.place_id = places.id AND ${publicPostCondition()}
      ${viewerId ? sql`AND ${notBlockedWith(viewerId, posts.userId)}` : sql``}
  )`;
}

async function placePostCount(placeId: string, viewerId: string | null): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(posts)
    .where(and(eq(posts.placeId, placeId), publicPostCondition(), notBlockedWith(viewerId, posts.userId)));
  return Number(row?.n ?? 0);
}

async function postsForPlace(placeId: string, sort: SortMode, cursorRaw: string | null, limit: number, viewerId: string | null) {
  const cursor = decodeCursor(cursorRaw);
  const score = sql<number>`(
    (SELECT count(*) FROM interactions i WHERE i.post_id = posts.id AND i.type = 'like')
    + 2 * (SELECT count(*) FROM interactions i WHERE i.post_id = posts.id AND i.type = 'repost')
    + 2 * (SELECT count(*) FROM post_comments c WHERE c.post_id = posts.id AND c.moderation_status = 'visible')
  )`;
  const where = [eq(posts.placeId, placeId), publicPostCondition(), notBlockedWith(viewerId, posts.userId)];
  let offset = 0;
  if (sort === "recent" && cursor) {
    const [ts, id] = cursor.split("|");
    const at = new Date(ts);
    if (!Number.isNaN(at.getTime()) && id) {
      where.push(or(lt(posts.createdAt, at), and(eq(posts.createdAt, at), lt(posts.id, id)))!);
    }
  } else if (sort === "top" && cursor?.startsWith("o")) {
    offset = Math.max(0, Math.min(Number(cursor.slice(1)) || 0, 1000));
  }
  const rows = await db
    .select({
      id: posts.id, userId: posts.userId, mediaType: posts.mediaType, mediaUrl: posts.mediaUrl,
      mediaUrls: posts.mediaUrls, thumbnailUrl: posts.thumbnailUrl, aspectRatio: posts.aspectRatio,
      caption: posts.caption, hashtags: posts.hashtags, visibility: posts.visibility, createdAt: posts.createdAt,
      likes: sql<number>`(SELECT count(*)::int FROM interactions i WHERE i.post_id = posts.id AND i.type = 'like')`,
    })
    .from(posts)
    .where(and(...where))
    .orderBy(...(sort === "top" ? [desc(score), desc(posts.createdAt), desc(posts.id)] : [desc(posts.createdAt), desc(posts.id)]))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const muted = await mutedPhrasesFor(viewerId);
  const visible = muted.length === 0
    ? pageRows
    : pageRows.filter((r) => !matchesMutedWords([r.caption ?? "", ...(r.hashtags ?? [])].join(" "), muted));
  const [profiles, comments] = await Promise.all([
    profilesById(visible.map((r) => r.userId)),
    visibleCommentCounts(visible.map((r) => r.id)),
  ]);
  const items = visible.map((r) => {
    const a = profiles.get(r.userId);
    return {
      id: r.id, mediaType: r.mediaType, mediaUrl: r.mediaUrl, mediaUrls: r.mediaUrls,
      thumbnailUrl: r.thumbnailUrl, aspectRatio: r.aspectRatio, caption: r.caption, hashtags: r.hashtags,
      createdAt: r.createdAt,
      likesCount: r.visibility?.showLikeCount === false ? null : Number(r.likes ?? 0),
      commentsCount: comments.get(r.id) ?? 0,
      author: a
        ? { userId: a.userId, name: a.name, handle: a.handle, avatarUrl: a.avatarUrl, accountType: a.accountType }
        : { userId: r.userId, name: "Brandthread member", handle: "", avatarUrl: null, accountType: null },
    };
  });
  const last = pageRows[pageRows.length - 1];
  const nextCursor = !hasMore || !last
    ? null
    : sort === "top" ? encodeCursor(`o${offset + limit}`) : encodeCursor(`${last.createdAt.toISOString()}|${last.id}`);
  return { items, nextCursor };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

interface SearchPlace extends Partial<PlaceDto> {
  name: string;
  source: "local" | "google";
  postCount: number;
  providerPlaceId?: string;
  secondary?: string | null;
}

router.get("/search", rateLimit("public-read"), async (req, res) => {
  try {
    const raw = (first(req.query.q) ?? "").trim().slice(0, 100);
    const q = normalizePlaceName(raw);
    if (!q) return res.json({ places: [], providerEnabled: placesProviderEnabled() });
    const lat = parseCoord(req.query.lat, 90);
    const lng = parseCoord(req.query.lng, 180);
    const viewerId = optionalViewerId(req);
    const like = escapeLike(q);
    const distance = lat !== null && lng !== null
      ? sql<number>`coalesce(abs(${places.lat}::float8 - ${lat}) + abs(${places.lng}::float8 - ${lng}), 1000)`
      : null;
    const count = publicCount(viewerId);
    const rows = await db
      .select({
        id: places.id, name: places.name, city: places.city, region: places.region, country: places.country,
        lat: places.lat, lng: places.lng, providerPlaceId: places.providerPlaceId, postCount: count,
      })
      .from(places)
      .where(or(sql`${places.normalizedName} LIKE ${like + "%"}`, sql`${places.normalizedName} LIKE ${"% " + like + "%"}`))
      .orderBy(...(distance ? [desc(count), distance, places.name] : [desc(count), places.name]))
      .limit(10);

    const results: SearchPlace[] = rows.map((r) => ({
      id: r.id, name: r.name, city: r.city, region: r.region, country: r.country,
      lat: r.lat === null ? null : Number(r.lat), lng: r.lng === null ? null : Number(r.lng),
      source: "local", postCount: Number(r.postCount),
    }));
    if (placesProviderEnabled()) {
      const known = new Set(rows.map((r) => r.providerPlaceId).filter(Boolean));
      const knownNames = new Set(results.map((r) => normalizePlaceName(r.name)));
      for (const s of await providerAutocomplete(raw, lat, lng)) {
        if (known.has(s.providerPlaceId) || knownNames.has(normalizePlaceName(s.name))) continue;
        results.push({
          id: undefined, name: s.name, source: "google", postCount: 0,
          providerPlaceId: s.providerPlaceId, secondary: s.secondary,
        });
      }
    }
    return res.json({ places: results.slice(0, 15), providerEnabled: placesProviderEnabled() });
  } catch (err) {
    req.log.error({ err }, "Place search failed");
    return res.status(500).json({ error: "Could not search places" });
  }
});

router.post("/", requireAuth, rateLimit("mutation"), async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const parsed = parsePlaceInput(req.body);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error, ...(parsed.code ? { code: parsed.code } : {}) });
  try {
    const { place, created } = await findOrCreatePlace(parsed.value, userId);
    return res.status(created ? 201 : 200).json({ place, created });
  } catch (err) {
    req.log.error({ err, userId }, "Create place failed");
    return res.status(500).json({ error: "Could not save place" });
  }
});

router.get("/:id/posts", rateLimit("public-read"), async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id) || !(await getPlace(id))) return res.status(404).json({ error: "Place not found" });
  try {
    const sort: SortMode = first(req.query.sort) === "recent" ? "recent" : "top";
    const page = await postsForPlace(id, sort, first(req.query.cursor), parseLimit(req.query.limit, PAGE_DEFAULT, PAGE_MAX), optionalViewerId(req));
    return res.json({ placeId: id, sort, ...page });
  } catch (err) {
    req.log.error({ err, placeId: id }, "Place posts failed");
    return res.status(500).json({ error: "Could not load place posts" });
  }
});

router.get("/:id", rateLimit("public-read"), async (req, res) => {
  const id = String(req.params.id);
  const place = isUuid(id) ? await getPlace(id) : null;
  if (!place) return res.status(404).json({ error: "Place not found" });
  try {
    const viewerId = optionalViewerId(req);
    const sort: SortMode = first(req.query.sort) === "recent" ? "recent" : "top";
    const [postCount, page] = await Promise.all([
      placePostCount(id, viewerId),
      postsForPlace(id, sort, null, parseLimit(req.query.limit, PAGE_DEFAULT, PAGE_MAX), viewerId),
    ]);
    return res.json({ place, postCount, sort, posts: page });
  } catch (err) {
    req.log.error({ err, placeId: id }, "Place page failed");
    return res.status(500).json({ error: "Could not load place" });
  }
});

export default router;
