/**
 * computeSellerRanking — Daily Discover seller-ranking calculation.
 *
 * Algorithm summary
 * ─────────────────
 * 1. Candidate pool: sellers (`accountType` seller|both) with at least one
 *    active, non-deleted product AND at least one post in the last 72 h OR
 *    at least one tagged-product interaction (a `shop_click`) in that same
 *    window — the point is "any recent feed presence", not both signals.
 * 2. Engagement aggregation (72 h window): weighted interaction counts,
 *    attributed to the post's author for post-level types (like, comment,
 *    repost, view, watch_time, share) and to the *tagged product's owner*
 *    for `shop_click` (a buyer tapping through to a product from someone
 *    else's post should credit that product's seller, not the poster).
 *    `saved_items` rows (the existing wishlist table — no need for a
 *    parallel "save" event, see the note below `WEIGHTS`) contribute a
 *    "save" signal attributed to the saved product's owner.
 * 3. Recency decay: each raw event is weighted by
 *    `applyRecencyDecay(weight, ageMs, RECENCY_HALF_LIFE_MS)` before being
 *    summed, so an interaction from minutes ago outweighs one from just
 *    inside the window's edge.
 * 4. Normalization: `computeSellerScore` divides by log₂(followerCount+2)+1,
 *    identical in shape to computeTrending's post-level normalization, so
 *    small/new sellers aren't structurally locked out.
 * 5. Rotation bonus: `applyRotationBonus` boosts sellers who were absent (or
 *    ranked outside the top) from *yesterday's* cache, so the same brands
 *    don't dominate Discover every single day.
 * 6. Cold start: if the candidate pool is too small or has near-zero total
 *    engagement, `selectColdStartFallback` swaps in the newest active-product
 *    sellers so Discover is never empty on a fresh environment.
 * 7. Per-brand cap: `pickTopProductsPerSeller` selects each ranked seller's
 *    best 2 eligible products (demandCount, then recency) — out-of-stock,
 *    inactive/deleted, and reported products are excluded before this step.
 * 8. Result is upserted into `seller_ranking_cache` (one row per calendar
 *    day, UTC), mirroring `trending_cache`'s upsert shape exactly.
 *
 * Scheduling
 * ──────────
 * startSellerRankingJob() is called from src/index.ts. It runs once 2
 * minutes after startup (to warm the cache on fresh deploys), then every
 * 24 h. GET /api/public/discover/feed reads the cache and only calls
 * computeSellerRankingForToday() as a fallback on cache-miss.
 *
 * Engagement coverage note
 * ─────────────────────────
 * Grepping `interactions` insert call sites (see posts.ts `/:id/interact`)
 * showed `like`, `repost`, `view`, `watch_time`, and `shop_click` were
 * already tracked. Two real gaps existed for Discover:
 *   - "product taps" (tapping through to a product from the feed) — this
 *     turned out to already be exactly what `shop_click` records, so no new
 *     tracking was needed there.
 *   - "shares" — nothing recorded a buyer sharing a post out of the app.
 *     Added `type: "share"` to the same `/:id/interact` endpoint (see
 *     posts.ts), recorded the same non-idempotent way as view/watch_time.
 *   - "saves" — already tracked, but in the dedicated `saved_items` table
 *     (see routes/saved.ts), not `interactions`. Rather than dual-write a
 *     duplicate `interactions` row (a parallel event table for the same
 *     fact), this job reads `saved_items` directly for the save signal.
 */

