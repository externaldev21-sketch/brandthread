/**
 * GET /api/public/search/all — one search across products, brands, people and
 * posts (TikTok-style: a "Top" overview, then one paginated list per type).
 *
 *   ?q=            query (2+ chars; may be empty when `style` is set — then
 *                  only products are returned, newest first)
 *   ?type=         top (default) | products | brands | people | posts
 *   ?style=        category chip key (lib/searchRanking.ts SEARCH_STYLE_KEYS
 *                  or "accessories") — filters products only
 *   ?size=&color=&category=&brand=&inStock=&minPriceCents=&maxPriceCents=&sort=
 *                  the filter sheet's product filters, same semantics as
 *                  GET /api/public/search (sort: relevance | price_asc |
 *                  price_desc | newest) — products only
 *   ?limit=&offset= per-type paging (ignored for type=top, which returns a
 *                  short fixed slice of every type)
 *
 * Ranking is tiered (exact > prefix > word > contains > fuzzy — see
 * lib/searchRanking.ts), then popularity, then trigram similarity, then a
 * stable id so offset paging never repeats or skips a row. Matching uses the
 * existing pg_trgm GIN indexes (migrations 037/112) plus the description and
 * all-media caption indexes added in migration 261.
 *
 * Read-only and unauthenticated; a signed-in viewer only changes block
 * filtering, private-account visibility and the people `isFollowing` flag.
 * Mounted on the /api/public prefix ahead of the public router.
 */
import { Router } from "express";
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db, readDb, follows, posts, products, users } from "@workspace/db";
import { containsSearchPattern, normalizeSearchTerm } from "../lib/search";
import { parseSearchFilters, type ParsedSearchFilters } from "../lib/searchFilters";
import { notBlockedWith, optionalViewerId } from "../lib/safety";
import { publicPostCondition } from "../lib/postVisibility";
import { CATEGORY_DEFS } from "../lib/categoryTaxonomy";
import { avatarColor } from "../lib/activityEvents";
import {
  escapeRegex, isSearchChipKey, matchTierSql, orderSections, rankScore, secondaryTierSql,
  styleTagSpellings, type SearchChipKey, type SectionKey, type Tier,
} from "../lib/searchRanking";

const router = Router();

