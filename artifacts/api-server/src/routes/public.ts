/**
 * Public (unauthenticated) product browsing endpoints for buyers.
 * Mounted at /api/public — no requireAuth middleware.
 */
import { Router } from "express";
import { db, products, productVariants, users, drops, dropAlertSubscriptions, posts, postTaggedProducts, interactions, storefrontVisits, trendingCache, sellerRankingCache, boosts, orders, orderItems, follows, savedCollections, savedItems, searchLog } from "@workspace/db";
import { getAuth } from "@clerk/express";
import { effectiveDropLaunchAt } from "../lib/money/dropLaunch";
import { adaptSavedRows } from "../lib/savedItemAdapter";
import { fetchProductBadgeInfo } from "../lib/savedProductBadges";
import { eq, and, asc, desc, ne, inArray, notInArray, or, ilike, sql, count, gt, gte, lte, isNull, isNotNull } from "drizzle-orm";
import { computeTrendingForToday, isCacheFresh } from "../jobs/computeTrending";
import { computeSellerRankingForToday, isSellerRankingCacheFresh } from "../jobs/computeSellerRanking";
import { ObjectStorageService } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/requireAuth";
import { containsSearchPattern, normalizeSearchTerm } from "../lib/search";
import { getSellerVacationStatus } from "../lib/sellerAvailability";
import { deriveSellerVerified } from "../lib/sellerEligibility";
import { matchesMutedWords } from "../lib/contentModerator";
import { publicPostCondition, visibleCommentCounts } from "../lib/postVisibility";
import { isBlockedEitherWay, mutedPhrasesFor, notBlockedWith, optionalViewerId } from "../lib/safety";
import {
  paginationMetadata,
  parsePagination,
  setPaginationHeaders,
} from "../lib/pagination";
import { setPublicCacheHeaders } from "../lib/httpCache";

// ─── In-flight guard for synchronous cache-miss computation ──────────────────
// Prevents concurrent requests from each triggering an independent full
// scoring pipeline when the cache is empty (e.g. right after midnight UTC or
// a fresh deploy before the 2-min warm job fires).  All concurrent waiters
// share the same Promise and get the result once it resolves.
let trendingInflight: Promise<void> | null = null;

// Same pattern for the Discover seller-ranking cache — see computeSellerRanking.ts.
let sellerRankingInflight: Promise<void> | null = null;

const router = Router();
const objectStorage = new ObjectStorageService();

// ─── ID resolution helper ─────────────────────────────────────────────────────
// Accepts either users.clerkId (Clerk subject string) or users.id (UUID).
// Returns the canonical clerkId for use in all downstream queries, or null
// when the account does not exist, is tombstoned, or has no accountType.
// This is the ONLY place DB-UUID → clerkId resolution happens for public reads.
//
// UUID shape: 8-4-4-4-12 hex chars separated by hyphens.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveToClerkId(
  idOrClerkId: string,
  requiredAccountType?: "buyer" | "seller",
): Promise<string | null> {
  if (!idOrClerkId || typeof idOrClerkId !== "string") return null;

  const isUuid = UUID_PATTERN.test(idOrClerkId);
  const [user] = await db
    .select({
      clerkId:     users.clerkId,
      accountType: users.accountType,
      deletedAt:   users.deletedAt,
    })
    .from(users)
    .where(isUuid ? eq(users.id, idOrClerkId) : eq(users.clerkId, idOrClerkId))
    .limit(1);

  if (!user) return null;
  if (user.deletedAt) return null;
  if (requiredAccountType && user.accountType !== requiredAccountType) return null;
  return user.clerkId;
}

const SEARCH_SORTS = ["relevance", "price_asc", "price_desc", "newest"] as const;
type SearchSort = typeof SEARCH_SORTS[number];

function singleQueryValue(value: unknown): string | undefined | null {
  return value === undefined ? undefined : typeof value === "string" ? value : null;
}

function parseNonNegativeInteger(value: unknown, name: string, defaultValue?: number): number | { error: string } {
  const raw = singleQueryValue(value);
  if (raw === undefined && defaultValue !== undefined) return defaultValue;
  if (raw == null || !/^\d+$/.test(raw)) return { error: `${name} must be a nonnegative integer` };
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return { error: `${name} must be a nonnegative integer` };
  return parsed;
}

function productTags(product: { tags: unknown; styleTags: unknown }): Set<string> {
  const tags = [
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.styleTags) ? product.styleTags : []),
  ];
  return new Set(tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.toLowerCase()));
}

/** Stable, intentionally simple ranking for the public related-products shelf. */
export function rankRelatedProducts<T extends {
  id: string; ownerId: string; category: string; tags: unknown; styleTags: unknown; createdAt: Date;
}>(current: T, candidates: T[]): T[] {
  const currentTags = productTags(current);
  const overlap = (candidate: T) => [...productTags(candidate)].filter((tag) => currentTags.has(tag)).length;
  return [...candidates].sort((a, b) => {
    const sellerDifference = Number(b.ownerId === current.ownerId) - Number(a.ownerId === current.ownerId);
    if (sellerDifference) return sellerDifference;
    const categoryDifference = Number(b.category === current.category) - Number(a.category === current.category);
    if (categoryDifference) return categoryDifference;
    const overlapDifference = overlap(b) - overlap(a);
    if (overlapDifference) return overlapDifference;
    const newnessDifference = b.createdAt.getTime() - a.createdAt.getTime();
    return newnessDifference || a.id.localeCompare(b.id);
  });
}