import {
  db, posts, users, interactions, follows, savedItems,
  postTaggedProducts, products, productVariants, reports,
  sellerRankingCache,
} from "@workspace/db";
import { eq, and, inArray, count, gte, sql, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Weighted per-type contribution of a single interaction event. */
const WEIGHTS: Record<string, number> = {
  view:       0.3,
  watch_time: 0.5,
  like:       2.0,
  comment:    3.0,
  repost:     2.5,
  share:      4.0,
  shop_click: 2.5, // "product tap" — tapping through to a product from the feed
  save:       3.0, // sourced from saved_items, not interactions (see module doc)
};

const WINDOW_MS               = 72 * 60 * 60 * 1000; // 72 h candidate + aggregation window
const RECENCY_HALF_LIFE_MS    = 30 * 60 * 60 * 1000; // ~30 h half-life within the 24-36h range
const ACTIVITY_HALF_LIFE_MS   = 48 * 60 * 60 * 1000; // seller-level "how stale is their newest signal"
const ROTATION_BONUS_PCT      = 0.15;                // full bonus for sellers absent from yesterday's cache
const ROTATION_PARTIAL_PCT    = 0.075;                // partial bonus for a low (non-top) returnee
const ROTATION_TOP_N          = 5;                   // "dominated yesterday" cutoff
const PRODUCTS_PER_SELLER_CAP = 2;
const RESULT_SELLER_COUNT     = 20;                  // how many sellers make the final list
const MIN_CANDIDATE_POOL      = 3;                    // below this, fall back to cold start
const MIN_TOTAL_ENGAGEMENT    = 1e-6;                 // near-zero total engagement -> cold start
const COLD_START_POOL         = 20;
const CACHE_STALE_MS          = 25 * 60 * 60 * 1000; // treat cache as stale after 25 h
const INTERVAL_24H_MS         = 24 * 60 * 60 * 1000;

// ─── Pure scoring helpers (unit-tested without a DB) ─────────────────────────

/**
 * Exponential recency decay. `eventAgeMs <= 0` returns the weight unchanged
 * (defensive against clock skew); otherwise the weight halves every
 * `halfLifeMs`.
 */
export function applyRecencyDecay(
  weight: number,
  eventAgeMs: number,
  halfLifeMs: number = RECENCY_HALF_LIFE_MS,
): number {
  if (eventAgeMs <= 0) return weight;
  const halfLives = eventAgeMs / halfLifeMs;
  return weight * Math.pow(0.5, halfLives);
}

/**
 * Normalizes a seller's already decay-weighted, per-type engagement sums by
 * follower count (log₂(followers+2)+1 — identical shape to computeTrending's
 * post-level normalization), then applies a mild extra penalty for sellers
 * whose most recent recorded signal (`ageMs`) is stale relative to the
 * window: the multiplier floors at 0.5 so a seller with zero *recent* signal
 * but real recent-ish activity isn't zeroed out outright (that's what
 * cold-start fallback and the candidate-pool gate are for).
 */
export function computeSellerScore(
  engagementByType: Record<string, number>,
  followerCount: number,
  ageMs: number,
): number {
  const rawScore = Object.values(engagementByType).reduce((sum, v) => sum + v, 0);
  const divisor  = Math.log2(Math.max(0, followerCount) + 2) + 1;
  const organic  = rawScore / divisor;
  const activityMultiplier = 0.5 + 0.5 * applyRecencyDecay(1, Math.max(0, ageMs), ACTIVITY_HALF_LIFE_MS);
  return organic * activityMultiplier;
}

/**
 * Rotation/freshness bonus: a seller absent from yesterday's cached ranking
 * gets the full bonus; one that was present but ranked outside the top gets
 * a partial bonus; one that dominated yesterday's top gets none, so the same
 * brands don't camp Discover day after day.
 */
export function applyRotationBonus(
  currentScore: number,
  wasInYesterdaysTop: boolean,
  yesterdayRank: number | null,
): number {
  if (!wasInYesterdaysTop) return currentScore * (1 + ROTATION_BONUS_PCT);
  if (yesterdayRank !== null && yesterdayRank <= ROTATION_TOP_N) return currentScore;
  return currentScore * (1 + ROTATION_PARTIAL_PCT);
}

export type CandidateProduct = {
  id: string;
  demandCount: number;
  createdAt: Date;
};

/**
 * Picks a seller's best `cap` eligible products: highest `demandCount` first,
 * ties broken by newest. Callers are expected to have already excluded
 * inactive/deleted/out-of-stock/reported products.
 */
export function pickTopProductsPerSeller<T extends CandidateProduct>(
  productsForSeller: T[],
  cap: number = PRODUCTS_PER_SELLER_CAP,
): T[] {
  return [...productsForSeller]
    .sort((a, b) => (b.demandCount - a.demandCount) || (b.createdAt.getTime() - a.createdAt.getTime()))
    .slice(0, cap);
}

export type ColdStartSeller = {
  sellerId: string;
  hasActiveProduct: boolean;
  createdAt: Date;
};

/**
 * Cold-start fallback: when there isn't enough real engagement data (too few
 * candidate sellers, or the pool's total engagement is ~0), Discover falls
 * back to the newest active-product sellers so it's never empty on a fresh
 * environment.
 */
export function selectColdStartFallback(
  sellers: ColdStartSeller[],
  poolSize: number = COLD_START_POOL,
): ColdStartSeller[] {
  return sellers
    .filter((s) => s.hasActiveProduct)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, poolSize);
}

