/**
 * computeTrending — Daily trending list calculation.
 *
 * Algorithm summary
 * ─────────────────
 * 1. Candidate pool: all seller posts created in the last 48 h (up to 400).
 * 2. Engagement velocity: sum weighted interaction counts from the last 24 h only.
 *    Weights — like:2  comment:3  repost:2.5  shop_click:1.5  watch_time:0.5
 * 3. Normalization: divide raw score by log₂(followerCount+2)+1 so large
 *    established sellers are penalised logarithmically, not linearly.
 * 4. Boost: active paid boosts add up to 30% of the post's own organic score,
 *    hard-capped at 30% of the pool's maximum organic score — so zero-organic
 *    content can never reach the top purely through payment.
 * 5. Seeded jitter: mulberry32 PRNG keyed on hash(postId + dateStr) gives
 *    ±10% variance.  All users see the same list on a given day; it changes
 *    the next day.
 * 6. Category diversity: greedy pick, max 4 items per category; overflow slots
 *    filled from the global ranking to always return RESULT_COUNT items.
 * 7. Result is upserted into trending_cache (one row per calendar day, UTC).
 *
 * Scheduling
 * ──────────
 * startTrendingJob() is called from src/index.ts.
 * It runs once 2 minutes after startup (to warm the cache on fresh deploys),
 * then every 24 h.  The GET /api/public/trending endpoint reads the cache
 * and only calls computeTrendingForToday() as a fallback on cache-miss.
 */

import {
  db, posts, users, interactions, follows,
  postTaggedProducts, products, boosts, trendingCache,
} from "@workspace/db";
import { eq, and, inArray, count, gte, desc, sql } from "drizzle-orm";

// ─── Constants ────────────────────────────────────────────────────────────────

const WEIGHTS: Record<string, number> = {
  like:       2.0,
  comment:    3.0,
  repost:     2.5,
  shop_click: 1.5,
  watch_time: 0.5,
};

const BOOST_SELF_PCT   = 0.30;  // boost adds up to 30% of own organic score
const BOOST_POOL_CAP   = 0.30;  // …but never more than 30% of the pool's top organic
const MAX_PER_CATEGORY = 4;     // diversity cap per category
const CANDIDATE_POOL   = 400;   // score at most this many recent posts
const RESULT_COUNT     = 20;    // final list size
const JITTER_HALF      = 0.10;  // score × [0.90, 1.10]
const WINDOW_24H_MS    = 24 * 60 * 60 * 1000;
const WINDOW_48H_MS    = 48 * 60 * 60 * 1000;
const INTERVAL_24H_MS  = 24 * 60 * 60 * 1000;
const CACHE_STALE_MS   = 25 * 60 * 60 * 1000; // treat cache as stale after 25 h

// Canonical category buckets.  Any unrecognised value falls to 'general'.
const CATEGORY_MAP: Record<string, string> = {
  apparel:    "apparel",
  clothing:   "apparel",
  tops:       "apparel",
  bottoms:    "apparel",
  outerwear:  "apparel",
  footwear:   "footwear",
  shoes:      "footwear",
  sneakers:   "footwear",
  boots:      "footwear",
  accessories:"accessories",
  bags:       "accessories",
  jewellery:  "accessories",
  jewelry:    "accessories",
  hats:       "accessories",
  beauty:     "beauty",
  skincare:   "beauty",
  makeup:     "beauty",
  fragrance:  "beauty",
  home:       "home",
  streetwear: "streetwear",
  vintage:    "vintage",
  thrift:     "vintage",
  activewear: "activewear",
  sportswear: "activewear",
  designer:   "designer",
  luxury:     "designer",
  menswear:   "menswear",
  womenswear: "womenswear",
  unisex:     "apparel",
  y2k:        "streetwear",
  grunge:     "streetwear",
  minimal:    "apparel",
  formal:     "apparel",
};

// ─── PRNG helpers ─────────────────────────────────────────────────────────────

/** Deterministic string → int32 hash (djb2 variant). */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (Math.imul(h, 0x01000193)) >>> 0;
  }
  return h;
}

/** mulberry32 — fast, seedable, good statistical properties. */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Category normalisation ───────────────────────────────────────────────────

function normaliseCategory(raw: string | null | undefined): string {
  if (!raw) return "general";
  const key = raw.toLowerCase().trim();
  return CATEGORY_MAP[key] ?? "general";
}

// ─── Main computation ─────────────────────────────────────────────────────────