// GET /api/public/products
// Optional query params: ?category=apparel&tag=streetwear&ownerId=user_xxx&limit=50&offset=0
router.get("/products", async (req, res) => {
  try {
    setPublicCacheHeaders(res);
    const category = singleQueryValue(req.query.category);
    const tag = singleQueryValue(req.query.tag);
    const ownerId = singleQueryValue(req.query.ownerId);
    const page = parsePagination(req.query, { limit: 50 });
    if (
      !page.success ||
      category === null ||
      tag === null ||
      ownerId === null ||
      (category?.length ?? 0) > 160 ||
      (tag?.length ?? 0) > 160 ||
      (ownerId?.length ?? 0) > 160
    ) {
      res.status(400).json({ error: "Invalid product list query", code: "VALIDATION_ERROR" });
      return;
    }
    const { limit: lim, offset: off } = page.data;
    // Profiles may only hold the users.id alias (e.g. from /u/:username) — the
    // shop list resolves it to the seller's Clerk ID like every public read.
    const resolvedOwnerId = ownerId && UUID_PATTERN.test(ownerId)
      ? await resolveToClerkId(ownerId, "seller")
      : ownerId;
    if (ownerId && !resolvedOwnerId) {
      setPaginationHeaders(res, page.data, 0, 0);
      res.json([]);
      return;
    }
    const whereClause = and(
      eq(products.status, "active"),
      isNull(products.deletedAt),
      resolvedOwnerId ? eq(products.ownerId, resolvedOwnerId) : undefined,
      category ? eq(products.category, category) : undefined,
      tag
        ? or(
          sql`${products.tags}::jsonb @> ${JSON.stringify([tag])}::jsonb`,
          sql`${products.styleTags}::jsonb @> ${JSON.stringify([tag])}::jsonb`,
        )
        : undefined,
    );

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(products)
        .where(whereClause)
        .orderBy(desc(products.createdAt), asc(products.id))
        .limit(lim)
        .offset(off),
      db.select({ total: count() }).from(products).where(whereClause),
    ]);
    const filtered = rows;
    setPaginationHeaders(res, page.data, rows.length, Number(total));

    if (filtered.length === 0) {
      res.json([]);
      return;
    }

    // Attach variants
    const productIds = filtered.map((p) => p.id);

    // Fire-and-forget: increment impressions_count for every active product boost
    // whose targetId appears in this page. Mirrors the same pattern used in the
    // authenticated post feed so product boosts report real delivery counts.
    {
      const now = new Date();
      db.select({ id: boosts.id })
        .from(boosts)
        .where(and(
          eq(boosts.targetType, "product"),
          eq(boosts.status, "active"),
          gte(boosts.endsAt, now),
          inArray(boosts.targetId, productIds),
        ))
        .then((activeBoostRows) => {
          if (activeBoostRows.length > 0) {
            db.update(boosts)
              .set({ impressionsCount: sql`${boosts.impressionsCount} + 1` })
              .where(inArray(boosts.id, activeBoostRows.map((b) => b.id)))
              .catch(() => {});
          }
        })
        .catch(() => {});
    }
    const variants = await db
      .select()
      .from(productVariants)
      .where(inArray(productVariants.productId, productIds));

    const variantsByProduct: Record<string, typeof variants> = {};
    for (const v of variants) {
      if (!variantsByProduct[v.productId]) variantsByProduct[v.productId] = [];
      variantsByProduct[v.productId].push(v);
    }

    // Attach seller display name (best-effort; null if seller row not found)
    const ownerIds = [...new Set(filtered.map((p) => p.ownerId))];
    const sellerRows = ownerIds.length > 0
      ? await db.select({ clerkId: users.clerkId, displayName: users.displayName, verified: users.verified, verificationStatus: users.verificationStatus, activeStanding: users.activeStanding, policyRestricted: users.policyRestricted })
          .from(users)
          .where(inArray(users.clerkId, ownerIds))
      : [];
    const sellerMap = Object.fromEntries(sellerRows.map((u) => [u.clerkId, u]));

    const result = filtered.map((p) => ({
      ...p,
      sellerDisplayName: sellerMap[p.ownerId]?.displayName ?? null,
      sellerVerified: sellerMap[p.ownerId] ? deriveSellerVerified(sellerMap[p.ownerId]) : false,
      variants: variantsByProduct[p.id] ?? [],
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch public products");
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// GET /api/public/products/high-demand
// Product-backed demand only: real reservation demand, optionally qualified by
// low remaining inventory. This must remain above /products/:id.
router.get("/products/high-demand", async (req, res) => {
  const parsedLimit = parseNonNegativeInteger(req.query.limit, "limit", 6);
  if (typeof parsedLimit !== "number" || parsedLimit < 1) {
    return res.status(400).json({
      error: typeof parsedLimit === "number" ? "limit must be at least 1" : parsedLimit.error,
    });
  }
  const lim = Math.min(parsedLimit, 24);

  try {
    setPublicCacheHeaders(res);
    const activeProducts = await db.select().from(products)
      .where(and(eq(products.status, "active"), isNull(products.deletedAt)));
    if (activeProducts.length === 0) return res.json([]);

    const productIds = activeProducts.map((product) => product.id);
    const ownerIds = [...new Set(activeProducts.map((product) => product.ownerId))];
    const dropIds = [...new Set(activeProducts.map((product) => product.dropId).filter((id): id is string => Boolean(id)))];
    const [variantRows, sellerRows, dropRows, paidClaimRows] = await Promise.all([
      db.select().from(productVariants).where(inArray(productVariants.productId, productIds)),
      db.select({
        clerkId: users.clerkId,
        displayName: users.displayName,
        verified: users.verified,
        verificationStatus: users.verificationStatus,
        activeStanding: users.activeStanding,
        policyRestricted: users.policyRestricted,
      }).from(users).where(inArray(users.clerkId, ownerIds)),
      dropIds.length > 0
        ? db.select({ id: drops.id, endsAt: drops.endsAt }).from(drops).where(inArray(drops.id, dropIds))
        : Promise.resolve([]),
      db.select({
        productId: productVariants.productId,
        claimedUnits: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
      })
        .from(orderItems)
        .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(
          inArray(productVariants.productId, productIds),
          isNotNull(orders.paidAt),
          notInArray(orders.status, ["cancelled", "refund_pending", "refunded"]),
        ))
        .groupBy(productVariants.productId),
    ]);

    const variantsByProduct: Record<string, typeof variantRows> = {};
    for (const variant of variantRows) (variantsByProduct[variant.productId] ??= []).push(variant);
    const sellerMap = new Map(sellerRows.map((seller) => [seller.clerkId, seller]));
    const dropEndMap = new Map(dropRows.map((drop) => [drop.id, drop.endsAt]));
    const paidClaimsMap = new Map(paidClaimRows.map((row) => [row.productId, Number(row.claimedUnits)]));

    const qualified = activeProducts
      .map((product) => {
        const variants = variantsByProduct[product.id] ?? [];
        const remainingUnits = variants.reduce((sum, variant) => sum + Math.max(0, variant.stock), 0);
        const claimedUnits = Math.max(0, paidClaimsMap.get(product.id) ?? 0);
        const seller = sellerMap.get(product.ownerId);
        return {
          ...product,
          variants,
          claimedUnits,
          remainingUnits,
          endsAt: product.preOrderClosingDate ?? (product.dropId ? dropEndMap.get(product.dropId) : null) ?? null,
          sellerDisplayName: seller?.displayName ?? null,
          sellerVerified: seller ? deriveSellerVerified(seller) : false,
        };
      })
      .filter((product) =>
        product.demandCount >= 50 ||
        (product.demandCount > 0 && product.remainingUnits > 0 && product.remainingUnits <= 10))
      .sort((a, b) =>
        b.demandCount - a.demandCount ||
        a.remainingUnits - b.remainingUnits ||
        b.updatedAt.getTime() - a.updatedAt.getTime() ||
        a.id.localeCompare(b.id))
      .slice(0, lim);

    return res.json(qualified);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch high-demand products");
    return res.status(500).json({ error: "Failed to fetch high-demand products" });
  }
});

// GET /api/public/products/:id/videos
// "Worn in these videos" — posts that tagged this product, video-only.
// Must precede /products/:id so Express does not treat "videos" as a product id.
router.get("/products/:id/videos", async (req, res) => {
  const parsedLimit = parseNonNegativeInteger(req.query.limit, "limit", 12);
  if (typeof parsedLimit !== "number" || parsedLimit < 1) {
    return res.status(400).json({ error: typeof parsedLimit === "number" ? "limit must be at least 1" : parsedLimit.error });
  }
  const lim = Math.min(parsedLimit, 24);

  try {
    setPublicCacheHeaders(res);
    const rows = await db.select({
      postId: posts.id,
      mediaUrl: posts.mediaUrl,
      thumbnailUrl: posts.thumbnailUrl,
      caption: posts.caption,
      createdAt: posts.createdAt,
      authorId: posts.userId,
      authorName: users.displayName,
      authorUsername: users.username,
    }).from(posts)
      .innerJoin(postTaggedProducts, eq(postTaggedProducts.postId, posts.id))
      .innerJoin(users, eq(users.clerkId, posts.userId))
      .where(and(
        eq(postTaggedProducts.productId, req.params.id),
        eq(posts.mediaType, "video"),
        publicPostCondition(),
      ))
      .orderBy(desc(posts.createdAt))
      .limit(lim);

    return res.json(rows.map((row) => ({
      postId: row.postId,
      mediaUrl: row.mediaUrl,
      thumbnailUrl: row.thumbnailUrl,
      caption: row.caption,
      createdAt: row.createdAt,
      authorId: row.authorId,
      authorName: row.authorName ?? row.authorUsername ?? "Seller",
    })));
  } catch (err) {
    req.log.error({ err, productId: req.params.id }, "Failed to fetch tagged videos");
    return res.status(500).json({ error: "Failed to fetch tagged videos" });
  }
});

// GET /api/public/products/:id/related
// This route must precede /products/:id so Express does not treat "related" as
// a product id.
router.get("/products/:id/related", async (req, res) => {
  const parsedLimit = parseNonNegativeInteger(req.query.limit, "limit", 12);
  if (typeof parsedLimit !== "number" || parsedLimit < 1) {
    return res.status(400).json({ error: typeof parsedLimit === "number" ? "limit must be at least 1" : parsedLimit.error });
  }
  const lim = Math.min(parsedLimit, 24);

  try {
    setPublicCacheHeaders(res);
    const [current] = await db.select().from(products)
      .where(and(eq(products.id, req.params.id), eq(products.status, "active"), isNull(products.deletedAt))).limit(1);
    if (!current) return res.status(404).json({ error: "Product not found" });

    // Fetch the candidate set in one query and batch its dependent records below.
    // Ranking is application-side because tags/styleTags are JSON arrays.
    const candidates = await db.select().from(products)
      .where(and(eq(products.status, "active"), isNull(products.deletedAt), ne(products.id, current.id)));
    const ranked = rankRelatedProducts(current, candidates).slice(0, lim);
    if (ranked.length === 0) return res.json([]);

    const productIds = ranked.map((product) => product.id);
    const ownerIds = [...new Set(ranked.map((product) => product.ownerId))];
    const [variants, sellerRows] = await Promise.all([
      db.select().from(productVariants).where(inArray(productVariants.productId, productIds)),
      db.select({ clerkId: users.clerkId, displayName: users.displayName })
        .from(users).where(inArray(users.clerkId, ownerIds)),
    ]);
    const variantsByProduct: Record<string, typeof variants> = {};
    for (const variant of variants) (variantsByProduct[variant.productId] ??= []).push(variant);
    const sellerMap = new Map(sellerRows.map((seller) => [seller.clerkId, seller.displayName]));

    return res.json(ranked.map((product) => ({
      ...product,
      sellerDisplayName: sellerMap.get(product.ownerId) ?? null,
      variants: variantsByProduct[product.id] ?? [],
    })));
  } catch (err) {
    req.log.error({ err, productId: req.params.id }, "Failed to fetch related products");
    return res.status(500).json({ error: "Failed to fetch related products" });
  }
});

// GET /api/public/products/:id
router.get("/products/:id", async (req, res) => {
  try {
    setPublicCacheHeaders(res);
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, req.params.id), eq(products.status, "active"), isNull(products.deletedAt)))
      .limit(1);

    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const variants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, product.id));

    // Attach seller display name
    const [seller] = await db
      .select({ displayName: users.displayName, verified: users.verified, verificationStatus: users.verificationStatus, activeStanding: users.activeStanding, policyRestricted: users.policyRestricted })
      .from(users)
      .where(eq(users.clerkId, product.ownerId))
      .limit(1);
    const vacation = await getSellerVacationStatus(product.ownerId);

    res.json({
      ...product,
      sellerDisplayName: seller?.displayName ?? null,
      sellerVerified: seller ? deriveSellerVerified(seller) : false,
      sellerVacationMode: vacation.active,
      sellerVacationMessage: vacation.active ? vacation.message : null,
      sellerVacationUntil: vacation.until?.toISOString() ?? null,
      variants,
    });
  } catch (err) {
    req.log.error({ err, productId: req.params.id }, "Failed to fetch public product");
    res.status(500).json({ error: "Failed to fetch product" });
  }
});

