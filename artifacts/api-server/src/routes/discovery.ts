/**
 * Buyer discovery endpoints (public, mounted at /api/public):
 *   GET /categories                  normalized category list with counts + cover image
 *   GET /categories/:slug/products   products in one category (taxonomy-classified)
 *   GET /trending/products           products ranked by real recent signals
 *   GET /trending/brands             brands ranked by real recent signals
 *
 * Categories come from lib/categoryTaxonomy (free-text products.category,
 * name and tags mapped to a stable slug set). Trending uses lib/trendingScoring
 * over views / saves / paid orders / stock reservations / follows in the last
 * TRENDING_WINDOW_DAYS. Items with no signals are omitted, so a quiet
 * marketplace returns empty lists rather than invented rankings.
 */
import { Router } from "express";
import {
  db, products, productVariants, users, orders, orderItems, follows,
  savedItems, storeVisits, stockReservations,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, isNull, isNotNull, notInArray, sql } from "drizzle-orm";
import { setPublicCacheHeaders } from "../lib/httpCache";
import { toPublicVariant } from "../lib/publicProfile";
import { deriveSellerVerified } from "../lib/sellerEligibility";
import { notBlockedWith, optionalViewerId } from "../lib/safety";
import { parsePagination, setPaginationHeaders } from "../lib/pagination";
import {
  categoryLabel, classifyProduct, isCategorySlug, summarizeCategories,
} from "../lib/categoryTaxonomy";
import {
  TRENDING_WINDOW_DAYS, rankByScore, scoreBrandSignals, scoreProductSignals, windowStart,
} from "../lib/trendingScoring";

const router = Router();

const NOT_PAID_STATUSES = ["cancelled", "refund_pending", "refunded"];

/** Active, visible products with only the columns classification needs. */
async function loadClassifiable(viewerId: string | null) {
  const rows = await db
    .select({
      id: products.id,
      category: products.category,
      name: products.name,
      tags: products.tags,
      styleTags: products.styleTags,
      images: products.images,
    })
    .from(products)
    .where(and(
      eq(products.status, "active"),
      isNull(products.deletedAt),
      notBlockedWith(viewerId, products.ownerId),
    ))
    .orderBy(desc(products.createdAt), desc(products.id));
  return rows.map((r) => ({ ...r, slug: classifyProduct(r) }));
}