export async function computeTrendingForToday(): Promise<void> {
  const now     = new Date();
  const today   = now.toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const since24 = new Date(now.getTime() - WINDOW_24H_MS);
  const since48 = new Date(now.getTime() - WINDOW_48H_MS);

  try {
    // ── 1. Candidate pool: seller posts created in the last 48 h ─────────────
    const recentPosts = await db
      .select({
        id:          posts.id,
        userId:      posts.userId,
        caption:     posts.caption,
        mediaType:   posts.mediaType,
        styleTags:   posts.styleTags,
        createdAt:   posts.createdAt,
        displayName: users.displayName,
        brandName:   users.brandName,
        verified:    users.verified,
      })
      .from(posts)
      .innerJoin(users, and(
        eq(users.clerkId, posts.userId),
        eq(users.accountType, "seller"),
      ))
      .where(gte(posts.createdAt, since48))
      .orderBy(desc(posts.createdAt))
      .limit(CANDIDATE_POOL);

    // If there are no recent posts at all, write an empty cache entry and exit.
    if (recentPosts.length === 0) {
      await upsertCache(today, []);
      console.log(`[computeTrending] No posts in last 48 h — empty cache written for ${today}`);
      return;
    }

    const postIds   = recentPosts.map((p) => p.id);
    const sellerIds = [...new Set(recentPosts.map((p) => p.userId))];

    // ── 2. Follower counts per seller (denominator for normalisation) ─────────
    const followerRows = await db
      .select({ sellerId: follows.followingId, cnt: count() })
      .from(follows)
      .where(inArray(follows.followingId, sellerIds))
      .groupBy(follows.followingId);

    const followerMap = new Map(followerRows.map((r) => [r.sellerId, Number(r.cnt)]));

    // ── 3. Engagement counts by (post, type) in the last 24 h ────────────────
    const TRACKED_TYPES = Object.keys(WEIGHTS);

    const interactionRows = await db
      .select({
        postId: interactions.postId,
        type:   interactions.type,
        cnt:    count(),
      })
      .from(interactions)
      .where(and(
        inArray(interactions.postId, postIds),
        gte(interactions.createdAt, since24),
        inArray(interactions.type, TRACKED_TYPES),
      ))
      .groupBy(interactions.postId, interactions.type);

    // Build: postId → { type → count }
    const engMap: Record<string, Record<string, number>> = {};
    for (const r of interactionRows) {
      if (r.postId === null) continue;
      if (!engMap[r.postId]) engMap[r.postId] = {};
      engMap[r.postId][r.type] = Number(r.cnt);
    }

    // ── 4. Primary category per post (from tagged products, then styleTags) ───
    const tagRows = await db
      .select({
        postId:   postTaggedProducts.postId,
        category: products.category,
      })
      .from(postTaggedProducts)
      .innerJoin(products, eq(products.id, postTaggedProducts.productId))
      .where(inArray(postTaggedProducts.postId, postIds));

    const categoryMap: Record<string, string> = {};
    for (const t of tagRows) {
      // First tagged product wins; subsequent tags for the same post are ignored.
      if (!categoryMap[t.postId]) {
        categoryMap[t.postId] = normaliseCategory(t.category);
      }
    }

    // ── 5. Active boosts for posts in the candidate pool ─────────────────────
    const boostRows = await db
      .select({ targetId: boosts.targetId })
      .from(boosts)
      .where(and(
        eq(boosts.targetType, "post"),
        eq(boosts.status, "active"),
        gte(boosts.endsAt, now),
        inArray(boosts.targetId, postIds),
      ));

    const boostedPostIds = new Set(boostRows.map((b) => b.targetId));

    // ── 6. Score every candidate ──────────────────────────────────────────────
    type ScoredPost = {
      id:           string;
      userId:       string;
      displayName:  string | null;
      brandName:    string | null;
      verified:     boolean | null;
      caption:      string | null;
      mediaType:    string | null;
      category:     string;
      isBoosted:    boolean;
      organicScore: number;
      finalScore:   number;
      likesCount:   number;
      commentsCount:number;
      repostsCount: number;
      shopClicks:   number;
    };

    const scored: ScoredPost[] = recentPosts.map((p) => {
      const eng = engMap[p.id] ?? {};

      // Raw engagement-velocity score (24 h window)
      const rawScore = TRACKED_TYPES.reduce(
        (sum, type) => sum + (eng[type] ?? 0) * WEIGHTS[type],
        0,
      );

      // Normalise by log₂(followerCount + 2) + 1
      // •  0 followers → divisor = log₂(2)+1 = 2.00  (mild discount for very new accts)
      // •  1 k followers → divisor ≈ 11.0
      // • 10 k followers → divisor ≈ 14.3
      // • 100 k followers → divisor ≈ 17.6
      const followers     = followerMap.get(p.userId) ?? 0;
      const divisor       = Math.log2(followers + 2) + 1;
      const organicScore  = rawScore / divisor;

      // Category: tagged product first, then post's own styleTags, then general
      const styleTagsArr = (p.styleTags as string[] | null) ?? [];
      const category     = categoryMap[p.id]
        ?? normaliseCategory(styleTagsArr[0])
        ?? "general";

      return {
        id:           p.id,
        userId:       p.userId,
        displayName:  p.displayName ?? null,
        brandName:    p.brandName ?? null,
        verified:     p.verified ?? null,
        caption:      p.caption ?? null,
        mediaType:    p.mediaType ?? null,
        category,
        isBoosted:    boostedPostIds.has(p.id),
        organicScore,
        finalScore:   organicScore, // refined below
        likesCount:   eng["like"]       ?? 0,
        commentsCount:eng["comment"]    ?? 0,
        repostsCount: eng["repost"]     ?? 0,
        shopClicks:   eng["shop_click"] ?? 0,
      };
    });

    // ── 7. Apply boost (capped so payment can't fully override organic signal) ─
    const maxOrganic   = Math.max(...scored.map((s) => s.organicScore), 0.001);
    const poolCapLift  = maxOrganic * BOOST_POOL_CAP;

    for (const s of scored) {
      if (!s.isBoosted) continue;
      // Boost can add at most BOOST_SELF_PCT of the post's OWN organic score,
      // further capped at BOOST_POOL_CAP of the pool-wide maximum.
      const selfLift    = s.organicScore * BOOST_SELF_PCT;
      const boostAmount = Math.min(selfLift, poolCapLift);
      s.finalScore      = s.organicScore + boostAmount;
    }

    // ── 8. Seeded jitter — ±JITTER_HALF%, deterministic per (post, day) ──────
    for (const s of scored) {
      const seed     = hashStr(s.id + today);
      const rng      = mulberry32(seed);
      const jitter   = (1 - JITTER_HALF) + rng() * JITTER_HALF * 2;
      s.finalScore  *= jitter;
    }

    // ── 9. Sort descending by finalScore ─────────────────────────────────────
    scored.sort((a, b) => b.finalScore - a.finalScore || b.organicScore - a.organicScore);

    // ── 10. Category diversity — greedy pick, max MAX_PER_CATEGORY per bucket ─
    const categoryCounts: Record<string, number> = {};
    const diverse: ScoredPost[]                  = [];

    for (const item of scored) {
      const cat = item.category;
      categoryCounts[cat] = (categoryCounts[cat] ?? 0);
      if (categoryCounts[cat] >= MAX_PER_CATEGORY) continue;
      categoryCounts[cat]++;
      diverse.push(item);
      if (diverse.length >= RESULT_COUNT) break;
    }

    // Fill any remaining slots (category caps caused a shortfall) from global ranking
    if (diverse.length < RESULT_COUNT) {
      const usedIds = new Set(diverse.map((d) => d.id));
      for (const item of scored) {
        if (usedIds.has(item.id)) continue;
        diverse.push(item);
        if (diverse.length >= RESULT_COUNT) break;
      }
    }

    // ── 11. Shape final output ────────────────────────────────────────────────
    const hypeLabel = (score: number): string => {
      if (score >= 4)   return "🔥 Hot";
      if (score >= 1.5) return "⚡ Rising";
      if (score >= 0.4) return "⏳ Gaining";
      return "✨ Fresh";
    };

    const results = diverse.slice(0, RESULT_COUNT).map((item, i) => ({
      rank:          i + 1,
      id:            item.id,
      brand:         item.brandName ?? item.displayName ?? "Brand",
      brandId:       item.userId,
      caption:       item.caption,
      mediaType:     item.mediaType,
      verified:      item.verified ?? false,
      category:      item.category,
      boosted:       item.isBoosted,
      // Expose normalised scores (useful for debugging, hidden from UI hype label)
      organicScore:  +item.organicScore.toFixed(4),
      finalScore:    +item.finalScore.toFixed(4),
      likesCount:    item.likesCount,
      commentsCount: item.commentsCount,
      repostsCount:  item.repostsCount,
      shopClicks:    item.shopClicks,
      hype:          hypeLabel(item.finalScore),
    }));

    // ── 12. Upsert into trending_cache ────────────────────────────────────────
    await upsertCache(today, results);
    console.log(
      `[computeTrending] ${results.length} items cached for ${today}` +
      ` (pool=${recentPosts.length}, boosted=${boostedPostIds.size})`,
    );
  } catch (err) {
    console.error("[computeTrending] Error:", err);
    // Do not rethrow — a failed computation shouldn't crash the server.
  }
}