// GET /api/public/collections/:id — a shared "Save to collection" board (deep link).
// Only ever returns collections the owner has explicitly marked public.
router.get("/collections/:id", async (req, res) => {
  try {
    const [collection] = await db.select().from(savedCollections)
      .where(and(eq(savedCollections.id, req.params.id), eq(savedCollections.isPublic, true)))
      .limit(1);
    if (!collection) {
      res.status(404).json({ error: "Collection not found" });
      return;
    }

    const [owner] = await db.select({ displayName: users.displayName, brandName: users.brandName })
      .from(users)
      .where(eq(users.clerkId, collection.userId))
      .limit(1);

    const items = await db.select().from(savedItems)
      .where(eq(savedItems.collectionId, collection.id))
      .orderBy(desc(savedItems.createdAt));
    const adaptedItems = await adaptSavedRows(items);

    let coverImageUrl = collection.coverImageUrl;
    if (!coverImageUrl) {
      const productIds = items.filter((i) => i.itemType === "product").map((i) => i.targetId);
      const badgeInfo = await fetchProductBadgeInfo(productIds);
      coverImageUrl = items.map((i) => badgeInfo.get(i.targetId)?.image).find(Boolean) ?? null;
    }

    res.json({
      collection: {
        id: collection.id,
        name: collection.name,
        coverImageUrl,
        itemCount: items.length,
        ownerName: owner?.brandName ?? owner?.displayName ?? "Brandthread",
      },
      items: adaptedItems,
    });
  } catch (err) {
    req.log.error({ err, collectionId: req.params.id }, "Failed to fetch public collection");
    res.status(500).json({ error: "Failed to fetch collection" });
  }
});

// Typo-tolerance threshold for pg_trgm similarity(). Below this a term is
// considered "not a real match" even though ILIKE substring already gates
// most of the noise; this only widens matching to near-miss spellings.
const SIMILARITY_THRESHOLD = 0.25;

/** SQL predicate: substring match (existing behavior) OR trigram-similarity match (typo tolerance). */
function fuzzyMatch(column: any, term: string, pattern: string) {
  return sql`(${ilike(column, pattern)} OR similarity(${column}, ${term}) > ${SIMILARITY_THRESHOLD})`;
}

/** Best-of(substring exactness, trigram similarity) — used to order "relevance" results server-side. */
function relevanceScore(column: any, term: string) {
  return sql<number>`GREATEST(similarity(${column}, ${term}), CASE WHEN ${column} ILIKE ${"%" + term + "%"} THEN 0.999 ELSE 0 END)`;
}