/** Shapes product rows like GET /api/public/products (variants + seller). */
async function attachVariantsAndSeller<T extends { id: string; ownerId: string }>(rows: T[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
  const [variants, sellers] = await Promise.all([
    db.select().from(productVariants).where(inArray(productVariants.productId, ids)),
    db.select({
      clerkId: users.clerkId,
      displayName: users.displayName,
      verified: users.verified,
      verificationStatus: users.verificationStatus,
      activeStanding: users.activeStanding,
      policyRestricted: users.policyRestricted,
    }).from(users).where(inArray(users.clerkId, ownerIds)),
  ]);
  const byProduct = new Map<string, typeof variants>();
  for (const v of variants) {
    const list = byProduct.get(v.productId) ?? [];
    list.push(v);
    byProduct.set(v.productId, list);
  }
  const sellerMap = new Map(sellers.map((s) => [s.clerkId, s]));
  return rows.map((p) => {
    const seller = sellerMap.get(p.ownerId);
    return {
      ...p,
      sellerDisplayName: seller?.displayName ?? null,
      sellerVerified: seller ? deriveSellerVerified(seller) : false,
      variants: (byProduct.get(p.id) ?? []).map(toPublicVariant),
    };
  });
}

// GET /api/public/categories
router.get("/categories", async (req, res) => {
  try {
    const viewerId = optionalViewerId(req);
    // Block filtering is per viewer, so only anonymous responses are shared-cacheable.
    if (!viewerId) setPublicCacheHeaders(res);
    const classified = await loadClassifiable(viewerId);
    res.json({ categories: summarizeCategories(classified) });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch categories");
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// GET /api/public/categories/:slug/products?limit=&offset=
router.get("/categories/:slug/products", async (req, res) => {
  const slug = String(req.params.slug ?? "").toLowerCase();
  if (!isCategorySlug(slug)) {
    res.status(404).json({ error: "Category not found", code: "NOT_FOUND" });
    return;
  }
  const page = parsePagination(req.query, { limit: 30 });
  if (!page.success) {
    res.status(400).json({ error: "Invalid category query", code: "VALIDATION_ERROR" });
    return;
  }
  try {
    const viewerId = optionalViewerId(req);
    if (!viewerId) setPublicCacheHeaders(res);
    const classified = await loadClassifiable(viewerId);
    const matching = classified.filter((p) => p.slug === slug);
    const { limit, offset } = page.data;
    const ids = matching.slice(offset, offset + limit).map((p) => p.id);
    setPaginationHeaders(res, page.data, ids.length, matching.length);
    if (ids.length === 0) {
      res.json({ slug, label: categoryLabel(slug), total: matching.length, products: [] });
      return;
    }
    const rows = await db.select().from(products).where(inArray(products.id, ids));
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
    res.json({
      slug,
      label: categoryLabel(slug),
      total: matching.length,
      products: await attachVariantsAndSeller(rows),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch category products");
    res.status(500).json({ error: "Failed to fetch category products" });
  }
});

// GET /api/public/trending/products?limit=
router.get("/trending/products", async (req, res) => {
  const page = parsePagination(req.query, { limit: 12 });
  if (!page.success) {
    res.status(400).json({ error: "Invalid trending query", code: "VALIDATION_ERROR" });
    return;
  }
  const limit = Math.min(page.data.limit, 50);
  try {
    const viewerId = optionalViewerId(req);
    if (!viewerId) setPublicCacheHeaders(res);
    const since = windowStart(new Date());

    const [views, saves, units, reservations] = await Promise.all([
      db.select({ id: storeVisits.productId, n: sql<number>`count(*)::int` })
        .from(storeVisits)
        .where(and(isNotNull(storeVisits.productId), gte(storeVisits.createdAt, since)))
        .groupBy(storeVisits.productId),
      db.select({ id: savedItems.targetId, n: sql<number>`count(*)::int` })
        .from(savedItems)
        .where(and(eq(savedItems.itemType, "product"), gte(savedItems.createdAt, since)))
        .groupBy(savedItems.targetId),
      db.select({ id: productVariants.productId, n: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
        .from(orderItems)
        .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(
          isNotNull(orders.paidAt),
          gte(orders.paidAt, since),
          notInArray(orders.status, NOT_PAID_STATUSES),
        ))
        .groupBy(productVariants.productId),
      db.select({ id: productVariants.productId, n: sql<number>`count(distinct ${stockReservations.checkoutSessionId})::int` })
        .from(stockReservations)
        .innerJoin(productVariants, eq(stockReservations.variantId, productVariants.id))
        .where(and(
          inArray(stockReservations.status, ["held", "committed"]),
          gte(stockReservations.createdAt, since),
        ))
        .groupBy(productVariants.productId),
    ]);

    const signals = new Map<string, { views: number; saves: number; orderUnits: number; reservations: number }>();
    const bump = (id: string | null, key: "views" | "saves" | "orderUnits" | "reservations", n: number) => {
      if (!id) return;
      const s = signals.get(id) ?? { views: 0, saves: 0, orderUnits: 0, reservations: 0 };
      s[key] += Number(n) || 0;
      signals.set(id, s);
    };
    views.forEach((r) => bump(r.id, "views", r.n));
    saves.forEach((r) => bump(r.id, "saves", r.n));
    units.forEach((r) => bump(r.id, "orderUnits", r.n));
    reservations.forEach((r) => bump(r.id, "reservations", r.n));

    // Saved-item target ids are free text; only UUIDs can be products.
    const candidateIds = [...signals.keys()].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (candidateIds.length === 0) {
      res.json({ windowDays: TRENDING_WINDOW_DAYS, products: [] });
      return;
    }
    const rows = await db.select().from(products).where(and(
      inArray(products.id, candidateIds),
      eq(products.status, "active"),
      isNull(products.deletedAt),
      notBlockedWith(viewerId, products.ownerId),
    ));
    const ranked = rankByScore(
      rows.map((p) => ({ ...p, score: scoreProductSignals(signals.get(p.id)!) })),
      limit,
    );
    const shaped = await attachVariantsAndSeller(ranked.map(({ score: _score, ...p }) => p));
    res.json({ windowDays: TRENDING_WINDOW_DAYS, products: shaped });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch trending products");
    res.status(500).json({ error: "Failed to fetch trending products" });
  }
});

// GET /api/public/trending/brands?limit=
router.get("/trending/brands", async (req, res) => {
  const page = parsePagination(req.query, { limit: 12 });
  if (!page.success) {
    res.status(400).json({ error: "Invalid trending query", code: "VALIDATION_ERROR" });
    return;
  }
  const limit = Math.min(page.data.limit, 50);
  try {
    const viewerId = optionalViewerId(req);
    if (!viewerId) setPublicCacheHeaders(res);
    const since = windowStart(new Date());

    const [orderRows, followRows, saveRows, visitRows] = await Promise.all([
      db.select({ id: orders.ownerId, n: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(
          isNotNull(orders.paidAt),
          gte(orders.paidAt, since),
          notInArray(orders.status, NOT_PAID_STATUSES),
        ))
        .groupBy(orders.ownerId),
      db.select({ id: follows.followingId, n: sql<number>`count(*)::int` })
        .from(follows)
        .where(gte(follows.createdAt, since))
        .groupBy(follows.followingId),
      db.select({ id: products.ownerId, n: sql<number>`count(*)::int` })
        .from(savedItems)
        .innerJoin(products, sql`${products.id}::text = ${savedItems.targetId}`)
        .where(and(eq(savedItems.itemType, "product"), gte(savedItems.createdAt, since)))
        .groupBy(products.ownerId),
      db.select({ id: storeVisits.sellerId, n: sql<number>`count(*)::int` })
        .from(storeVisits)
        .where(gte(storeVisits.createdAt, since))
        .groupBy(storeVisits.sellerId),
    ]);

    const signals = new Map<string, { orders: number; newFollowers: number; saves: number; visits: number }>();
    const bump = (id: string, key: "orders" | "newFollowers" | "saves" | "visits", n: number) => {
      const s = signals.get(id) ?? { orders: 0, newFollowers: 0, saves: 0, visits: 0 };
      s[key] += Number(n) || 0;
      signals.set(id, s);
    };
    orderRows.forEach((r) => bump(r.id, "orders", r.n));
    followRows.forEach((r) => bump(r.id, "newFollowers", r.n));
    saveRows.forEach((r) => bump(r.id, "saves", r.n));
    visitRows.forEach((r) => bump(r.id, "visits", r.n));

    const candidateIds = [...signals.keys()];
    if (candidateIds.length === 0) {
      res.json({ windowDays: TRENDING_WINDOW_DAYS, brands: [] });
      return;
    }
    const sellers = await db
      .select({
        clerkId: users.clerkId,
        displayName: users.displayName,
        brandName: users.brandName,
        brandType: users.brandType,
        profileImageUrl: users.profileImageUrl,
        avatarUrl: users.avatarUrl,
        verified: users.verified,
        verificationStatus: users.verificationStatus,
        activeStanding: users.activeStanding,
        policyRestricted: users.policyRestricted,
      })
      .from(users)
      .where(and(
        inArray(users.clerkId, candidateIds),
        eq(users.accountType, "seller"),
        isNull(users.suspendedAt),
        isNull(users.deletedAt),
        eq(users.policyRestricted, false),
        notBlockedWith(viewerId, users.clerkId),
      ));
    const ranked = rankByScore(
      sellers.map((s) => ({ ...s, id: s.clerkId, score: scoreBrandSignals(signals.get(s.clerkId)!) })),
      limit,
    );
    const rankedIds = ranked.map((r) => r.id);
    const [followerTotals, covers] = rankedIds.length === 0 ? [[], []] : await Promise.all([
      db.select({ id: follows.followingId, n: sql<number>`count(*)::int` })
        .from(follows)
        .where(inArray(follows.followingId, rankedIds))
        .groupBy(follows.followingId),
      db.select({ ownerId: products.ownerId, images: products.images })
        .from(products)
        .where(and(
          inArray(products.ownerId, rankedIds),
          eq(products.status, "active"),
          isNull(products.deletedAt),
          sql`jsonb_array_length(to_jsonb(${products.images})) > 0`,
        ))
        .orderBy(desc(products.createdAt)),
    ]);
    const followerMap = new Map(followerTotals.map((f) => [f.id, Number(f.n)]));
    const coverMap = new Map<string, string>();
    for (const c of covers) {
      if (coverMap.has(c.ownerId)) continue;
      const first = Array.isArray(c.images) ? c.images.find((i): i is string => typeof i === "string" && !!i) : undefined;
      if (first) coverMap.set(c.ownerId, first);
    }
    res.json({
      windowDays: TRENDING_WINDOW_DAYS,
      brands: ranked.map((s) => ({
        id: s.clerkId,
        sellerId: s.clerkId,
        name: s.brandName || s.displayName || "Brand",
        brandType: s.brandType ?? null,
        logoUrl: s.profileImageUrl ?? s.avatarUrl ?? null,
        coverImageUrl: coverMap.get(s.clerkId) ?? null,
        followerCount: followerMap.get(s.clerkId) ?? 0,
        verified: deriveSellerVerified(s),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch trending brands");
    res.status(500).json({ error: "Failed to fetch trending brands" });
  }
});

export default router;