// ─── Cache writer ─────────────────────────────────────────────────────────────

async function upsertCache(date: string, results: any[]): Promise<void> {
  await db
    .insert(trendingCache)
    .values({
      cacheDate:  date,
      computedAt: new Date(),
      results,
      itemCount:  results.length,
    })
    .onConflictDoUpdate({
      target: trendingCache.cacheDate,
      set: {
        computedAt: sql`excluded.computed_at`,
        results:    sql`excluded.results`,
        itemCount:  sql`excluded.item_count`,
      },
    });
}

// ─── Freshness helper (used by the route) ────────────────────────────────────

/**
 * Returns true if a cached row is recent enough to serve without recomputing.
 * Allows up to 25 h of age so DST transitions don't leave a gap.
 */
export function isCacheFresh(computedAt: Date): boolean {
  return Date.now() - computedAt.getTime() < CACHE_STALE_MS;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export function startTrendingJob(): void {
  // Run 2 minutes after startup (warms the cache on fresh deploys / restarts).
  setTimeout(() => computeTrendingForToday(), 2 * 60 * 1000);

  // Then recompute every 24 h.
  setInterval(() => computeTrendingForToday(), INTERVAL_24H_MS);

  console.log("[computeTrending] Job scheduled (runs every 24 h, first run in 2 min)");
}