// GET /api/public/search?q=query&limit=20&offset=0
// Returns: { results: Array<{ id, kind:'brand'|'product', ...SearchBrand|SearchProduct fields }> }
router.get("/search", async (req, res): Promise<void> => {
  try {
    const q = singleQueryValue(req.query.q);
    const sortValue = singleQueryValue(req.query.sort);
    const category = singleQueryValue(req.query.category);
    const sizeValue = singleQueryValue(req.query.size);
    const brandValue = singleQueryValue(req.query.brand);
    const parsedLimit = parseNonNegativeInteger(req.query.limit, "limit", 20);
    const parsedOffset = parseNonNegativeInteger(req.query.offset, "offset", 0);
    const minPriceCents = req.query.minPriceCents === undefined
      ? undefined : parseNonNegativeInteger(req.query.minPriceCents, "minPriceCents");
    const maxPriceCents = req.query.maxPriceCents === undefined
      ? undefined : parseNonNegativeInteger(req.query.maxPriceCents, "maxPriceCents");
    if (q === null || sortValue === null || category === null || sizeValue === null || brandValue === null ||
        typeof parsedLimit !== "number" || typeof parsedOffset !== "number" ||
        typeof minPriceCents === "object" || typeof maxPriceCents === "object") {
      res.status(400).json({ error: "Invalid search query values" }); return;
    }
    if (parsedLimit < 1) { res.status(400).json({ error: "limit must be at least 1" }); return; }
    if (sortValue !== undefined && !SEARCH_SORTS.includes(sortValue as SearchSort)) {
      res.status(400).json({ error: "sort must be relevance, price_asc, price_desc, or newest" }); return;
    }
    if (minPriceCents !== undefined && maxPriceCents !== undefined && minPriceCents > maxPriceCents) {
      res.status(400).json({ error: "minPriceCents must not exceed maxPriceCents" }); return;
    }
    const sort: SearchSort = (sortValue as SearchSort | undefined) ?? "relevance";
    const searchQuery = q ?? "";
    const term = normalizeSearchTerm(searchQuery);
    if (!term || term.length < 2) { res.json({ results: [], pagination: paginationMetadata({ limit: parsedLimit, offset: parsedOffset }, 0, 0) }); return; }

    const lim = Math.min(parsedLimit, 50);
    const off = parsedOffset;
    const pattern = containsSearchPattern(term);
    const viewerId = optionalViewerId(req);

    // Do not SQL-limit joined variants: first collapse each product to its
    // lowest price, then filter/sort products, and only then apply the limit.
    const productPrice = sql<number>`min(${productVariants.priceCents})`;
    const [sellers, prods, videoPosts] = await Promise.all([
      db.select({
        clerkId:     users.clerkId,
        displayName: users.displayName,
        brandName:   users.brandName,
        username:    users.username,
        relevance:   relevanceScore(sql`COALESCE(${users.brandName}, ${users.displayName}, ${users.username}, '')`, term),
      }).from(users).where(
        and(
          eq(users.accountType, "seller"),
          isNull(users.suspendedAt),
          isNull(users.deletedAt),
          notBlockedWith(viewerId, users.clerkId),
          or(
            fuzzyMatch(users.displayName, term, pattern),
            fuzzyMatch(users.brandName, term, pattern),
            fuzzyMatch(users.username, term, pattern),
          ),
        ),
      ).orderBy(desc(relevanceScore(sql`COALESCE(${users.brandName}, ${users.displayName}, ${users.username}, '')`, term)), asc(users.clerkId)).limit(10),

      db.select({
        id:         products.id,
        name:       products.name,
        ownerId:    products.ownerId,
        category:   products.category,
        images:     products.images,
        createdAt:  products.createdAt,
        priceCents: productPrice,
        relevance:  sql<number>`max(${relevanceScore(products.name, term)})`,
      }).from(products)
        .leftJoin(productVariants, eq(productVariants.productId, products.id))
        .where(and(
          eq(products.status, "active"), isNull(products.deletedAt),
          fuzzyMatch(products.name, term, pattern),
          category ? eq(products.category, category) : undefined,
          notBlockedWith(viewerId, products.ownerId),
          sizeValue ? sql`EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = ${products.id} AND pv.size ILIKE ${sizeValue})` : undefined,
          brandValue ? sql`EXISTS (
            SELECT 1 FROM users bu WHERE bu.clerk_id = ${products.ownerId}
              AND (bu.clerk_id = ${brandValue} OR bu.brand_name ILIKE ${containsSearchPattern(normalizeSearchTerm(brandValue))})
          )` : undefined,
          sql`NOT EXISTS (SELECT 1 FROM users su WHERE su.clerk_id = ${products.ownerId} AND su.suspended_at IS NOT NULL)`))
        .groupBy(products.id)
        .having(and(
          minPriceCents === undefined ? undefined : sql`min(${productVariants.priceCents}) >= ${minPriceCents}`,
          maxPriceCents === undefined ? undefined : sql`min(${productVariants.priceCents}) <= ${maxPriceCents}`,
        )),

      // Videos — matched by caption or by a tagged product's name, same
      // typo-tolerant relevance as products/brands above. Kept unfiltered by
      // category/size/brand/price (those are product-only filters).
      db.select({
        id:        posts.id,
        caption:   posts.caption,
        mediaUrl:  posts.mediaUrl,
        thumbnailUrl: posts.thumbnailUrl,
        authorId:  posts.userId,
        createdAt: posts.createdAt,
        relevance: relevanceScore(sql`COALESCE(${posts.caption}, '')`, term),
      }).from(posts)
        .where(and(
          eq(posts.mediaType, "video"),
          publicPostCondition(),
          or(
            fuzzyMatch(posts.caption, term, pattern),
            sql`EXISTS (
              SELECT 1 FROM post_tagged_products ptp
              JOIN products pr ON pr.id = ptp.product_id
              WHERE ptp.post_id = ${posts.id}
                AND (pr.name ILIKE ${pattern} OR similarity(pr.name, ${term}) > ${SIMILARITY_THRESHOLD})
            )`,
          ),
        ))
        .orderBy(desc(relevanceScore(sql`COALESCE(${posts.caption}, '')`, term)), desc(posts.createdAt))
        .limit(20),
    ]);

    // Fetch seller display names for product results
    const sellerIds = [...new Set(prods.map((p) => p.ownerId))];
    const sellerMap = new Map<string, string>();
    if (sellerIds.length > 0) {
      const sellerRows = await db
        .select({ clerkId: users.clerkId, displayName: users.displayName, brandName: users.brandName })
        .from(users)
        .where(inArray(users.clerkId, sellerIds));
      sellerRows.forEach((s) => sellerMap.set(s.clerkId, s.brandName ?? s.displayName ?? "Brand"));
    }

    // Author + like-count lookups for matched videos.
    const videoAuthorIds = [...new Set(videoPosts.map((v) => v.authorId))];
    const videoAuthorMap = new Map<string, { name: string; handle: string; avatarUrl: string | null }>();
    if (videoAuthorIds.length > 0) {
      const authorRows = await db
        .select({
          clerkId: users.clerkId, displayName: users.displayName, brandName: users.brandName,
          username: users.username, name: users.name,
          profileImageUrl: users.profileImageUrl, avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(inArray(users.clerkId, videoAuthorIds));
      authorRows.forEach((a) => {
        const name = a.brandName ?? a.displayName ?? a.name ?? "Member";
        videoAuthorMap.set(a.clerkId, {
          name,
          handle: a.username ? `@${a.username}` : `@${name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20)}`,
          avatarUrl: a.profileImageUrl ?? a.avatarUrl ?? null,
        });
      });
    }
    const videoPostIds = videoPosts.map((v) => v.id);
    const videoLikeCounts = videoPostIds.length > 0
      ? await db.select({ postId: interactions.postId, cnt: count() })
          .from(interactions)
          .where(and(inArray(interactions.postId, videoPostIds), eq(interactions.type, "like")))
          .groupBy(interactions.postId)
      : [];
    const videoLikesByPost = new Map(videoLikeCounts.map((r) => [r.postId, Number(r.cnt)]));

    // Colour helpers (deterministic, no DB column)
    const PALETTE = ["#8B5CF6", "#0891B2", "#0F766E", "#B45309", "#1D4ED8", "#BE185D", "#065F46"];
    const hashColor = (str: string) => {
      let h = 0;
      for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0xffffff;
      return PALETTE[Math.abs(h) % PALETTE.length];
    };
    const mkInitials = (name: string) =>
      name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
    const mkHandle = (name: string) =>
      "@" + name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);

    const seen = new Set<string>();
    const results: any[] = [];

    // Brands first, best relevance (typo-tolerant) match first.
    const sortedSellers = [...sellers].sort((a, b) => Number(b.relevance) - Number(a.relevance) || a.clerkId.localeCompare(b.clerkId));
    for (const s of sortedSellers) {
      if (seen.has(s.clerkId)) continue;
      seen.add(s.clerkId);
      const name = s.brandName ?? s.displayName ?? s.username ?? "Brand";
      results.push({
        id:       s.clerkId,
        kind:     "brand",
        name,
        handle:   s.username ? `@${s.username}` : mkHandle(name),
        color:    hashColor(s.clerkId),
        initials: mkInitials(name),
        sellerId: s.clerkId,
      });
    }

    // Products arrive collapsed and price-filtered by the database.
    const prodMap = new Map<string, { id: string; name: string; ownerId: string; category: string; images: string[]; createdAt: Date; minPrice: number; relevance: number }>();
    for (const p of prods) {
      const price = Number(p.priceCents ?? 0);
      prodMap.set(p.id, { id: p.id, name: p.name, ownerId: p.ownerId, category: p.category, images: Array.isArray(p.images) ? p.images.filter((image): image is string => typeof image === "string") : [], createdAt: p.createdAt, minPrice: price, relevance: Number(p.relevance ?? 0) });
    }
    const filteredProducts = [...prodMap.values()]
      .sort((a, b) => {
        if (sort === "price_asc") return a.minPrice - b.minPrice || b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
        if (sort === "price_desc") return b.minPrice - a.minPrice || b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
        if (sort === "newest") return b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
        return b.relevance - a.relevance || b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
      });
    for (const p of filteredProducts) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const brandName = sellerMap.get(p.ownerId) ?? "Brand";
      results.push({
        id:        p.id,
        kind:      "product",
        brand:     brandName,
        name:      p.name,
        price:     "$" + Math.round(p.minPrice / 100),
        priceCents: p.minPrice,
        category: p.category,
        imageUri: p.images[0] ?? null,
        createdAt: p.createdAt,
        color:     hashColor(p.ownerId),
        initials:  mkInitials(brandName),
        productId: p.id,
      });
    }

    // Videos, best relevance first — a separate slice from products/brands so
    // the client can render a dedicated "Videos" tab (kind: 'video').
    const sortedVideos = [...videoPosts].sort((a, b) => Number(b.relevance) - Number(a.relevance) || b.createdAt.getTime() - a.createdAt.getTime());
    for (const v of sortedVideos) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      const author = videoAuthorMap.get(v.authorId) ?? { name: "Member", handle: "@member", avatarUrl: null };
      results.push({
        id:            v.id,
        kind:          "video",
        postId:        v.id,
        caption:       v.caption,
        thumbnailUrl:  v.thumbnailUrl ?? null,
        videoUrl:      v.mediaUrl,
        authorId:      v.authorId,
        authorName:    author.name,
        authorHandle:  author.handle,
        authorAvatarUrl: author.avatarUrl,
        color:         hashColor(v.authorId),
        initials:      mkInitials(author.name),
        likesCount:    videoLikesByPost.get(v.id) ?? 0,
        createdAt:     v.createdAt,
      });
    }

    const total = results.length;
    const limited = results.slice(off, off + lim);

    // Fire-and-forget query log — backs /search/recent and /search/trending.
    // Never blocks or fails the response.
    db.insert(searchLog).values({
      userId: viewerId ?? null,
      query: searchQuery.slice(0, 200),
      normalized: term,
      resultCount: total,
    }).catch((err) => req.log.error({ err }, "Failed to log search query"));

    res.json({
      results: limited,
      pagination: paginationMetadata({ limit: lim, offset: off }, limited.length, total),
    });
  } catch (err) {
    req.log.error({ err }, "Public search failed");
    res.status(500).json({ error: "Search failed" });
  }
});

// ─── GET /api/public/search/trending — trending searches (empty-state chips) ──
// Real trending: the most-frequent normalized queries logged to search_log in
// the last 48h (search_log now exists — see migration 088). Falls back to the
// category/follower-based approximation used before search logging existed
// when the log is too sparse (fresh environment, low traffic) to be
// meaningful, so this never regresses to an empty/boring result.
const TRENDING_LOG_WINDOW_MS = 48 * 60 * 60 * 1000;
const MIN_LOGGED_QUERIES_FOR_TRENDING = 5;

router.get("/search/trending", async (req, res) => {
  try {
    const parsedLimit = parseNonNegativeInteger(req.query.limit, "limit", 8);
    if (typeof parsedLimit !== "number" || parsedLimit < 1) {
      res.status(400).json({ error: "limit must be at least 1" }); return;
    }
    const lim = Math.min(parsedLimit, 20);
    const since = new Date(Date.now() - TRENDING_LOG_WINDOW_MS);

    const loggedTrending = await db
      .select({ normalized: searchLog.normalized, cnt: count() })
      .from(searchLog)
      .where(gte(searchLog.createdAt, since))
      .groupBy(searchLog.normalized)
      .orderBy(desc(count()))
      .limit(lim);

    if (loggedTrending.length >= MIN_LOGGED_QUERIES_FOR_TRENDING) {
      res.json({ trending: loggedTrending.map((t) => ({ term: t.normalized, type: "query" as const })) });
      return;
    }

    const [topCategories, topBrands] = await Promise.all([
      db.select({ category: products.category, count: count() })
        .from(products)
        .where(and(eq(products.status, "active"), isNull(products.deletedAt)))
        .groupBy(products.category)
        .orderBy(desc(count()))
        .limit(lim),
      db.select({ sellerId: follows.followingId, followerCount: count() })
        .from(follows)
        .innerJoin(users, eq(users.clerkId, follows.followingId))
        .where(and(eq(users.accountType, "seller"), isNull(users.suspendedAt), isNull(users.deletedAt)))
        .groupBy(follows.followingId)
        .orderBy(desc(count()))
        .limit(lim),
    ]);

    const brandIds = topBrands.map((b) => b.sellerId);
    const brandRows = brandIds.length > 0
      ? await db.select({ clerkId: users.clerkId, displayName: users.displayName, brandName: users.brandName })
          .from(users).where(inArray(users.clerkId, brandIds))
      : [];
    const brandNameById = new Map(brandRows.map((b) => [b.clerkId, b.brandName ?? b.displayName ?? "Brand"]));

    const trending = [
      ...loggedTrending.map((t) => ({ term: t.normalized, type: "query" as const })),
      ...topCategories.map((c) => ({ term: c.category, type: "category" as const })),
      ...topBrands.map((b) => ({ term: brandNameById.get(b.sellerId) ?? "Brand", type: "brand" as const })),
    ].slice(0, lim);

    res.json({ trending });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch trending searches");
    res.status(500).json({ error: "Failed to fetch trending searches" });
  }
});

