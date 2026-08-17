/**
 * Public (unauthenticated) product browsing endpoints for buyers.
 * Mounted at /api/public — no requireAuth middleware.
 */
import { Router } from "express";
import { db, products, productVariants, users, drops, posts, postTaggedProducts, interactions, trendingCache } from "@workspace/db";
import { eq, and, desc, inArray, or, ilike, sql, count, gte } from "drizzle-orm";
import { computeTrendingForToday, isCacheFresh } from "../jobs/computeTrending";

const router = Router();

// GET /api/public/products
// Optional query params: ?category=apparel&tag=streetwear&limit=50&offset=0
router.get("/products", async (req, res) => {
  try {
    const { category, tag, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const lim = Math.min(parseInt(limit, 10) || 50, 100);
    const off = parseInt(offset, 10) || 0;

    // Fetch active products
    let query = db
      .select()
      .from(products)
      .where(eq(products.status, "active"))
      .orderBy(desc(products.createdAt))
      .limit(lim)
      .offset(off);

    const rows = await query;

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

    res.json({ ...product, sellerDisplayName: seller?.displayName ?? null, variants });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch product" });
  }
});

// GET /api/public/search?q=query&limit=20
// Returns: { results: Array<{ id, kind:'brand'|'product', ...SearchBrand|SearchProduct fields }> }
router.get("/search", async (req, res): Promise<void> => {
  try {
    const { q = "", limit = "20" } = req.query as Record<string, string>;
    const term = q.trim();
    if (!term || term.length < 2) { res.json({ results: [] }); return; }

    const lim = Math.min(parseInt(limit, 10) || 20, 50);
    const pattern = `%${term}%`;

    // Parallel: search sellers + search products (with a variant join for price)
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
      ).limit(10),

      db.select({
        id:         products.id,
        name:       products.name,
        ownerId:    products.ownerId,
        priceCents: productVariants.priceCents,
      }).from(products)
        .leftJoin(productVariants, eq(productVariants.productId, products.id))
        .where(and(eq(products.status, "active"), ilike(products.name, pattern)))
        .limit(lim * 2), // overfetch since we dedupe below
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
    const prodMap = new Map<string, { id: string; name: string; ownerId: string; minPrice: number }>();
    for (const p of prods) {
      const price = p.priceCents ?? 0;
      const prev = prodMap.get(p.id);
      if (!prev) {
        prodMap.set(p.id, { id: p.id, name: p.name, ownerId: p.ownerId, minPrice: price });
      } else if (price > 0 && price < prev.minPrice) {
        prev.minPrice = price;
      }
    }
    for (const p of prodMap.values()) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const brandName = sellerMap.get(p.ownerId) ?? "Brand";
      results.push({
        id:        p.id,
        kind:      "product",
        brand:     brandName,
        name:      p.name,
        price:     "$" + Math.round(p.minPrice / 100),
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

  return res.json({
    profile: seller,
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

// POST /api/public/sellers/:sellerId/visit
// Unauthenticated. Increments the seller's storefront visit counter by 1.
// Called fire-and-forget from the buyer-facing seller profile screen.
router.post("/sellers/:sellerId/visit", async (req, res) => {
  const { sellerId } = req.params;
  if (!sellerId || typeof sellerId !== "string") {
    return res.status(400).json({ error: "sellerId required" });
  }
  try {
    await db.execute(
      sql`UPDATE users SET storefront_visit_count = storefront_visit_count + 1 WHERE clerk_id = ${sellerId}`
    );
    return res.status(204).end();
  } catch (err) {
    console.error("visit increment error:", err);
    return res.status(500).json({ error: "failed" });
  }
});

// ─── GET /api/public/posts ────────────────────────────────────────────────────
// Paginated public feed of all seller posts, newest-first. No auth required.
// Query params: ?limit=30&offset=0
router.get("/posts", async (req, res) => {
  try {
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
    console.log("[computeTrending] Cache miss for", today, "— computing synchronously");
    await computeTrendingForToday();

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
