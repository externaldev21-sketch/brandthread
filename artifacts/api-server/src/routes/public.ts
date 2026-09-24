/**
 * Public (unauthenticated) product browsing endpoints for buyers.
 * Mounted at /api/public — no requireAuth middleware.
 */
import { Router } from "express";
import { db, products, productVariants, users, drops, dropAlertSubscriptions, posts, postTaggedProducts, interactions, storefrontVisits, trendingCache, sellerRankingCache, boosts, orders, orderItems } from "@workspace/db";
import { eq, and, asc, desc, ne, inArray, notInArray, or, ilike, sql, count, gte, lte, isNull, isNotNull } from "drizzle-orm";
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
    const whereClause = and(
      eq(products.status, "active"),
      isNull(products.deletedAt),
      ownerId ? eq(products.ownerId, ownerId) : undefined,
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

// GET /api/public/search?q=query&limit=20
// Returns: { results: Array<{ id, kind:'brand'|'product', ...SearchBrand|SearchProduct fields }> }
router.get("/search", async (req, res): Promise<void> => {
  try {
    const q = singleQueryValue(req.query.q);
    const sortValue = singleQueryValue(req.query.sort);
    const category = singleQueryValue(req.query.category);
    const parsedLimit = parseNonNegativeInteger(req.query.limit, "limit", 20);
    const minPriceCents = req.query.minPriceCents === undefined
      ? undefined : parseNonNegativeInteger(req.query.minPriceCents, "minPriceCents");
    const maxPriceCents = req.query.maxPriceCents === undefined
      ? undefined : parseNonNegativeInteger(req.query.maxPriceCents, "maxPriceCents");
    if (q === null || sortValue === null || category === null ||
        typeof parsedLimit !== "number" || typeof minPriceCents === "object" || typeof maxPriceCents === "object") {
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
    if (!term || term.length < 2) { res.json({ results: [] }); return; }

    const lim = Math.min(parsedLimit, 50);
    const pattern = containsSearchPattern(term);
    const viewerId = optionalViewerId(req);

    // Do not SQL-limit joined variants: first collapse each product to its
    // lowest price, then filter/sort products, and only then apply the limit.
    const productPrice = sql<number>`min(${productVariants.priceCents})`;
    const [sellers, prods] = await Promise.all([
      db.select({
        clerkId:     users.clerkId,
        displayName: users.displayName,
        brandName:   users.brandName,
      }).from(users).where(
        and(
          eq(users.accountType, "seller"),
          isNull(users.suspendedAt),
          isNull(users.deletedAt),
          notBlockedWith(viewerId, users.clerkId),
          or(ilike(users.displayName, pattern), ilike(users.brandName, pattern)),
        ),
      ).orderBy(asc(users.displayName), asc(users.clerkId)).limit(10),

      db.select({
        id:         products.id,
        name:       products.name,
        ownerId:    products.ownerId,
        category:   products.category,
        images:     products.images,
        createdAt:  products.createdAt,
        priceCents: productPrice,
      }).from(products)
        .leftJoin(productVariants, eq(productVariants.productId, products.id))
        .where(and(eq(products.status, "active"), isNull(products.deletedAt), ilike(products.name, pattern),
          category ? eq(products.category, category) : undefined,
          notBlockedWith(viewerId, products.ownerId),
          sql`NOT EXISTS (SELECT 1 FROM users su WHERE su.clerk_id = ${products.ownerId} AND su.suspended_at IS NOT NULL)`))
        .groupBy(products.id)
        .having(and(
          minPriceCents === undefined ? undefined : sql`min(${productVariants.priceCents}) >= ${minPriceCents}`,
          maxPriceCents === undefined ? undefined : sql`min(${productVariants.priceCents}) <= ${maxPriceCents}`,
        )),
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

    // Brands first
    for (const s of sellers) {
      if (seen.has(s.clerkId)) continue;
      seen.add(s.clerkId);
      const name = s.brandName ?? s.displayName ?? "Brand";
      results.push({
        id:       s.clerkId,
        kind:     "brand",
        name,
        handle:   mkHandle(name),
        color:    hashColor(s.clerkId),
        initials: mkInitials(name),
        sellerId: s.clerkId,
      });
    }

    // Products arrive collapsed and price-filtered by the database.
    const prodMap = new Map<string, { id: string; name: string; ownerId: string; category: string; images: string[]; createdAt: Date; minPrice: number }>();
    for (const p of prods) {
      const price = Number(p.priceCents ?? 0);
      prodMap.set(p.id, { id: p.id, name: p.name, ownerId: p.ownerId, category: p.category, images: Array.isArray(p.images) ? p.images.filter((image): image is string => typeof image === "string") : [], createdAt: p.createdAt, minPrice: price });
    }
    const filteredProducts = [...prodMap.values()]
      .sort((a, b) => {
        if (sort === "price_asc") return a.minPrice - b.minPrice || b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
        if (sort === "price_desc") return b.minPrice - a.minPrice || b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
        if (sort === "newest") return b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
        return a.name.localeCompare(b.name) || b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
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

    const limited = results.slice(0, lim);
    res.json({
      results: limited,
      pagination: paginationMetadata({ limit: lim, offset: 0 }, limited.length),
    });
  } catch (err) {
    req.log.error({ err }, "Public search failed");
    res.status(500).json({ error: "Search failed" });
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

  const [sellerProducts, sellerPosts] = await Promise.all([
    db
      .select()
      .from(products)
      .where(and(eq(products.ownerId, canonicalClerkId), eq(products.status, "active"), isNull(products.deletedAt)))
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
    },
    products: sellerProducts,
    posts: sellerPosts.map((p) => ({
      ...p,
      taggedProducts: tagsByPost.get(p.id) ?? [],
    })),
  });
});

// ─── GET /api/public/drops — buyer-facing active drops with countdown ─────────
router.get("/drops", async (req, res) => {
  const activeDrops = await db
    .select({
      id:                drops.id,
      ownerId:           drops.ownerId,
      name:              drops.name,
      type:              drops.type,
      status:            drops.status,
      releaseAt:         drops.releaseAt,
      estimatedShipDate: drops.estimatedShipDate,
      orderCount:        drops.orderCount,
      mfgProgress:       drops.mfgProgress,
      createdAt:         drops.createdAt,
    })
    .from(drops)
    .where(eq(drops.status, "active"))
    .orderBy(drops.releaseAt)
    .limit(50);

  if (activeDrops.length === 0) return res.json([]);

  const sellerIds = [...new Set(activeDrops.map((d) => d.ownerId))];
  const sellerRows = await db
    .select({ clerkId: users.clerkId, displayName: users.displayName, brandName: users.brandName })
    .from(users)
    .where(inArray(users.clerkId, sellerIds));
  const sellerMap = new Map(sellerRows.map((s) => [s.clerkId, s]));

  return res.json(activeDrops.map((d) => ({ ...d, seller: sellerMap.get(d.ownerId) ?? null })));
});

// ─── GET /api/public/drops/:id — single active drop detail ────────────────────
router.get("/drops/:id", async (req, res) => {
  const [drop] = await db
    .select()
    .from(drops)
    .where(and(eq(drops.id, req.params.id), eq(drops.status, "active")))
    .limit(1);
  if (!drop) return res.status(404).json({ error: "Drop not found or not active" });

  const [[seller], dropProducts] = await Promise.all([
    db
      .select({ displayName: users.displayName, brandName: users.brandName, verified: users.verified, verificationStatus: users.verificationStatus, activeStanding: users.activeStanding, policyRestricted: users.policyRestricted })
      .from(users)
      .where(eq(users.clerkId, drop.ownerId))
      .limit(1),
    db
      .select({
        id:          products.id,
        name:        products.name,
        description: products.description,
        category:    products.category,
        status:      products.status,
        images:      products.images,
        isPreOrder:  products.isPreOrder,
        createdAt:   products.createdAt,
      })
      .from(products)
      .where(and(eq(products.dropId, req.params.id), eq(products.status, "active"), isNull(products.deletedAt)))
      .orderBy(products.createdAt)
      .limit(50),
  ]);

  return res.json({ ...drop, seller: seller ? { ...seller, verified: deriveSellerVerified(seller) } : null, products: dropProducts });
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