// ─── GET /api/public/search/recent — this buyer's own recent searches ─────────
// Signed-in only (a client-side "recent" list is meaningless without an
// identity to scope it to). Deduped by normalized query, most recent first.
router.get("/search/recent", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).clerkUserId as string;
    const parsedLimit = parseNonNegativeInteger(req.query.limit, "limit", 10);
    if (typeof parsedLimit !== "number" || parsedLimit < 1) {
      res.status(400).json({ error: "limit must be at least 1" }); return;
    }
    const lim = Math.min(parsedLimit, 30);

    const rows = await db
      .select({ query: searchLog.query, normalized: searchLog.normalized, createdAt: sql<Date>`max(${searchLog.createdAt})` })
      .from(searchLog)
      .where(eq(searchLog.userId, userId))
      .groupBy(searchLog.query, searchLog.normalized)
      .orderBy(desc(sql`max(${searchLog.createdAt})`))
      .limit(lim);

    res.json({ recent: rows.map((r) => ({ query: r.query, normalized: r.normalized })) });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch recent searches");
    res.status(500).json({ error: "Failed to fetch recent searches" });
  }
});

// ─── DELETE /api/public/search/recent — clear this buyer's recent searches ────
router.delete("/search/recent", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).clerkUserId as string;
    await db.delete(searchLog).where(eq(searchLog.userId, userId));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to clear recent searches");
    res.status(500).json({ error: "Failed to clear recent searches" });
  }
});