/** True when the candidate pool is too thin or has essentially no engagement. */
export function needsColdStartFallback(candidateCount: number, totalEngagement: number): boolean {
  return candidateCount < MIN_CANDIDATE_POOL || totalEngagement < MIN_TOTAL_ENGAGEMENT;
}

// ─── Main computation ─────────────────────────────────────────────────────────

type SellerResultRow = {
  rank: number;
  productId: string;
  brandId: string;
  brandName: string;
  brandVerified: boolean;
  productName: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  images: string[];
  category: string;
  sellerScore: number;
};

export async function computeSellerRankingForToday(): Promise<void> {
  const now      = new Date();
  const today    = now.toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const yesterday = new Date(now.getTime() - INTERVAL_24H_MS).toISOString().slice(0, 10);
  const since    = new Date(now.getTime() - WINDOW_MS);

  try {
    // ── 1. Sellers with at least one active, non-deleted product ────────────
    const activeProductOwners = await db
      .select({ ownerId: products.ownerId })
      .from(products)
      .where(and(eq(products.status, "active"), isNull(products.deletedAt)))
      .groupBy(products.ownerId);
    const activeProductOwnerSet = new Set(activeProductOwners.map((r) => r.ownerId));

    if (activeProductOwnerSet.size === 0) {
      await upsertCache(today, []);
      logger.info({ job: "computeSellerRanking", cacheDate: today }, "Empty seller ranking cache written (no active-product sellers)");
      return;
    }

    const sellerRows = await db
      .select({
        clerkId:     users.clerkId,
        displayName: users.displayName,
        brandName:   users.brandName,
        verified:    users.verified,
        createdAt:   users.createdAt,
        accountType: users.accountType,
      })
      .from(users)
      .where(and(
        inArray(users.accountType, ["seller", "both"]),
        isNull(users.deletedAt),
        inArray(users.clerkId, [...activeProductOwnerSet]),
      ));
    const sellerMap = new Map(sellerRows.map((s) => [s.clerkId, s]));

    // ── 2. Recent posts (72 h) by these sellers ──────────────────────────────
    const recentPosts = await db
      .select({ id: posts.id, userId: posts.userId, createdAt: posts.createdAt })
      .from(posts)
      .where(and(
        gte(posts.createdAt, since),
        inArray(posts.userId, [...sellerMap.keys()]),
      ));

    const postIdToSeller = new Map(recentPosts.map((p) => [p.id, p.userId]));
    const postIdToCreatedAt = new Map(recentPosts.map((p) => [p.id, p.createdAt]));
    const sellersWithRecentPost = new Set(recentPosts.map((p) => p.userId));
    const allRecentPostIds = recentPosts.map((p) => p.id);

    // ── 3. Post-level interactions (like/comment/repost/view/watch_time/share)
    //      on those recent posts, in the same window ─────────────────────────
    const POST_LEVEL_TYPES = ["like", "comment", "repost", "view", "watch_time", "share"];
    const postLevelRows = allRecentPostIds.length === 0 ? [] : await db
      .select({
        postId:    interactions.postId,
        type:      interactions.type,
        createdAt: interactions.createdAt,
      })
      .from(interactions)
      .where(and(
        inArray(interactions.postId, allRecentPostIds),
        gte(interactions.createdAt, since),
        inArray(interactions.type, POST_LEVEL_TYPES),
      ));

    // ── 4. shop_click ("product tap") events in the window, attributed to
    //      the TAGGED PRODUCT's owner (not necessarily the post's author) ────
    const shopClickRows = await db
      .select({
        postId:    interactions.postId,
        createdAt: interactions.createdAt,
        productId: postTaggedProducts.productId,
        ownerId:   products.ownerId,
      })
      .from(interactions)
      .innerJoin(postTaggedProducts, eq(postTaggedProducts.postId, interactions.postId))
      .innerJoin(products, eq(products.id, postTaggedProducts.productId))
      .where(and(
        eq(interactions.type, "shop_click"),
        gte(interactions.createdAt, since),
        inArray(products.ownerId, [...sellerMap.keys()]),
      ));

    const sellersWithProductTap = new Set(shopClickRows.map((r) => r.ownerId));

    // ── 5. Saves (saved_items, not interactions — see module doc) attributed
    //      to the saved product's owner ───────────────────────────────────────
    const saveRows = await db
      .select({
        productId: savedItems.targetId,
        createdAt: savedItems.createdAt,
        ownerId:   products.ownerId,
      })
      .from(savedItems)
      .innerJoin(products, eq(products.id, savedItems.targetId))
      .where(and(
        eq(savedItems.itemType, "product"),
        gte(savedItems.createdAt, since),
        inArray(products.ownerId, [...sellerMap.keys()]),
      ));

    // ── 6. Candidate pool: active-product sellers with recent feed presence ──
    const candidateSellerIds = [...sellerMap.keys()].filter(
      (id) => sellersWithRecentPost.has(id) || sellersWithProductTap.has(id),
    );

    // ── 7. Follower counts (denominator for normalization) ───────────────────
    const followerRows = candidateSellerIds.length === 0 ? [] : await db
      .select({ sellerId: follows.followingId, cnt: count() })
      .from(follows)
      .where(inArray(follows.followingId, candidateSellerIds))
      .groupBy(follows.followingId);
    const followerMap = new Map(followerRows.map((r) => [r.sellerId, Number(r.cnt)]));

    // ── 8. Aggregate decayed, weighted engagement per seller ──────────────────
    const engagementByType: Record<string, Record<string, number>> = {};
    const lastActivityAtMs: Record<string, number> = {};

    const bump = (sellerId: string, type: string, weight: number, eventTime: Date) => {
      if (!candidateSellerIds.includes(sellerId)) return;
      const ageMs   = Math.max(0, now.getTime() - eventTime.getTime());
      const decayed = applyRecencyDecay(weight, ageMs, RECENCY_HALF_LIFE_MS);
      engagementByType[sellerId] ??= {};
      engagementByType[sellerId][type] = (engagementByType[sellerId][type] ?? 0) + decayed;
      lastActivityAtMs[sellerId] = Math.max(lastActivityAtMs[sellerId] ?? 0, eventTime.getTime());
    };

    for (const row of postLevelRows) {
      if (row.postId === null) continue;
      const sellerId = postIdToSeller.get(row.postId);
      if (!sellerId) continue;
      bump(sellerId, row.type, WEIGHTS[row.type] ?? 0, row.createdAt);
    }
    for (const p of recentPosts) {
      // A post's own creation counts as a minimal presence signal so a brand
      // that posted but got zero engagement still registers above zero.
      lastActivityAtMs[p.userId] = Math.max(lastActivityAtMs[p.userId] ?? 0, p.createdAt.getTime());
    }
    for (const row of shopClickRows) {
      bump(row.ownerId, "shop_click", WEIGHTS.shop_click, row.createdAt);
    }
    for (const row of saveRows) {
      bump(row.ownerId, "save", WEIGHTS.save, row.createdAt);
    }

    // ── 9. Score each candidate, then apply the rotation/freshness bonus ─────
    const [yesterdayCache] = await db
      .select()
      .from(sellerRankingCache)
      .where(eq(sellerRankingCache.cacheDate, yesterday))
      .limit(1);

    const yesterdayRankBySeller = new Map<string, number>();
    if (yesterdayCache && Array.isArray(yesterdayCache.results)) {
      for (const r of yesterdayCache.results as any[]) {
        if (r?.brandId && !yesterdayRankBySeller.has(r.brandId)) {
          yesterdayRankBySeller.set(r.brandId, r.rank);
        }
      }
    }

    let totalEngagement = 0;
    const scoredSellers = candidateSellerIds.map((sellerId) => {
      const eng = engagementByType[sellerId] ?? {};
      const followers = followerMap.get(sellerId) ?? 0;
      const ageMs = Math.max(0, now.getTime() - (lastActivityAtMs[sellerId] ?? 0));
      const baseScore = computeSellerScore(eng, followers, ageMs);
      const yesterdayRank = yesterdayRankBySeller.get(sellerId) ?? null;
      const finalScore = applyRotationBonus(baseScore, yesterdayRank === null, yesterdayRank);
      totalEngagement += Object.values(eng).reduce((s, v) => s + v, 0);
      return { sellerId, score: finalScore };
    });

    // ── 10. Cold start when the real pool is too thin ────────────────────────
    let rankedSellerIds: string[];
    if (needsColdStartFallback(candidateSellerIds.length, totalEngagement)) {
      const coldStartCandidates: ColdStartSeller[] = sellerRows.map((s) => ({
        sellerId: s.clerkId,
        hasActiveProduct: true, // already filtered to active-product owners above
        createdAt: s.createdAt,
      }));
      rankedSellerIds = selectColdStartFallback(coldStartCandidates, COLD_START_POOL).map((s) => s.sellerId);
      logger.info({ job: "computeSellerRanking", cacheDate: today, candidateCount: candidateSellerIds.length, totalEngagement },
        "Seller ranking pool too thin; using cold-start fallback");
    } else {
      rankedSellerIds = scoredSellers
        .sort((a, b) => b.score - a.score)
        .slice(0, RESULT_SELLER_COUNT)
        .map((s) => s.sellerId);
    }

    if (rankedSellerIds.length === 0) {
      await upsertCache(today, []);
      logger.info({ job: "computeSellerRanking", cacheDate: today }, "Empty seller ranking cache written");
      return;
    }

    const scoreBySeller = new Map(scoredSellers.map((s) => [s.sellerId, s.score]));

    // ── 11. Eligible products for the ranked sellers ─────────────────────────
    const candidateProducts = await db
      .select({
        id:          products.id,
        ownerId:     products.ownerId,
        name:        products.name,
        category:    products.category,
        images:      products.images,
        demandCount: products.demandCount,
        createdAt:   products.createdAt,
      })
      .from(products)
      .where(and(
        eq(products.status, "active"),
        isNull(products.deletedAt),
        inArray(products.ownerId, rankedSellerIds),
      ));

    const productIds = candidateProducts.map((p) => p.id);

    const [variantRows, reportedRows] = await Promise.all([
      productIds.length === 0 ? [] : db
        .select({ productId: productVariants.productId, priceCents: productVariants.priceCents, stock: productVariants.stock })
        .from(productVariants)
        .where(inArray(productVariants.productId, productIds)),
      productIds.length === 0 ? [] : db
        .select({ targetId: reports.targetId })
        .from(reports)
        .where(and(
          eq(reports.targetType, "product"),
          inArray(reports.targetId, productIds),
          inArray(reports.status, ["pending", "actioned"]),
        )),
    ]);

    const inStockPriceByProduct = new Map<string, number>();
    for (const v of variantRows) {
      if (v.stock > 0) {
        const current = inStockPriceByProduct.get(v.productId);
        if (current === undefined || v.priceCents < current) {
          inStockPriceByProduct.set(v.productId, v.priceCents);
        }
      }
    }
    const reportedProductIds = new Set(reportedRows.map((r) => r.targetId));

    const eligibleByProductOwner = new Map<string, CandidateProduct[]>();
    const detailByProductId = new Map<string, typeof candidateProducts[number]>();
    for (const p of candidateProducts) {
      if (reportedProductIds.has(p.id)) continue;         // excluded: reported
      if (!inStockPriceByProduct.has(p.id)) continue;      // excluded: out of stock
      detailByProductId.set(p.id, p);
      const list = eligibleByProductOwner.get(p.ownerId) ?? [];
      list.push({ id: p.id, demandCount: p.demandCount, createdAt: p.createdAt });
      eligibleByProductOwner.set(p.ownerId, list);
    }

    // ── 12. Cap 2 products per seller, flatten into the final list ──────────
    const flattened: Array<{ sellerId: string; productId: string; score: number }> = [];
    for (const sellerId of rankedSellerIds) {
      const list = eligibleByProductOwner.get(sellerId) ?? [];
      const top = pickTopProductsPerSeller(list, PRODUCTS_PER_SELLER_CAP);
      const score = scoreBySeller.get(sellerId) ?? 0;
      for (const product of top) {
        flattened.push({ sellerId, productId: product.id, score });
      }
    }

    // Sellers are already ranked; within a seller, product order came from
    // pickTopProductsPerSeller. Sort stably by seller score (desc) to produce
    // the final rank.
    flattened.sort((a, b) => b.score - a.score);

    const results: SellerResultRow[] = flattened.map((entry, i) => {
      const seller  = sellerMap.get(entry.sellerId)!;
      const product = detailByProductId.get(entry.productId)!;
      return {
        rank:          i + 1,
        productId:     product.id,
        brandId:       entry.sellerId,
        brandName:     seller.brandName ?? seller.displayName ?? "Brand",
        brandVerified: seller.verified ?? false,
        productName:   product.name,
        priceCents:    inStockPriceByProduct.get(product.id) ?? 0,
        compareAtPriceCents: null, // productVariants has no compare-at price column today
        images:        (product.images as string[] | null) ?? [],
        category:      product.category,
        sellerScore:   +entry.score.toFixed(4),
      };
    });

    await upsertCache(today, results);
    logger.info({
      job: "computeSellerRanking",
      cacheDate: today,
      itemCount: results.length,
      candidateSellerCount: candidateSellerIds.length,
      rankedSellerCount: rankedSellerIds.length,
      coldStart: needsColdStartFallback(candidateSellerIds.length, totalEngagement),
    }, "Seller ranking cache written");
  } catch (err) {
    logger.error({ err, job: "computeSellerRanking" }, "Seller ranking computation failed");
    // Do not rethrow — a failed computation shouldn't crash the server.
  }
}

