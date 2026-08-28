/**
 * Public (unauthenticated) product browsing endpoints for buyers.
 * Mounted at /api/public — no requireAuth middleware.
 */
import { Router } from "express";
import { db, products, productVariants, users, drops, dropAlertSubscriptions, posts, postTaggedProducts, interactions, storefrontVisits, trendingCache, boosts } from "@workspace/db";
import { eq, and, asc, desc, ne, inArray, or, ilike, sql, count, gte } from "drizzle-orm";
import { computeTrendingForToday, isCacheFresh } from "../jobs/computeTrending";
import { ObjectStorageService } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/requireAuth";
import { containsSearchPattern, normalizeSearchTerm } from "../lib/search";
import { getSellerVacationStatus } from "../lib/sellerAvailability";

// ─── In-flight guard for synchronous cache-miss computation ──────────────────
// Prevents concurrent requests from each triggering an independent full
// scoring pipeline when the cache is empty (e.g. right after midnight UTC or
// a fresh deploy before the 2-min warm job fires).  All concurrent waiters
// share the same Promise and get the result once it resolves.
let trendingInflight: Promise<void> | null = null;

const router = Router();
const objectStorage = new ObjectStorageService();

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
    const { category, tag, ownerId, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const lim = Math.min(parseInt(limit, 10) || 50, 100);
    const off = parseInt(offset, 10) || 0;

    // Fetch active products, optionally scoped to a specific seller
    const whereClause = ownerId
      ? and(eq(products.status, "active"), eq(products.ownerId, ownerId))
      : eq(products.status, "active");

    const rows = await db
      .select()
      .from(products)
      .where(whereClause)
      .orderBy(desc(products.createdAt))
      .limit(lim)
      .offset(off);

    // Filter by category / tag in JS (keeps query simple; replace with DB filter for scale)
    let filtered = rows;
    if (category) {
      filtered = filtered.filter((p) => p.category === category);
    }
    if (tag) {
      filtered = filtered.filter(
        (p) =>
          (p.tags as string[]).includes(tag) ||
          (p.styleTags as string[]).includes(tag)
      );
    }

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
      ? await db.select({ clerkId: users.clerkId, displayName: users.displayName })
          .from(users)
          .where(inArray(users.clerkId, ownerIds))
      : [];
    const sellerMap = Object.fromEntries(sellerRows.map((u) => [u.clerkId, u.displayName]));

    const result = filtered.map((p) => ({
      ...p,
      sellerDisplayName: sellerMap[p.ownerId] ?? null,
      variants: variantsByProduct[p.id] ?? [],
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch products" });
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
      .where(and(eq(products.id, req.params.id), eq(products.status, "active"))).limit(1);
    if (!current) return res.status(404).json({ error: "Product not found" });

    // Fetch the candidate set in one query and batch its dependent records below.
    // Ranking is application-side because tags/styleTags are JSON arrays.
    const candidates = await db.select().from(products)
      .where(and(eq(products.status, "active"), ne(products.id, current.id)));
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
    console.error("GET /api/public/products/:id/related error:", err);
    return res.status(500).json({ error: "Failed to fetch related products" });
  }
});

// GET /api/public/products/:id
router.get("/products/:id", async (req, res) => {
  try {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, req.params.id), eq(products.status, "active")))
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
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.clerkId, product.ownerId))
      .limit(1);
    const vacation = await getSellerVacationStatus(product.ownerId);

    res.json({
      ...product,
      sellerDisplayName: seller?.displayName ?? null,
      sellerVacationMode: vacation.active,
      sellerVacationMessage: vacation.active ? vacation.message : null,
      sellerVacationUntil: vacation.until?.toISOString() ?? null,
      variants,
    });
  } catch (err) {
    console.error(err);
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

    // Do not SQL-limit joined variants: first collapse each product to its
    // lowest price, then filter/sort products, and only then apply the limit.
    const [sellers, prods] = await Promise.all([
      db.select({
        clerkId:     users.clerkId,
        displayName: users.displayName,
        brandName:   users.brandName,
      }).from(users).where(
        and(
          eq(users.accountType, "seller"),
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
        priceCents: productVariants.priceCents,
      }).from(products)
        .leftJoin(productVariants, eq(productVariants.productId, products.id))
        .where(and(eq(products.status, "active"), ilike(products.name, pattern),
          category ? eq(products.category, category) : undefined)),
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

    // Products — collapse variants to one row with the minimum price
    const prodMap = new Map<string, { id: string; name: string; ownerId: string; category: string; images: string[]; createdAt: Date; minPrice: number }>();
    for (const p of prods) {
      const price = p.priceCents ?? 0;
      const prev = prodMap.get(p.id);
      if (!prev) {
        prodMap.set(p.id, { id: p.id, name: p.name, ownerId: p.ownerId, category: p.category, images: Array.isArray(p.images) ? p.images.filter((image): image is string => typeof image === "string") : [], createdAt: p.createdAt, minPrice: price });
      } else if (price < prev.minPrice) {
        prev.minPrice = price;
      }
    }
    const filteredProducts = [...prodMap.values()]
      .filter((product) => (minPriceCents === undefined || product.minPrice >= minPriceCents) &&
        (maxPriceCents === undefined || product.minPrice <= maxPriceCents))
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

    res.json({ results: results.slice(0, lim) });
  } catch (err) {
    console.error("search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

// ─── GET /api/public/sellers/:sellerId — public seller storefront ─────────────
router.get("/sellers/:sellerId", async (req, res) => {
  const { sellerId } = req.params;

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
      brandType:       users.brandType,
      accountType:     users.accountType,
      vacationMode:    users.vacationMode,
      vacationMessage: users.vacationMessage,
    })
    .from(users)
    .where(and(eq(users.clerkId, sellerId), eq(users.accountType, "seller")))
    .limit(1);

  if (!seller) return res.status(404).json({ error: "Seller not found" });
  const vacation = await getSellerVacationStatus(sellerId);

  const [sellerProducts, sellerPosts] = await Promise.all([
    db
      .select()
      .from(products)
      .where(and(eq(products.ownerId, sellerId), eq(products.status, "active")))
      .orderBy(desc(products.createdAt))
      .limit(50),
    db
      .select()
      .from(posts)
      .where(eq(posts.userId, sellerId))
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
      .select({ displayName: users.displayName, brandName: users.brandName, verified: users.verified })
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
      .where(and(eq(products.dropId, req.params.id), eq(products.status, "active")))
      .orderBy(products.createdAt)
      .limit(50),
  ]);

  return res.json({ ...drop, seller: seller ?? null, products: dropProducts });
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
router.post("/sellers/:sellerId/visit", requireAuth, async (req, res): Promise<void> => {
  const { sellerId } = req.params;
  const visitorId = (req as any).clerkUserId as string;
  if (!sellerId || typeof sellerId !== "string") {
    res.status(400).json({ error: "sellerId required" });
    return;
  }
  if (sellerId === visitorId) {
    res.status(204).end();
    return;
  }
  try {
    const [seller] = await db
      .select({ clerkId: users.clerkId })
      .from(users)
      .where(eq(users.clerkId, sellerId))
      .limit(1);
    if (!seller) {
      res.status(404).json({ error: "Seller not found" });
      return;
    }

    const [newVisit] = await db
      .insert(storefrontVisits)
      .values({
        sellerId,
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
        .where(eq(users.clerkId, sellerId));
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
    const ownerId = req.query.ownerId as string | undefined;
    const lim = Math.min(parseInt((req.query.limit as string) || "30", 10) || 30, 50);
    const off = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0);

    // Fetch posts newest-first, joined with seller display info
    const rows = await db
      .select({
        id:          posts.id,
        userId:      posts.userId,
        mediaUrl:    posts.mediaUrl,
        mediaType:   posts.mediaType,
        caption:     posts.caption,
        styleTags:   posts.styleTags,
        createdAt:   posts.createdAt,
        displayName: users.displayName,
        brandName:   users.brandName,
        verified:    users.verified,
      })
      .from(posts)
      .leftJoin(users, eq(users.clerkId, posts.userId))
      .where(ownerId ? eq(posts.userId, ownerId) : undefined)
      .orderBy(desc(posts.createdAt))
      .limit(lim)
      .offset(off);

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

      db
        .select({ postId: interactions.postId, cnt: count() })
        .from(interactions)
        .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "comment")))
        .groupBy(interactions.postId),
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
    const commentsByPost: Record<string, number> = {};
    for (const r of commentRows) if (r.postId) commentsByPost[r.postId] = Number(r.cnt);

    const result = rows.map((p) => ({
      id:             p.id,
      userId:         p.userId,
      mediaUrl:       p.mediaUrl,
      mediaType:      p.mediaType,
      caption:        p.caption,
      styleTags:      p.styleTags,
      createdAt:      p.createdAt,
      seller: {
        displayName: p.displayName,
        brandName:   p.brandName,
        verified:    p.verified,
      },
      taggedProducts: (tagsByPost[p.id] ?? []).map((t) => ({
        productId: t.productId,
        position:  t.position,
        name:      t.name,
        images:    t.images,
      })),
      likesCount:    likesByPost[p.id]    ?? 0,
      repostsCount:  repostsByPost[p.id]  ?? 0,
      commentsCount: commentsByPost[p.id] ?? 0,
    }));

    return res.json(result);
  } catch (err) {
    console.error("GET /api/public/posts error:", err);
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
    const lim   = Math.min(parseInt((req.query.limit as string) || "20", 10) || 20, 50);
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
    console.log("[computeTrending] Cache miss for", today, "— computing synchronously");
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
    console.error("GET /api/public/trending error:", err);
    return res.status(500).json({ error: "Failed to fetch trending" });
  }
});

export default router;