// ─── GET /api/public/search/suggested — suggested brands/products (empty state) ─
// Suggested brands = most-followed sellers; suggested products = most
// recently listed active products. Both are cheap, already-indexed queries
// that need no new tracking tables.
router.get("/search/suggested", async (req, res) => {
  try {
    const parsedLimit = parseNonNegativeInteger(req.query.limit, "limit", 6);
    if (typeof parsedLimit !== "number" || parsedLimit < 1) {
      res.status(400).json({ error: "limit must be at least 1" }); return;
    }
    const lim = Math.min(parsedLimit, 20);
    const viewerId = optionalViewerId(req);

    const [topBrands, recentProducts] = await Promise.all([
      db.select({ sellerId: follows.followingId, followerCount: count() })
        .from(follows)
        .innerJoin(users, eq(users.clerkId, follows.followingId))
        .where(and(
          eq(users.accountType, "seller"),
          isNull(users.suspendedAt),
          isNull(users.deletedAt),
          notBlockedWith(viewerId, follows.followingId),
        ))
        .groupBy(follows.followingId)
        .orderBy(desc(count()))
        .limit(lim),
      db.select({
        id: products.id, name: products.name, ownerId: products.ownerId,
        category: products.category, images: products.images, createdAt: products.createdAt,
      }).from(products)
        .where(and(
          eq(products.status, "active"),
          isNull(products.deletedAt),
          notBlockedWith(viewerId, products.ownerId),
        ))
        .orderBy(desc(products.createdAt))
        .limit(lim),
    ]);

    const sellerIds = [...new Set([...topBrands.map((b) => b.sellerId), ...recentProducts.map((p) => p.ownerId)])];
    const sellerRows = sellerIds.length > 0
      ? await db.select({ clerkId: users.clerkId, displayName: users.displayName, brandName: users.brandName })
          .from(users).where(inArray(users.clerkId, sellerIds))
      : [];
    const sellerMap = new Map(sellerRows.map((s) => [s.clerkId, s.brandName ?? s.displayName ?? "Brand"]));

    const PALETTE = ["#8B5CF6", "#0891B2", "#0F766E", "#B45309", "#1D4ED8", "#BE185D", "#065F46"];
    const hashColor = (str: string) => {
      let h = 0;
      for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0xffffff;
      return PALETTE[Math.abs(h) % PALETTE.length];
    };
    const mkInitials = (name: string) =>
      name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
    const mkHandle = (name: string) =>
      "@" + name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);

    res.json({
      brands: topBrands.map((b) => {
        const name = sellerMap.get(b.sellerId) ?? "Brand";
        return {
          id: b.sellerId, sellerId: b.sellerId, name, handle: mkHandle(name),
          color: hashColor(b.sellerId), initials: mkInitials(name),
          followerCount: Number(b.followerCount ?? 0),
        };
      }),
      products: recentProducts.map((p) => {
        const brandName = sellerMap.get(p.ownerId) ?? "Brand";
        const images = Array.isArray(p.images) ? p.images.filter((i): i is string => typeof i === "string") : [];
        return {
          id: p.id, productId: p.id, name: p.name, brand: brandName,
          category: p.category, imageUri: images[0] ?? null,
          color: hashColor(p.ownerId), initials: mkInitials(brandName),
        };
      }),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch suggested search results");
    res.status(500).json({ error: "Failed to fetch suggested search results" });
  }
});

// ─── GET /api/public/search/categories — "Search by category" tiles (empty state) ─
// One representative image per active product category — the most recently
// listed active product in that category, falling back to a hashed color
// swatch when no product in the category has an image yet.
router.get("/search/categories", async (req, res) => {
  try {
    const parsedLimit = parseNonNegativeInteger(req.query.limit, "limit", 8);
    if (typeof parsedLimit !== "number" || parsedLimit < 1) {
      res.status(400).json({ error: "limit must be at least 1" }); return;
    }
    const lim = Math.min(parsedLimit, 20);
    const viewerId = optionalViewerId(req);

    const topCategories = await db
      .select({ category: products.category, count: count() })
      .from(products)
      .where(and(eq(products.status, "active"), isNull(products.deletedAt)))
      .groupBy(products.category)
      .orderBy(desc(count()))
      .limit(lim);

    const PALETTE = ["#8B5CF6", "#0891B2", "#0F766E", "#B45309", "#1D4ED8", "#BE185D", "#065F46"];
    const hashColor = (str: string) => {
      let h = 0;
      for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0xffffff;
      return PALETTE[Math.abs(h) % PALETTE.length];
    };

    const categories = await Promise.all(topCategories.map(async (c) => {
      const [product] = await db
        .select({ id: products.id, images: products.images, ownerId: products.ownerId })
        .from(products)
        .where(and(
          eq(products.category, c.category),
          eq(products.status, "active"),
          isNull(products.deletedAt),
          notBlockedWith(viewerId, products.ownerId),
          sql`jsonb_array_length(to_jsonb(${products.images})) > 0`,
        ))
        .orderBy(desc(products.createdAt))
        .limit(1);
      return {
        category: c.category,
        productCount: Number(c.count ?? 0),
        imageUri: Array.isArray(product?.images) ? (product.images.find((i): i is string => typeof i === "string") ?? null) : null,
        color: hashColor(c.category),
      };
    }));

    res.json({ categories });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch search categories");
    res.status(500).json({ error: "Failed to fetch search categories" });
  }
});

// ─── GET /api/public/brands/discover — newest active sellers to follow ────────
// Unauthenticated, lightweight "browse brands" list used by buyer onboarding's
// Brands-to-follow step (there is no full search term at that point, so the
// existing /search endpoint — which requires a query — doesn't fit). Returns
// active, non-restricted sellers newest-first. No style/category column
// exists on `users` today, so this intentionally returns a flat list; any
// future style/category filter should extend this query, not add a second
// endpoint.
export function rankDiscoverBrands<T extends { createdAt: Date; clerkId: string }>(sellers: T[]): T[] {
  return [...sellers].sort((a, b) =>
    b.createdAt.getTime() - a.createdAt.getTime() || a.clerkId.localeCompare(b.clerkId));
}

router.get("/brands/discover", async (req, res) => {
  try {
    const parsedLimit = parseNonNegativeInteger(req.query.limit, "limit", 24);
    if (typeof parsedLimit !== "number" || parsedLimit < 1) {
      res.status(400).json({
        error: typeof parsedLimit === "number" ? "limit must be at least 1" : parsedLimit.error,
      });
      return;
    }
    const lim = Math.min(parsedLimit, 50);
    const viewerId = optionalViewerId(req);

    const sellers = await db
      .select({
        clerkId:         users.clerkId,
        displayName:     users.displayName,
        brandName:       users.brandName,
        brandType:       users.brandType,
        profileImageUrl: users.profileImageUrl,
        avatarUrl:       users.avatarUrl,
        verified:        users.verified,
        verificationStatus: users.verificationStatus,
        activeStanding:  users.activeStanding,
        policyRestricted: users.policyRestricted,
        createdAt:       users.createdAt,
      })
      .from(users)
      .where(and(
        eq(users.accountType, "seller"),
        isNull(users.suspendedAt),
        isNull(users.deletedAt),
        eq(users.policyRestricted, false),
        notBlockedWith(viewerId, users.clerkId),
      ))
      .orderBy(desc(users.createdAt), asc(users.clerkId))
      .limit(lim * 2); // small buffer before app-side ranking/limit

    const ranked = rankDiscoverBrands(sellers).slice(0, lim);

    res.json({
      brands: ranked.map((s) => ({
        id:          s.clerkId,
        sellerId:    s.clerkId,
        name:        s.brandName || s.displayName || "Brand",
        brandType:   s.brandType ?? null,
        logoUrl:     s.profileImageUrl ?? s.avatarUrl ?? null,
        verified:    deriveSellerVerified(s),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch discover brands");
    res.status(500).json({ error: "Failed to fetch brands" });
  }
});

// ─── GET /api/public/sellers/:sellerId — public seller storefront ─────────────
// Accepts either users.clerkId or users.id (UUID) for backward-/forward-compatibility.
router.get("/sellers/:sellerId", async (req, res) => {
  const { sellerId } = req.params;

  // Resolve to canonical clerkId — accepts UUID alias or clerkId directly.
  const canonicalClerkId = await resolveToClerkId(sellerId, "seller");
  if (!canonicalClerkId) return res.status(404).json({ error: "Seller not found" });

  const [seller] = await db
    .select({
      clerkId:         users.clerkId,
      displayName:     users.displayName,
      brandName:       users.brandName,
      bio:             users.bio,
      website:         users.website,
      profileImageUrl: users.profileImageUrl,
      avatarUrl:        users.avatarUrl,
      verified:        users.verified,
      verificationStatus: users.verificationStatus,
      activeStanding: users.activeStanding,
      policyRestricted: users.policyRestricted,
      brandType:       users.brandType,
      accountType:     users.accountType,
      vacationMode:    users.vacationMode,
      vacationMessage: users.vacationMessage,
      username:        users.username,
    })
    .from(users)
    .where(eq(users.clerkId, canonicalClerkId))
    .limit(1);

  if (!seller) return res.status(404).json({ error: "Seller not found" });
  const viewerId = optionalViewerId(req);
  if (viewerId && viewerId !== canonicalClerkId && await isBlockedEitherWay(viewerId, canonicalClerkId)) {
    return res.status(404).json({ error: "Seller not found" });
  }
  const vacation = await getSellerVacationStatus(canonicalClerkId);

  const activeProductsWhere = and(
    eq(products.ownerId, canonicalClerkId),
    eq(products.status, "active"),
    isNull(products.deletedAt),
  );
  const [sellerProducts, sellerPosts, [{ activeProductsCount }], [{ publicPostsCount }]] = await Promise.all([
    db
      .select()
      .from(products)
      .where(activeProductsWhere)
      .orderBy(desc(products.createdAt))
      .limit(50),
    db
      .select()
      .from(posts)
      .where(and(
        eq(posts.userId, canonicalClerkId),
        sql<boolean>`coalesce((${posts.visibility}->>'isPublic')::boolean, true) = true`,
        or(
          eq(posts.postStatus, "published"),
          and(eq(posts.postStatus, "scheduled"), lte(posts.scheduledAt, new Date())),
        ),
      ))
      .orderBy(desc(posts.createdAt))
      .limit(30),
    // True totals for the profile's "Shop N products" pill and video count —
    // the two lists above are capped pages, not counts.
    db.select({ activeProductsCount: count() }).from(products).where(activeProductsWhere),
    db.select({ publicPostsCount: count() }).from(posts)
      .where(and(eq(posts.userId, canonicalClerkId), publicPostCondition())),
  ]);

  // Attach tagged products per post
  const postIds = sellerPosts.map((p) => p.id);
  const tagsByPost = new Map<string, any[]>();
  if (postIds.length > 0) {
    const tags = await db
      .select({
        postId:    postTaggedProducts.postId,
        productId: postTaggedProducts.productId,
        position:  postTaggedProducts.position,
        name:      products.name,
        images:    products.images,
      })
      .from(postTaggedProducts)
      .leftJoin(products, eq(products.id, postTaggedProducts.productId))
      .where(inArray(postTaggedProducts.postId, postIds));

    for (const t of tags) {
      if (!tagsByPost.has(t.postId)) tagsByPost.set(t.postId, []);
      tagsByPost.get(t.postId)!.push(t);
    }
  }

  let profileImageUrl: string | null = seller.profileImageUrl ?? seller.avatarUrl ?? null;
  if (seller.profileImageUrl?.startsWith("/objects/")) {
    try {
      profileImageUrl = await objectStorage.getObjectEntityDownloadURL(seller.profileImageUrl);
    } catch (err) {
      req.log.warn({ err }, "Could not sign public seller profile image");
      profileImageUrl = seller.avatarUrl ?? null;
    }
  }

  return res.json({
    profile: {
      ...seller,
      // Expose the canonical Clerk ID so callers can use it for follow/message/review actions.
      // This is safe: it's the functional identity needed by downstream authenticated endpoints,
      // not a secret (Clerk IDs are sent on every authenticated request header).
      clerkId:      canonicalClerkId,
      verified: deriveSellerVerified(seller),
      vacationMode: vacation.active,
      vacationMessage: vacation.active ? vacation.message : null,
      vacationUntil: vacation.until?.toISOString() ?? null,
      profileImageUrl,
      productsCount: Number(activeProductsCount),
      videosCount: Number(publicPostsCount),
    },
    products: sellerProducts,
    posts: sellerPosts.map((p) => ({
      ...p,
      taggedProducts: tagsByPost.get(p.id) ?? [],
    })),
  });
});

// ─── GET /api/public/drops — buyer-facing active drops with countdown ─────────
// ?section=upcoming|live|recent narrows the browse screen's three tabs; the
// bare endpoint (no section) keeps its original "active, soonest first"
// shape for existing callers (Discover, Following).
router.get("/drops", async (req, res) => {
  setPublicCacheHeaders(res);
  const now = new Date();
  const section = typeof req.query.section === "string" ? req.query.section : undefined;

  const dropSelect = {
    id:                drops.id,
    ownerId:           drops.ownerId,
    name:              drops.name,
    type:              drops.type,
    status:            drops.status,
    releaseAt:         drops.releaseAt,
    endsAt:            drops.endsAt,
    heroImageUrl:      drops.heroImageUrl,
    heroVideoUrl:      drops.heroVideoUrl,
    launchTimezone:    drops.launchTimezone,
    estimatedShipDate: drops.estimatedShipDate,
    orderCount:        drops.orderCount,
    mfgProgress:       drops.mfgProgress,
    createdAt:         drops.createdAt,
  };

  let activeDrops;
  if (section === "recent") {
    activeDrops = await db.select(dropSelect).from(drops)
      .where(and(
        inArray(drops.status, ["closed", "fulfilled"]),
        isNotNull(drops.releaseAt),
      ))
      .orderBy(desc(drops.releaseAt))
      .limit(50);
  } else if (section === "live") {
    activeDrops = await db.select(dropSelect).from(drops)
      .where(and(
        eq(drops.status, "active"),
        isNotNull(drops.releaseAt),
        lte(drops.releaseAt, now),
        or(isNull(drops.endsAt), gt(drops.endsAt, now)),
      ))
      .orderBy(drops.releaseAt)
      .limit(50);
  } else if (section === "upcoming") {
    activeDrops = await db.select(dropSelect).from(drops)
      .where(and(
        eq(drops.status, "active"),
        isNotNull(drops.releaseAt),
        gt(drops.releaseAt, now),
      ))
      .orderBy(drops.releaseAt)
      .limit(50);
  } else {
    activeDrops = await db.select(dropSelect).from(drops)
      .where(eq(drops.status, "active"))
      .orderBy(drops.releaseAt)
      .limit(50);
  }

  if (activeDrops.length === 0) return res.json([]);

  const sellerIds = [...new Set(activeDrops.map((d) => d.ownerId))];
  const sellerRows = await db
    .select({ clerkId: users.clerkId, displayName: users.displayName, brandName: users.brandName })
    .from(users)
    .where(inArray(users.clerkId, sellerIds));
  const sellerMap = new Map(sellerRows.map((s) => [s.clerkId, s]));

  return res.json(activeDrops.map((d) => ({ ...d, seller: sellerMap.get(d.ownerId) ?? null })));
});

// ─── GET /api/public/drops/:id — single drop detail (countdown, live, or recap) ──
// Any non-draft status is visible: 'active' covers upcoming-countdown and live,
// 'closed'/'fulfilled' still resolve so the buyer page can render its recap
// state instead of a dead link once the drop is over.
router.get("/drops/:id", async (req, res) => {
  setPublicCacheHeaders(res);
  const [drop] = await db
    .select()
    .from(drops)
    .where(and(eq(drops.id, req.params.id), ne(drops.status, "draft")))
    .limit(1);
  if (!drop) return res.status(404).json({ error: "Drop not found" });

  const { userId } = getAuth(req);
  const [[seller], dropProducts, isFollower] = await Promise.all([
    db
      .select({ displayName: users.displayName, brandName: users.brandName, verified: users.verified, verificationStatus: users.verificationStatus, activeStanding: users.activeStanding, policyRestricted: users.policyRestricted })
      .from(users)
      .where(eq(users.clerkId, drop.ownerId))
      .limit(1),
    db
      .select({
        id:             products.id,
        name:           products.name,
        description:    products.description,
        category:       products.category,
        status:         products.status,
        images:         products.images,
        isPreOrder:     products.isPreOrder,
        createdAt:      products.createdAt,
        stockRemaining: sql<number>`coalesce(sum(${productVariants.stock}), 0)`,
      })
      .from(products)
      .leftJoin(productVariants, eq(productVariants.productId, products.id))
      .where(and(eq(products.dropId, req.params.id), eq(products.status, "active"), isNull(products.deletedAt)))
      .groupBy(products.id)
      .orderBy(products.createdAt)
      .limit(50),
    userId
      ? db.select({ followerId: follows.followerId }).from(follows)
          .where(and(eq(follows.followerId, userId), eq(follows.followingId, drop.ownerId)))
          .limit(1)
          .then((rows) => rows.length > 0)
      : Promise.resolve(false),
  ]);

  // The effective moment this viewer may buy/see the drop unlock — releaseAt
  // pulled forward by the seller's early-access window for their followers.
  const viewerHasEarlyAccess = isFollower && drop.earlyAccessMinutes > 0;
  const effectiveReleaseAt = drop.releaseAt
    ? effectiveDropLaunchAt(drop.releaseAt, drop.earlyAccessMinutes, isFollower)
    : null;

  return res.json({
    ...drop,
    seller: seller ? { ...seller, verified: deriveSellerVerified(seller) } : null,
    products: dropProducts.map((p) => ({ ...p, soldOut: p.stockRemaining <= 0 })),
    viewerHasEarlyAccess,
    effectiveReleaseAt,
  });
});

router.get("/drops/:id/notify", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const dropId = typeof req.params.id === "string" ? req.params.id : undefined;
  if (!dropId) { res.status(400).json({ error: "drop id required" }); return; }
  const [subscription] = await db
    .select({ id: dropAlertSubscriptions.id })
    .from(dropAlertSubscriptions)
    .where(and(eq(dropAlertSubscriptions.dropId, dropId), eq(dropAlertSubscriptions.userId, userId)))
    .limit(1);
  res.json({ subscribed: !!subscription });
});

router.post("/drops/:id/notify", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const dropId = typeof req.params.id === "string" ? req.params.id : undefined;
  if (!dropId) { res.status(400).json({ error: "drop id required" }); return; }
  const [drop] = await db.select({ id: drops.id }).from(drops)
    .where(and(eq(drops.id, dropId), eq(drops.status, "active")))
    .limit(1);
  if (!drop) { res.status(404).json({ error: "Drop not found or not active" }); return; }
  await db.insert(dropAlertSubscriptions).values({ dropId: drop.id, userId }).onConflictDoNothing();
  res.json({ subscribed: true });
});

router.delete("/drops/:id/notify", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const dropId = typeof req.params.id === "string" ? req.params.id : undefined;
  if (!dropId) { res.status(400).json({ error: "drop id required" }); return; }
  await db.delete(dropAlertSubscriptions).where(
    and(eq(dropAlertSubscriptions.dropId, dropId), eq(dropAlertSubscriptions.userId, userId)),
  );
  res.json({ subscribed: false });
});

// POST /api/public/sellers/:sellerId/visit
// A signed-in shopper is recorded once per seller per UTC day. A separate table
// prevents arbitrary public traffic from inflating a seller's conversion inputs.
// Accepts users.clerkId or users.id (UUID alias) — resolves to canonical clerkId.
router.post("/sellers/:sellerId/visit", requireAuth, async (req, res): Promise<void> => {
  const { sellerId } = req.params;
  const visitorId = (req as any).clerkUserId as string;
  if (!sellerId || typeof sellerId !== "string") {
    res.status(400).json({ error: "sellerId required" });
    return;
  }
  try {
    // Resolve UUID alias or clerkId to canonical clerkId.
    const canonicalClerkId = await resolveToClerkId(sellerId, "seller");
    if (!canonicalClerkId) {
      res.status(404).json({ error: "Seller not found" });
      return;
    }
    // Don't count owner visits.
    if (canonicalClerkId === visitorId) {
      res.status(204).end();
      return;
    }

    const [newVisit] = await db
      .insert(storefrontVisits)
      .values({
        sellerId: canonicalClerkId,
        visitorId,
        visitDate: new Date().toISOString().slice(0, 10),
      })
      .onConflictDoNothing()
      .returning({ id: storefrontVisits.id });

    if (newVisit) {
      await db
        .update(users)
        .set({
          storefrontVisitCount: sql`${users.storefrontVisitCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.clerkId, canonicalClerkId));
    }
    res.status(204).end();
  } catch (err) {
    req.log.error({ err, sellerId, visitorId }, "Storefront visit recording failed");
    res.status(500).json({ error: "failed" });
  }
});

// ─── GET /api/public/posts ────────────────────────────────────────────────────
// Paginated public feed of all seller posts, newest-first. No auth required.
// Query params: ?ownerId=seller_xxx&limit=30&offset=0
router.get("/posts", async (req, res) => {
  try {
    const ownerId = singleQueryValue(req.query.ownerId);
    const page = parsePagination(req.query, { limit: 30 });
    if (!page.success || ownerId === null || (ownerId?.length ?? 0) > 160 || page.data.limit > 50) {
      return res.status(400).json({ error: "Invalid posts query", code: "VALIDATION_ERROR" });
    }
    const { limit: lim, offset: off } = page.data;
    const viewerId = optionalViewerId(req);

    // Fetch posts newest-first, joined with seller display info
    const pageRows = await db
      .select({
        id:          posts.id,
        userId:      posts.userId,
        mediaUrl:    posts.mediaUrl,
        thumbnailUrl: posts.thumbnailUrl,
        mediaUrls:   posts.mediaUrls,
        mediaType:   posts.mediaType,
        aspectRatio: posts.aspectRatio,
        caption:     posts.caption,
        hashtags:    posts.hashtags,
        styleTags:   posts.styleTags,
        sound:       posts.sound,
        visibility:  posts.visibility,
        createdAt:   posts.createdAt,
        displayName: users.displayName,
        brandName:   users.brandName,
        verified:    users.verified,
        verificationStatus: users.verificationStatus,
        activeStanding: users.activeStanding,
        policyRestricted: users.policyRestricted,
      })
      .from(posts)
      .leftJoin(users, eq(users.clerkId, posts.userId))
      .where(and(
        ownerId ? eq(posts.userId, ownerId) : undefined,
        eq(users.accountType, "seller"),
        publicPostCondition(),
        notBlockedWith(viewerId, posts.userId),
      ))
      .orderBy(desc(posts.createdAt), asc(posts.id))
      .limit(lim)
      .offset(off);
    setPaginationHeaders(res, page.data, pageRows.length);

    // Muted words hide matching captions from this viewer only.
    const muted = await mutedPhrasesFor(viewerId);
    const rows = muted.length === 0 ? pageRows : pageRows.filter((row) =>
      !matchesMutedWords([row.caption ?? "", ...(row.hashtags ?? [])].join(" "), muted));

    if (rows.length === 0) {
      return res.json([]);
    }

    const postIds = rows.map((r) => r.id);

    // Fetch tagged products and interaction counts in parallel
    const [tagRows, likeRows, repostRows, commentRows] = await Promise.all([
      db
        .select({
          postId:    postTaggedProducts.postId,
          productId: postTaggedProducts.productId,
          position:  postTaggedProducts.position,
          name:      products.name,
          images:    products.images,
        })
        .from(postTaggedProducts)
        .leftJoin(products, eq(products.id, postTaggedProducts.productId))
        .where(inArray(postTaggedProducts.postId, postIds))
        .orderBy(postTaggedProducts.position),

      db
        .select({ postId: interactions.postId, cnt: count() })
        .from(interactions)
        .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "like")))
        .groupBy(interactions.postId),

      db
        .select({ postId: interactions.postId, cnt: count() })
        .from(interactions)
        .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "repost")))
        .groupBy(interactions.postId),

      visibleCommentCounts(postIds),
    ]);

    // Index by postId for O(1) lookup
    const tagsByPost: Record<string, typeof tagRows> = {};
    for (const t of tagRows) {
      if (!tagsByPost[t.postId]) tagsByPost[t.postId] = [];
      tagsByPost[t.postId].push(t);
    }
    const likesByPost: Record<string, number> = {};
    for (const r of likeRows) if (r.postId) likesByPost[r.postId] = Number(r.cnt);
    const repostsByPost: Record<string, number> = {};
    for (const r of repostRows) if (r.postId) repostsByPost[r.postId] = Number(r.cnt);
    const commentsByPost: Record<string, number> = Object.fromEntries(commentRows);

    const result = rows.map((p) => ({
      id:             p.id,
      userId:         p.userId,
      mediaUrl:       p.mediaUrl,
      thumbnailUrl:   p.thumbnailUrl,
      mediaUrls:      p.mediaUrls,
      mediaType:      p.mediaType,
      aspectRatio:    p.aspectRatio,
      caption:        p.caption,
      hashtags:       p.hashtags,
      styleTags:      p.styleTags,
      sound:          p.sound,
      visibility:     p.visibility,
      createdAt:      p.createdAt,
      seller: {
        displayName: p.displayName,
        brandName:   p.brandName,
        verified:    deriveSellerVerified(p),
      },
      taggedProducts: (tagsByPost[p.id] ?? []).map((t) => ({
        productId: t.productId,
        position:  t.position,
        name:      t.name,
        images:    t.images,
      })),
      likesCount:    p.visibility?.showLikeCount === false ? null : likesByPost[p.id] ?? 0,
      repostsCount:  repostsByPost[p.id]  ?? 0,
      commentsCount: commentsByPost[p.id] ?? 0,
    }));

    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch public posts");
    return res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// ─── GET /api/public/trending ─────────────────────────────────────────────────
// Serves the pre-computed daily trending list from trending_cache.
// The list is calculated once per day by the computeTrending background job
// (velocity-normalised engagement, category diversity, seeded jitter, boost bump).
// On a cache miss (e.g. very first request of the day), computation runs
// synchronously so the response is still correct.
// Query params: ?limit=20
router.get("/trending", async (req, res) => {
  try {
    // Trending is recomputed at most once a day server-side; a longer client
    // cache window is safe and cuts repeat load meaningfully.
    setPublicCacheHeaders(res, { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 });
    const page = parsePagination(req.query, { limit: 20 });
    if (!page.success || page.data.limit > 50 || page.data.offset !== 0) {
      return res.status(400).json({ error: "Invalid trending query", code: "VALIDATION_ERROR" });
    }
    const lim = page.data.limit;
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' UTC

    // ── Attempt cache read ───────────────────────────────────────────────────
    const [cached] = await db
      .select()
      .from(trendingCache)
      .where(eq(trendingCache.cacheDate, today))
      .limit(1);

    if (cached && isCacheFresh(cached.computedAt) && Array.isArray(cached.results) && cached.results.length > 0) {
      const items = (cached.results as any[]).slice(0, lim).map((item: any, i: number) => ({
        ...item,
        rank: i + 1,
      }));
      return res.json({ trending: items, computedAt: cached.computedAt, source: "cache" });
    }

    // ── Cache miss — compute synchronously (once per day maximum) ───────────
    // Use a module-level Promise so all concurrent requests share one computation.
    req.log.info({ cacheDate: today }, "Trending cache miss; computing synchronously");
    if (!trendingInflight) {
      trendingInflight = computeTrendingForToday().finally(() => {
        trendingInflight = null;
      });
    }
    await trendingInflight;

    const [fresh] = await db
      .select()
      .from(trendingCache)
      .where(eq(trendingCache.cacheDate, today))
      .limit(1);

    if (fresh && Array.isArray(fresh.results)) {
      const items = (fresh.results as any[]).slice(0, lim).map((item: any, i: number) => ({
        ...item,
        rank: i + 1,
      }));
      return res.json({ trending: items, computedAt: fresh.computedAt, source: "computed" });
    }

    return res.json({ trending: [], source: "empty" });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch public trending results");
    return res.status(500).json({ error: "Failed to fetch trending" });
  }
});

// ─── GET /api/public/profiles/:username ───────────────────────────────────────
//
// Unauthenticated. Resolves a normalized username to a safe public profile DTO.
//
// Security guarantees:
// - No Clerk ID is ever returned in the response.
// - Deleted / tombstoned accounts (deletedAt IS NOT NULL) → 404.
// - Accounts with no username or accountType → 404.
// - Only returns fields safe for public display.
// - Rate-limited to the "public-read" policy (240 req / 5 min per IP).
//
// Response:
//   { id, username, accountType, displayName, bio, avatarUrl, verified }
//
// IMPORTANT: `id` is the opaque internal DB UUID, never the Clerk ID.
// Public profile read endpoints accept this UUID as an alias and resolve it to the
// canonical account ID internally before applying ownership, block, and privacy rules.
router.get("/profiles/:username", async (req, res) => {
  const rawUsername = req.params.username;

  // Normalize: lowercase, letters/numbers/underscores only, 3–30 chars.
  if (!rawUsername || typeof rawUsername !== "string") {
    res.status(400).json({ error: "username is required" });
    return;
  }
  const normalized = rawUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (normalized.length < 3 || normalized.length > 30) {
    res.status(400).json({ error: "Invalid username format" });
    return;
  }

  try {
    const [user] = await db
      .select({
        id:          users.id,
        clerkId:     users.clerkId,
        username:    users.username,
        accountType: users.accountType,
        displayName: users.displayName,
        name:        users.name,
        bio:         users.bio,
        avatarUrl:   users.avatarUrl,
        profileImageUrl: users.profileImageUrl,
        verified:    users.verified,
        deletedAt:   users.deletedAt,
      })
      .from(users)
      // Case-insensitive lookup using the normalized form.
      .where(sql`lower(${users.username}) = ${normalized}`)
      .limit(1);

    // Not found.
    if (!user) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    // Tombstoned / deleted account.
    if (user.deletedAt) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    // Blocked in either direction: the profile is invisible to this viewer.
    const viewerId = optionalViewerId(req);
    if (viewerId && viewerId !== user.clerkId && await isBlockedEitherWay(viewerId, user.clerkId)) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    // Must have an accountType and a username.
    if (!user.accountType || !user.username) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    // Resolve public avatar — prefer uploaded image, fall back to Clerk avatar.
    // Object-storage /objects/ paths are private — never expose them directly.
    let avatarUrl: string | null = user.avatarUrl ?? null;
    if (user.profileImageUrl && typeof user.profileImageUrl === "string") {
      if (user.profileImageUrl.startsWith("http")) {
        avatarUrl = user.profileImageUrl;
      }
    }

    const verified = deriveSellerVerified(user as any);

    res.json({
      id:          user.id,
      username:    user.username,
      accountType: user.accountType,
      displayName: user.displayName ?? user.name ?? null,
      bio:         user.bio ?? null,
      avatarUrl,
      verified,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to resolve public profile by username");
    res.status(500).json({ error: "Failed to load profile" });
  }
});

// ─── GET /api/public/discover/feed ────────────────────────────────────────────
// Serves the pre-computed daily Discover seller ranking from
// seller_ranking_cache. The list is calculated once per day by the
// computeSellerRanking background job (recency-decayed engagement,
// follower-normalized, rotation bonus, capped at 2 products per seller,
// cold-start fallback to newest active brands). On a cache miss, computation
// runs synchronously so the response is still correct (deduped via an
// in-flight promise so concurrent requests share one computation).
// Unauthenticated — signed-out buyers can browse Discover.
// Query params: ?limit=20&offset=0 (limit capped at 50)
router.get("/discover/feed", async (req, res) => {
  try {
    const page = parsePagination(req.query, { limit: 20 });
    if (!page.success || page.data.limit > 50 || page.data.offset < 0) {
      return res.status(400).json({ error: "Invalid discover query", code: "VALIDATION_ERROR" });
    }
    const { limit, offset } = page.data;
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' UTC

    const paginate = (allItems: any[], source: "cache" | "computed") => {
      const items = allItems.slice(offset, offset + limit).map((item, i) => ({
        ...item,
        rank: offset + i + 1,
      }));
      const nextOffset = offset + limit < allItems.length ? offset + limit : null;
      return { items, nextOffset, source };
    };

    // ── Attempt cache read ───────────────────────────────────────────────────
    const [cached] = await db
      .select()
      .from(sellerRankingCache)
      .where(eq(sellerRankingCache.cacheDate, today))
      .limit(1);

    if (cached && isSellerRankingCacheFresh(cached.computedAt) && Array.isArray(cached.results) && cached.results.length > 0) {
      const { items, nextOffset } = paginate(cached.results as any[], "cache");
      return res.json({ items, computedAt: cached.computedAt, source: "cache", nextOffset });
    }

    // ── Cache miss — compute synchronously (once per day maximum) ───────────
    req.log.info({ cacheDate: today }, "Discover feed cache miss; computing synchronously");
    if (!sellerRankingInflight) {
      sellerRankingInflight = computeSellerRankingForToday().finally(() => {
        sellerRankingInflight = null;
      });
    }
    await sellerRankingInflight;

    const [fresh] = await db
      .select()
      .from(sellerRankingCache)
      .where(eq(sellerRankingCache.cacheDate, today))
      .limit(1);

    if (fresh && Array.isArray(fresh.results) && fresh.results.length > 0) {
      const { items, nextOffset } = paginate(fresh.results as any[], "computed");
      return res.json({ items, computedAt: fresh.computedAt, source: "computed", nextOffset });
    }

    return res.json({ items: [], computedAt: fresh?.computedAt ?? new Date().toISOString(), source: "empty", nextOffset: null });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch discover feed");
    return res.status(500).json({ error: "Failed to fetch discover feed" });
  }
});

export default router;