// ─── Cache writer ─────────────────────────────────────────────────────────────

async function upsertCache(date: string, results: any[]): Promise<void> {
  await db
    .insert(sellerRankingCache)
    .values({
      cacheDate:  date,
      computedAt: new Date(),
      results,
      itemCount:  results.length,
    })
    .onConflictDoUpdate({
      target: sellerRankingCache.cacheDate,
      set: {
        computedAt: sql`excluded.computed_at`,
        results:    sql`excluded.results`,
        itemCount:  sql`excluded.item_count`,
      },
    });
}

// ─── Freshness helper (used by the route) ────────────────────────────────────

/** Returns true if a cached row is recent enough to serve without recomputing. */
export function isSellerRankingCacheFresh(computedAt: Date): boolean {
  return Date.now() - computedAt.getTime() < CACHE_STALE_MS;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export function startSellerRankingJob(): void {
  // Run 2 minutes after startup (warms the cache on fresh deploys / restarts).
  setTimeout(() => computeSellerRankingForToday(), 2 * 60 * 1000);

  // Then recompute every 24 h.
  setInterval(() => computeSellerRankingForToday(), INTERVAL_24H_MS);

  logger.info(
    { job: "computeSellerRanking", intervalMs: INTERVAL_24H_MS, initialDelayMs: 2 * 60 * 1000 },
    "Seller ranking job scheduled",
  );
}