export const SEARCH_TYPES = ["top", "products", "brands", "people", "posts"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** Slice sizes for the "Top" overview. */
export const TOP_LIMITS: Record<SectionKey, number> = { products: 6, brands: 3, people: 3, posts: 6 };
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SIMILARITY_THRESHOLD = 0.25;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Same trick as routes/public.ts: pin `%` to 0.25 so it can use the GIN trigram indexes. */
async function withTrigramThreshold<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return readDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('pg_trgm.similarity_threshold', ${String(SIMILARITY_THRESHOLD)}, true)`);
    return fn(tx);
  });
}

function textMatch(column: unknown, term: string, pattern: string): SQL {
  return sql`(${column} ILIKE ${pattern} OR ${column} % ${term})`;
}

const mkInitials = (name: string) =>
  name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
const mkHandle = (username: string | null, name: string) =>
  username ? `@${username}` : `@${name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20)}`;
const firstImage = (images: unknown): string | null =>
  Array.isArray(images) ? (images.find((i): i is string => typeof i === "string") ?? null) : null;
const publicAvatar = (profileImageUrl: string | null, avatarUrl: string | null) =>
  (typeof profileImageUrl === "string" && profileImageUrl.startsWith("http") ? profileImageUrl : avatarUrl) ?? null;

/** Product filter for one category chip. */
export function chipCondition(chip: SearchChipKey): SQL {
  if (chip === "accessories") {
    const def = CATEGORY_DEFS.find((d) => d.slug === "accessories")!;
    const re = `(^|[^[:alnum:]])(${def.keywords.map(escapeRegex).join("|")})(s|es)?([^[:alnum:]]|$)`;
    return sql`(lower(${products.category}) ~ ${re} OR lower(${products.name}) ~ ${re}
      OR EXISTS (SELECT 1 FROM json_array_elements_text(${products.tags}) t WHERE lower(t) ~ ${re}))`;
  }
  const spellings = styleTagSpellings(chip);
  const list = sql.join(spellings.map((s) => sql`${s}`), sql`, `);
  return sql`(${products.styleTags} ? ${chip}
    OR EXISTS (SELECT 1 FROM json_array_elements_text(${products.tags}) t WHERE lower(t) IN (${list})))`;
}

const sellerInGoodStanding = sql`NOT EXISTS (SELECT 1 FROM users su WHERE su.clerk_id = ${products.ownerId}
  AND (su.suspended_at IS NOT NULL OR su.deleted_at IS NOT NULL))`;

export const PRODUCT_SORTS = ["relevance", "price_asc", "price_desc", "newest"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];
export type ProductFilters = ParsedSearchFilters & { minPriceCents?: number; maxPriceCents?: number; sort: ProductSort };
const NO_FILTERS: ProductFilters = { categories: [], sizes: [], colors: [], brands: [], inStock: false, sort: "relevance" };

// Correlated subqueries spell the outer column out in full: drizzle renders
// select-list columns unqualified ("id"), which inside the subquery would bind
// to the inner table's own column (pv.id) instead of the product's.
const minPriceSql = sql<number | null>`(SELECT min(pv.price_cents) FROM product_variants pv WHERE pv.product_id = "products"."id")`;

/** The filter sheet's conditions — mirrors GET /api/public/search (values OR'd within a facet, facets AND'd). */
function productFilterConditions(f: ProductFilters): Array<SQL | undefined> {
  const lowerList = (vals: string[]) => sql.join(vals.map((v) => sql`${v.toLowerCase()}`), sql`, `);
  const variantConds = [
    f.sizes.length ? sql`lower(pv.size) IN (${lowerList(f.sizes)})` : undefined,
    f.colors.length ? sql`lower(pv.color) IN (${lowerList(f.colors)})` : undefined,
    f.inStock ? sql`pv.stock > 0` : undefined,
  ].filter((c): c is SQL => c !== undefined);
  return [
    variantConds.length
      ? sql`EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = ${products.id} AND ${sql.join(variantConds, sql` AND `)})`
      : undefined,
    f.brands.length
      ? sql`EXISTS (SELECT 1 FROM users bu WHERE bu.clerk_id = ${products.ownerId}
          AND (${sql.join(f.brands.map((b) => sql`(bu.clerk_id = ${b} OR bu.brand_name ILIKE ${containsSearchPattern(b)})`), sql` OR `)}))`
      : undefined,
    f.categories.length ? inArray(products.category, f.categories) : undefined,
    f.minPriceCents === undefined ? undefined : sql`${minPriceSql} >= ${f.minPriceCents}`,
    f.maxPriceCents === undefined ? undefined : sql`${minPriceSql} <= ${f.maxPriceCents}`,
  ];
}

async function searchProducts(tx: Tx, o: { term: string; pattern: string; chip: SearchChipKey | null; filters?: ProductFilters; viewerId: string | null; limit: number; offset: number }) {
  const hasTerm = o.term.length > 0;
  const f = o.filters ?? NO_FILTERS;
  const tier = hasTerm
    ? sql<number>`LEAST(${matchTierSql(products.name, o.term)}, ${secondaryTierSql(products.description, o.term)})`
    : sql<number>`0::int`;
  const sim = hasTerm ? sql<number>`similarity(${products.name}, ${o.term})` : sql<number>`0::real`;
  const rows = await tx.select({
    id: products.id, name: products.name, ownerId: products.ownerId, category: products.category,
    images: products.images, createdAt: products.createdAt,
    priceCents: minPriceSql,
    brandName: sql<string | null>`(SELECT COALESCE(bu.brand_name, bu.display_name) FROM users bu WHERE bu.clerk_id = "products"."owner_id")`,
    tier, sim,
  }).from(products).where(and(
    eq(products.status, "active"), isNull(products.deletedAt),
    hasTerm ? or(textMatch(products.name, o.term, o.pattern), ilike(products.description, o.pattern)) : undefined,
    o.chip ? chipCondition(o.chip) : undefined,
    ...productFilterConditions(f),
    notBlockedWith(o.viewerId, products.ownerId),
    sellerInGoodStanding,
  )).orderBy(...(
    f.sort === "price_asc" ? [sql`${minPriceSql} ASC NULLS LAST`]
    : f.sort === "price_desc" ? [sql`${minPriceSql} DESC NULLS LAST`]
    : f.sort === "newest" ? []
    : hasTerm ? [asc(tier), desc(sim)] : []
  ), desc(products.createdAt), asc(products.id))
    .limit(o.limit + 1).offset(o.offset);

  return rows.map((p) => {
    const brand = p.brandName ?? "Brand";
    const priceCents = Number(p.priceCents ?? 0);
    return {
      id: p.id, kind: "product" as const, productId: p.id, sellerId: p.ownerId,
      name: p.name, brand, priceCents, price: `$${Math.round(priceCents / 100)}`,
      category: p.category, imageUri: firstImage(p.images),
      color: avatarColor(p.ownerId), initials: mkInitials(brand),
      tier: Number(p.tier) as Tier, score: rankScore(Number(p.tier) as Tier, Number(p.sim)),
    };
  });
}

const followerCountSql = sql<number>`(SELECT COUNT(*)::int FROM follows f WHERE f.following_id = "users"."clerk_id")`;
const accountIsListed = and(
  eq(users.isSystemAccount, false), isNull(users.suspendedAt),
  isNull(users.deletedAt), isNull(users.deletionRequestedAt),
);

async function searchBrands(tx: Tx, o: { term: string; pattern: string; viewerId: string | null; limit: number; offset: number }) {
  const nameCol = sql`COALESCE(${users.brandName}, ${users.displayName}, ${users.username}, '')`;
  const tier = sql<number>`LEAST(${matchTierSql(users.brandName, o.term)}, ${matchTierSql(users.displayName, o.term)}, ${matchTierSql(users.username, o.term)})`;
  const sim = sql<number>`similarity(${nameCol}, ${o.term})`;
  const rows = await tx.select({
    clerkId: users.clerkId, brandName: users.brandName, displayName: users.displayName, username: users.username,
    profileImageUrl: users.profileImageUrl, avatarUrl: users.avatarUrl, verified: users.verified,
    followerCount: followerCountSql,
    productCount: sql<number>`(SELECT COUNT(*)::int FROM products bp WHERE bp.owner_id = "users"."clerk_id" AND bp.status = 'active' AND bp.deleted_at IS NULL)`,
    tier, sim,
  }).from(users).where(and(
    inArray(users.accountType, ["seller", "both"]), accountIsListed,
    notBlockedWith(o.viewerId, users.clerkId),
    or(textMatch(users.brandName, o.term, o.pattern), textMatch(users.displayName, o.term, o.pattern), textMatch(users.username, o.term, o.pattern)),
  )).orderBy(asc(tier), desc(users.verified), desc(followerCountSql), desc(sim), asc(users.clerkId))
    .limit(o.limit + 1).offset(o.offset);

  return rows.map((b) => {
    const name = b.brandName ?? b.displayName ?? b.username ?? "Brand";
    return {
      id: b.clerkId, kind: "brand" as const, sellerId: b.clerkId, name,
      handle: mkHandle(b.username, name), color: avatarColor(b.clerkId), initials: mkInitials(name),
      avatarUrl: publicAvatar(b.profileImageUrl, b.avatarUrl), verified: b.verified,
      followerCount: Number(b.followerCount), productCount: Number(b.productCount),
      tier: Number(b.tier) as Tier, score: rankScore(Number(b.tier) as Tier, Number(b.sim), Number(b.followerCount)),
    };
  });
}

async function searchPeople(tx: Tx, o: { term: string; pattern: string; viewerId: string | null; limit: number; offset: number }) {
  const nameCol = sql`COALESCE(${users.displayName}, ${users.name}, ${users.username}, '')`;
  const tier = sql<number>`LEAST(${matchTierSql(users.displayName, o.term)}, ${matchTierSql(users.name, o.term)}, ${matchTierSql(users.username, o.term)})`;
  const sim = sql<number>`similarity(${nameCol}, ${o.term})`;
  const rows = await tx.select({
    clerkId: users.clerkId, name: users.name, displayName: users.displayName, username: users.username,
    bio: users.bio, accountType: users.accountType, verified: users.verified,
    profileImageUrl: users.profileImageUrl, avatarUrl: users.avatarUrl,
    followerCount: followerCountSql, tier, sim,
  }).from(users).where(and(
    inArray(users.accountType, ["buyer", "both"]), accountIsListed,
    o.viewerId ? ne(users.clerkId, o.viewerId) : undefined,
    notBlockedWith(o.viewerId, users.clerkId),
    or(textMatch(users.displayName, o.term, o.pattern), textMatch(users.name, o.term, o.pattern), textMatch(users.username, o.term, o.pattern)),
  )).orderBy(asc(tier), desc(users.verified), desc(followerCountSql), desc(sim), asc(users.clerkId))
    .limit(o.limit + 1).offset(o.offset);

  const ids = rows.map((r) => r.clerkId);
  const following = o.viewerId && ids.length
    ? new Set((await tx.select({ id: follows.followingId }).from(follows)
        .where(and(eq(follows.followerId, o.viewerId), inArray(follows.followingId, ids)))).map((r) => r.id))
    : new Set<string>();

  return rows.map((u) => {
    const name = u.displayName || u.name || u.username || "Member";
    return {
      id: u.clerkId, kind: "person" as const, userId: u.clerkId, name, username: u.username ?? null,
      handle: mkHandle(u.username, name), initials: mkInitials(name), color: avatarColor(u.clerkId),
      bio: u.bio ?? null, accountType: u.accountType, verified: u.verified, roleTag: "Buyer",
      avatarUrl: publicAvatar(u.profileImageUrl, u.avatarUrl), isFollowing: following.has(u.clerkId),
      followerCount: Number(u.followerCount),
      tier: Number(u.tier) as Tier, score: rankScore(Number(u.tier) as Tier, Number(u.sim), Number(u.followerCount)),
    };
  });
}

async function searchPosts(tx: Tx, o: { term: string; pattern: string; viewerId: string | null; limit: number; offset: number }) {
  const tier = matchTierSql(posts.caption, o.term);
  const likes = sql<number>`(SELECT COUNT(*)::int FROM interactions i WHERE i.post_id = "posts"."id" AND i.type = 'like')`;
  const rows = await tx.select({
    id: posts.id, caption: posts.caption, mediaType: posts.mediaType, mediaUrl: posts.mediaUrl,
    thumbnailUrl: posts.thumbnailUrl, authorId: posts.userId, createdAt: posts.createdAt,
    authorName: sql<string | null>`(SELECT COALESCE(au.brand_name, au.display_name, au.name) FROM users au WHERE au.clerk_id = "posts"."user_id")`,
    authorUsername: sql<string | null>`(SELECT au.username FROM users au WHERE au.clerk_id = "posts"."user_id")`,
    authorAvatar: sql<string | null>`(SELECT COALESCE(CASE WHEN au.profile_image_url LIKE 'http%' THEN au.profile_image_url END, au.avatar_url) FROM users au WHERE au.clerk_id = "posts"."user_id")`,
    likesCount: likes, tier,
  }).from(posts).where(and(
    publicPostCondition(new Date(), o.viewerId),
    notBlockedWith(o.viewerId, posts.userId),
    // Captions carry the post's #tags inline, so one indexed ILIKE covers both.
    ilike(posts.caption, o.pattern),
  )).orderBy(asc(tier), desc(likes), desc(posts.createdAt), asc(posts.id))
    .limit(o.limit + 1).offset(o.offset);

  return rows.map((p) => {
    const authorName = p.authorName ?? "Member";
    return {
      id: p.id, kind: "video" as const, postId: p.id, mediaType: p.mediaType, caption: p.caption,
      thumbnailUrl: p.thumbnailUrl ?? (p.mediaType === "video" ? null : p.mediaUrl),
      videoUrl: p.mediaUrl, authorId: p.authorId, authorName,
      authorHandle: mkHandle(p.authorUsername, authorName), authorAvatarUrl: p.authorAvatar,
      color: avatarColor(p.authorId), initials: mkInitials(authorName),
      likesCount: Number(p.likesCount), createdAt: p.createdAt,
      tier: Number(p.tier) as Tier, score: rankScore(Number(p.tier) as Tier, 0, Number(p.likesCount)),
    };
  });
}

type Ranked = { tier: Tier; score: number };
type Section = { items: Ranked[]; hasMore: boolean; nextOffset: number | null };

function section(rows: Ranked[], limit: number, offset: number): Section {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items, hasMore, nextOffset: hasMore ? offset + items.length : null };
}

function parseIntParam(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return Number(value);
}

router.get("/search/all", async (req, res): Promise<void> => {
  try {
    const rawQ = req.query.q ?? "";
    const rawType = req.query.type ?? "top";
    const rawStyle = req.query.style;
    if (typeof rawQ !== "string" || typeof rawType !== "string" || (rawStyle !== undefined && typeof rawStyle !== "string")) {
      res.status(400).json({ error: "Invalid search query values" }); return;
    }
    if (!(SEARCH_TYPES as readonly string[]).includes(rawType)) {
      res.status(400).json({ error: `type must be one of ${SEARCH_TYPES.join(", ")}` }); return;
    }
    const chip = rawStyle ? rawStyle.toLowerCase() : null;
    if (chip !== null && !isSearchChipKey(chip)) {
      res.status(400).json({ error: "Unknown style" }); return;
    }
    const limitParam = parseIntParam(req.query.limit, DEFAULT_LIMIT);
    const offset = parseIntParam(req.query.offset, 0);
    if (limitParam === null || offset === null || limitParam < 1) {
      res.status(400).json({ error: "limit and offset must be non-negative integers (limit ≥ 1)" }); return;
    }
    const limit = Math.min(limitParam, MAX_LIMIT);
    const parsedFilters = parseSearchFilters(req.query as Record<string, unknown>);
    const sortValue = req.query.sort ?? "relevance";
    const minPrice = parseIntParam(req.query.minPriceCents, -1);
    const maxPrice = parseIntParam(req.query.maxPriceCents, -1);
    if (!parsedFilters || typeof sortValue !== "string" || !(PRODUCT_SORTS as readonly string[]).includes(sortValue)
        || minPrice === null || maxPrice === null || (minPrice >= 0 && maxPrice >= 0 && minPrice > maxPrice)) {
      res.status(400).json({ error: "Invalid product filters" }); return;
    }
    const filters: ProductFilters = {
      ...parsedFilters, sort: sortValue as ProductSort,
      ...(minPrice >= 0 ? { minPriceCents: minPrice } : {}),
      ...(maxPrice >= 0 ? { maxPriceCents: maxPrice } : {}),
    };
    const type = rawType as SearchType;
    const term = normalizeSearchTerm(rawQ);
    const queryOk = term.length >= 2;
    const viewerId = optionalViewerId(req);
    const base = { query: term, type, style: chip };

    // A chip with no query browses that style's products.
    if (!queryOk) {
      if (!chip || (type !== "top" && type !== "products")) { res.json({ ...base, sections: {}, order: [] }); return; }
      const lim = type === "top" ? DEFAULT_LIMIT : limit;
      const off = type === "top" ? 0 : offset;
      const rows = await withTrigramThreshold((tx) => searchProducts(tx, { term: "", pattern: "", chip, filters, viewerId, limit: lim, offset: off }));
      const products = section(rows, lim, off);
      res.json({ ...base, sections: { products }, order: products.items.length ? ["products"] : [] });
      return;
    }

    const pattern = containsSearchPattern(term);
    const common = { term, pattern, viewerId };
    const run = (key: SectionKey, tx: Tx, lim: number, off: number): Promise<Ranked[]> => {
      if (key === "products") return searchProducts(tx, { ...common, chip, filters, limit: lim, offset: off });
      if (key === "brands") return searchBrands(tx, { ...common, limit: lim, offset: off });
      if (key === "people") return searchPeople(tx, { ...common, limit: lim, offset: off });
      return searchPosts(tx, { ...common, limit: lim, offset: off });
    };

    const sections = await withTrigramThreshold(async (tx) => {
      const out: Partial<Record<SectionKey, Section>> = {};
      if (type === "top") {
        // Sequential: one transaction holds one connection.
        for (const key of Object.keys(TOP_LIMITS) as SectionKey[]) {
          out[key] = section(await run(key, tx, TOP_LIMITS[key], 0), TOP_LIMITS[key], 0);
        }
      } else {
        out[type] = section(await run(type, tx, limit, offset), limit, offset);
      }
      return out;
    });

    res.json({ ...base, sections, order: orderSections(sections) });
  } catch (err) {
    req.log.error({ err }, "Unified search failed");
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
