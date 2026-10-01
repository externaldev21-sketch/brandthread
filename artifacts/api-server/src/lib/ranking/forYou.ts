/**
 * For You ranking pipeline — buyer Threads feed ("for-you"/"mixed" mode) and
 * the personalized slice of Discover.
 *
 * Pipeline shape (owner's rule: content must match each buyer's taste):
 *  1. Cold start: onboarding style picks (`users.buyer_style_interests`) seed
 *     an empty `buyer_taste_profiles` row the first time it's read.
 *  2. Candidate generation: followed sellers, similar-style sellers (style-tag
 *     affinity overlap), trending sellers (today's `seller_ranking_cache`),
 *     fresh uploads (platform-wide recent posts), and active live streams.
 *  3. Scoring: weighted sum of affinity match, recency, trending/seller
 *     strength, followed bonus, and an active-boost bonus, minus a penalty
 *     for sellers/styles the buyer has skipped or marked not-interested.
 *  4. Diversity: no same seller twice in a row, lives interleaved at a fixed
 *     cadence (owner's rule: feed is mostly videos with lives mixed in).
 *  5. Freshness + no-repeat: posts the buyer already saw recently (tracked via
 *     `view` events) are excluded from being re-served.
 *  6. Exploration: a small fixed fraction of slots are reserved for
 *     candidates outside the buyer's top affinity match, so the feed doesn't
 *     collapse into a filter bubble and cold-start / taste-drift recovers.
 *
 * Pure scoring/diversity helpers are exported and unit-tested without a DB;
 * `computeForYouFeedForUser` is the DB-touching orchestration, cached per-user
 * in `for_you_feed_cache` (short TTL) so repeat page requests are a cheap
 * cache read — same idiom as `computeSellerRanking`/`computeTrending`.
 */
import {
  db, posts, users, follows, interactions, boosts, blocks,
  buyerTasteProfiles, sellerRankingCache, forYouFeedCache, liveStreams, buyerPreferences,
  feedNotInterested, savedItems, postComments, postTaggedProducts, productVariants, orderItems, orders,
} from "@workspace/db";
import { eq, and, inArray, gte, sql, desc, ne, isNotNull } from "drizzle-orm";
import { logger } from "../logger";
import {
  DEFAULT_EVENT_WEIGHTS, DEFAULT_RANKING_CONFIG, getRankingConfig, getRankingConfigSync,
  type RankingConfig,
} from "./config";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Seller affinity boost for brands the buyer picked in the onboarding survey (brands they like). */
export const W_LIKED_BRAND = 1.2;
/** Prior weight per survey-picked style interest (mirrors the onboarding cold-start seed). */
export const PREFERENCE_STYLE_SEED = 1.5;

/** Default event weights; the live values come from the tunable ranking config (./config). */
export const EVENT_WEIGHTS: Record<string, number> = DEFAULT_EVENT_WEIGHTS;

const AAFINITY_DECAY = 0.985; // per-event decay applied to the existing weight before adding the new one
const CANDIDATE_POOL_CAP = 400;
const FRESH_UPLOAD_WINDOW_MS = 48 * 60 * 60 * 1000;
const SIMILAR_STYLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FOLLOWED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const RECENCY_HALF_LIFE_MS = DEFAULT_RANKING_CONFIG.recencyHalfLifeHours * 60 * 60 * 1000;
const RECENTLY_SEEN_WINDOW_MS = 20 * 60 * 60 * 1000;
const CACHE_STALE_MS = 6 * 60 * 1000; // 6 minutes — feed should feel fresh, not daily
const LIVE_INTERLEAVE_EVERY = DEFAULT_RANKING_CONFIG.liveInterleaveEvery; // owner's rule: mostly videos, lives mixed in
const EXPLORATION_SLOT_EVERY = DEFAULT_RANKING_CONFIG.explorationEvery;

// ─── Pure helpers (unit-tested without a DB) ─────────────────────────────────

export type AffinityMap = Record<string, number>;

/** Exponential-moving-average affinity update for a single tag/category/seller key. */
export function updateAffinity(current: AffinityMap, key: string, weight: number): AffinityMap {
  if (!key) return current;
  const next = { ...current };
  const decayed = (next[key] ?? 0) * AAFINITY_DECAY;
  next[key] = decayed + weight;
  return next;
}

/** Applies `updateAffinity` for every key in a list (e.g. a post's styleTags), splitting the weight evenly. */
export function updateAffinityForKeys(current: AffinityMap, keys: string[], totalWeight: number): AffinityMap {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (uniqueKeys.length === 0) return current;
  const perKeyWeight = totalWeight / uniqueKeys.length;
  return uniqueKeys.reduce((acc, key) => updateAffinity(acc, key, perKeyWeight), current);
}

/** Effective weight for an ingested event, scaled by `value` for watch_time (expects 0..1 completion fraction). */
export function eventWeight(
  type: string,
  value?: string | null,
  weights: Record<string, number> = getRankingConfigSync().eventWeights,
): number {
  const base = weights[type] ?? 0;
  if (type === "watch_time" && value) {
    const fraction = Number(value);
    if (Number.isFinite(fraction) && fraction > 0) {
      return base * Math.min(1, Math.max(0, fraction)) * 2; // full completion ~= 2x base
    }
  }
  return base;
}

/** Sum of affinity scores for a candidate's tags/category, normalized by tag count so long tag lists don't dominate. */
export function affinityMatchScore(affinity: AffinityMap, keys: string[]): number {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (uniqueKeys.length === 0) return 0;
  const sum = uniqueKeys.reduce((acc, key) => acc + Math.max(0, affinity[key] ?? 0), 0);
  return sum / uniqueKeys.length;
}

/** Negative affinity (skip/not-interested history) for a candidate's tags/seller. */
export function negativeAffinityPenalty(affinity: AffinityMap, keys: string[]): number {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (uniqueKeys.length === 0) return 0;
  const sum = uniqueKeys.reduce((acc, key) => acc + Math.min(0, affinity[key] ?? 0), 0);
  return sum / uniqueKeys.length; // already negative
}

export function applyRecencyDecay(weight: number, ageMs: number, halfLifeMs: number = RECENCY_HALF_LIFE_MS): number {
  if (ageMs <= 0) return weight;
  return weight * Math.pow(0.5, ageMs / halfLifeMs);
}

export type RankingCandidate = {
  id: string;
  sellerId: string;
  createdAt: Date;
  styleTags: string[];
  category?: string | null;
  isFollowed: boolean;
  isBoosted: boolean;
  isLive: boolean;
  sellerScore: number; // 0 if unknown (cold sellers), else today's seller_ranking_cache score
  /** Aggregate community signal for this post over the engagement window (absent for lives / unknown). */
  engagement?: PostEngagementStats;
};

export type PostEngagementStats = {
  views: number;
  /** Mean watch completion 0..1 over watch_time events that carried a fraction; null if none. */
  avgCompletion: number | null;
  likes: number;
  shares: number;
  saves: number;
  purchases: number;
  comments: number;
  reposts: number;
};

/**
 * Bounded 0..1 "engagement quality" for one post. Action rate is smoothed
 * (`views + 10`) so a post with 1 view and 1 like doesn't outrank a proven one,
 * and completion only counts in proportion to how many views back it up.
 */
export function engagementQuality(
  stats: PostEngagementStats | undefined,
  weights: Record<string, number> = getRankingConfigSync().eventWeights,
): number {
  if (!stats) return 0;
  const w = (k: string) => Math.max(0, weights[k] ?? 0);
  const actions =
    stats.likes * w("like") + stats.shares * w("share") + stats.saves * w("save") +
    stats.purchases * w("purchase") + stats.comments * w("comment") + stats.reposts * w("repost");
  const rate = actions / (Math.max(0, stats.views) + 10);
  const rateScore = 1 - Math.exp(-rate * 2);
  const confidence = Math.min(1, Math.max(0, stats.views) / 20);
  const completion = stats.avgCompletion == null ? 0 : Math.min(1, Math.max(0, stats.avgCompletion));
  return Math.min(1, Math.max(0, 0.65 * rateScore + 0.35 * completion * confidence));
}

/**
 * Layers the buyer's saved survey style interests (buyer_preferences) UNDER the
 * learned style affinity: a survey pick only fills in / lifts a tag the buyer's
 * behavior has not yet outgrown (never lowers a learned score, never overrides
 * a negative one caused by skips). Pure + unit-tested.
 */
export function mergePreferenceStyleAffinity(
  learned: AffinityMap,
  styleInterests: string[],
  seed: number = PREFERENCE_STYLE_SEED,
): AffinityMap {
  const keys = [...new Set(styleInterests.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (keys.length === 0) return learned;
  const next = { ...learned };
  for (const key of keys) {
    const current = next[key];
    if (current !== undefined && current < 0) continue;
    next[key] = Math.max(current ?? 0, seed);
  }
  return next;
}

export type ScoredCandidate = RankingCandidate & { score: number };

/** Combines every signal into one score. Exported so tests can assert weighting behavior directly. */
export function scoreCandidate(
  candidate: RankingCandidate,
  categoryAffinity: AffinityMap,
  styleTagAffinity: AffinityMap,
  sellerAffinity: AffinityMap,
  now: number,
  cfg: RankingConfig = getRankingConfigSync(),
  likedBrandIds?: ReadonlySet<string>,
): number {
  const affinity = affinityMatchScore(styleTagAffinity, candidate.styleTags)
    + affinityMatchScore(categoryAffinity, candidate.category ? [candidate.category] : []);
  const penalty = negativeAffinityPenalty(styleTagAffinity, candidate.styleTags)
    + negativeAffinityPenalty(sellerAffinity, [candidate.sellerId]);
  const ageMs = Math.max(0, now - candidate.createdAt.getTime());
  const freshness = applyRecencyDecay(1, ageMs, cfg.recencyHalfLifeHours * 60 * 60 * 1000);
  const sw = cfg.scoreWeights;

  return (
    affinity * sw.affinity +
    freshness * sw.freshness +
    candidate.sellerScore * sw.trending +
    (candidate.isFollowed ? sw.followed : 0) +
    (candidate.isBoosted ? sw.boosted : 0) +
    engagementQuality(candidate.engagement, cfg.eventWeights) * sw.engagement +
    (likedBrandIds?.has(candidate.sellerId) ? W_LIKED_BRAND : 0) +
    penalty
  );
}

/**
 * Diversity + exploration re-rank: greedy pass over a score-sorted list that
 * (a) never places the same seller in two consecutive slots when an
 * alternative exists, (b) interleaves a live stream every `LIVE_INTERLEAVE_EVERY`
 * slots when any are available, and (c) swaps in a lower-ranked "exploration"
 * candidate every `EXPLORATION_SLOT_EVERY` slots so the feed doesn't collapse
 * into a pure filter bubble.
 */
export function diversifyFeed<T extends { sellerId: string; isLive: boolean }>(
  ranked: T[],
  opts: { liveInterleaveEvery?: number; explorationEvery?: number; explorationPool?: T[] } = {},
): T[] {
  const liveEvery = opts.liveInterleaveEvery ?? LIVE_INTERLEAVE_EVERY;
  const explorationEvery = opts.explorationEvery ?? EXPLORATION_SLOT_EVERY;
  const explorationPool = [...(opts.explorationPool ?? [])];

  // Mutable working copies — a rejected-for-this-slot candidate stays in the
  // pool and is reconsidered for the next slot, so nothing is ever dropped.
  const videos = ranked.filter((c) => !c.isLive);
  const lives = ranked.filter((c) => c.isLive);

  /** Index of the first candidate whose seller differs from `lastSeller`, or 0 (repeat unavoidable) if none. */
  const pickNoRepeatIndex = (pool: T[], lastSeller: string | undefined): number => {
    if (pool.length === 0) return -1;
    const idx = pool.findIndex((c) => c.sellerId !== lastSeller);
    return idx === -1 ? 0 : idx;
  };

  const result: T[] = [];
  while (videos.length > 0 || lives.length > 0) {
    const lastSeller = result[result.length - 1]?.sellerId;
    const slot = result.length + 1;

    if (explorationPool.length > 0 && result.length > 0 && slot % explorationEvery === 0) {
      result.push(explorationPool.shift()!);
      continue;
    }
    if (lives.length > 0 && result.length > 0 && slot % liveEvery === 0) {
      result.push(lives.shift()!);
      continue;
    }

    const idx = pickNoRepeatIndex(videos, lastSeller);
    if (idx !== -1) {
      result.push(videos.splice(idx, 1)[0]);
    } else if (lives.length > 0) {
      result.push(lives.shift()!);
    } else {
      break;
    }
  }

  return result;
}

export function isCacheFresh(computedAt: Date, staleMs: number = CACHE_STALE_MS): boolean {
  return Date.now() - computedAt.getTime() < staleMs;
}

// ─── DB orchestration ─────────────────────────────────────────────────────────

export type ForYouResultItem = {
  postId: string;
  sellerId: string;
  createdAt: string;
  isLive: boolean;
  liveStreamId: string | null;
  score: number;
};

type SeededProfile = {
  categoryAffinity: AffinityMap;
  styleTagAffinity: AffinityMap;
  sellerAffinity: AffinityMap;
  likedBrandIds: Set<string>;
};

/** Survey picks saved in buyer_preferences (empty when none / table unavailable). */
async function loadSurveyPreferences(userId: string): Promise<{ styleInterests: string[]; likedBrandIds: string[] }> {
  try {
    const [row] = await db
      .select({ styleInterests: buyerPreferences.styleInterests, likedBrandIds: buyerPreferences.likedBrandIds })
      .from(buyerPreferences)
      .where(eq(buyerPreferences.userId, userId))
      .limit(1);
    return {
      styleInterests: Array.isArray(row?.styleInterests) ? (row!.styleInterests as string[]) : [],
      likedBrandIds: Array.isArray(row?.likedBrandIds) ? (row!.likedBrandIds as string[]) : [],
    };
  } catch (err) {
    logger.warn({ err, userId }, "For You survey preferences read failed; ranking without them");
    return { styleInterests: [], likedBrandIds: [] };
  }
}

async function loadOrSeedProfile(userId: string): Promise<SeededProfile> {
  const [survey, profile] = await Promise.all([loadSurveyPreferences(userId), loadOrSeedBaseProfile(userId)]);
  return {
    ...profile,
    styleTagAffinity: mergePreferenceStyleAffinity(profile.styleTagAffinity, survey.styleInterests),
    likedBrandIds: new Set(survey.likedBrandIds),
  };
}

async function loadOrSeedBaseProfile(userId: string): Promise<{
  categoryAffinity: AffinityMap;
  styleTagAffinity: AffinityMap;
  sellerAffinity: AffinityMap;
}> {
  const [existing] = await db
    .select()
    .from(buyerTasteProfiles)
    .where(eq(buyerTasteProfiles.userId, userId))
    .limit(1);
  if (existing) {
    return {
      categoryAffinity: (existing.categoryAffinity as AffinityMap) ?? {},
      styleTagAffinity: (existing.styleTagAffinity as AffinityMap) ?? {},
      sellerAffinity: (existing.sellerAffinity as AffinityMap) ?? {},
    };
  }

  // Cold start from onboarding style picks.
  const [user] = await db
    .select({ buyerStyleInterests: users.buyerStyleInterests })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  const picks = (user?.buyerStyleInterests as string[] | null) ?? [];
  const styleTagAffinity = updateAffinityForKeys({}, picks.map((p) => p.toLowerCase()), picks.length * 1.5);

  await db.insert(buyerTasteProfiles).values({
    userId,
    styleTagAffinity,
    categoryAffinity: {},
    sellerAffinity: {},
    eventCount: 0,
  }).onConflictDoNothing();

  return { categoryAffinity: {}, styleTagAffinity, sellerAffinity: {} };
}

async function candidatePosts(userId: string, followedIds: string[]): Promise<RankingCandidate[]> {
  const now = new Date();
  const followedSince = new Date(now.getTime() - FOLLOWED_WINDOW_MS);
  const freshSince = new Date(now.getTime() - FRESH_UPLOAD_WINDOW_MS);
  const similarSince = new Date(now.getTime() - SIMILAR_STYLE_WINDOW_MS);

  const [followedPosts, freshPosts, todaysRanking] = await Promise.all([
    followedIds.length === 0 ? Promise.resolve([]) : db
      .select({ id: posts.id, userId: posts.userId, createdAt: posts.createdAt, styleTags: posts.styleTags })
      .from(posts)
      .where(and(
        inArray(posts.userId, followedIds),
        eq(posts.postStatus, "published"),
        gte(posts.createdAt, followedSince),
      ))
      .orderBy(desc(posts.createdAt))
      .limit(150),
    db
      .select({ id: posts.id, userId: posts.userId, createdAt: posts.createdAt, styleTags: posts.styleTags })
      .from(posts)
      .where(and(eq(posts.postStatus, "published"), gte(posts.createdAt, freshSince)))
      .orderBy(desc(posts.createdAt))
      .limit(200),
    db
      .select()
      .from(sellerRankingCache)
      .where(eq(sellerRankingCache.cacheDate, now.toISOString().slice(0, 10)))
      .limit(1),
  ]);

  const sellerScoreById = new Map<string, number>();
  const trendingSellerIds: string[] = [];
  const cacheRow = todaysRanking[0];
  if (cacheRow && Array.isArray(cacheRow.results)) {
    for (const r of cacheRow.results as any[]) {
      if (r?.brandId) {
        sellerScoreById.set(r.brandId, Math.max(sellerScoreById.get(r.brandId) ?? 0, Number(r.sellerScore) || 0));
        trendingSellerIds.push(r.brandId);
      }
    }
  }

  const trendingPosts = trendingSellerIds.length === 0 ? [] : await db
    .select({ id: posts.id, userId: posts.userId, createdAt: posts.createdAt, styleTags: posts.styleTags })
    .from(posts)
    .where(and(
      inArray(posts.userId, [...new Set(trendingSellerIds)].slice(0, 30)),
      eq(posts.postStatus, "published"),
      gte(posts.createdAt, similarSince),
    ))
    .orderBy(desc(posts.createdAt))
    .limit(100);

  const merged = new Map<string, typeof followedPosts[number]>();
  const followedSet = new Set(followedIds);
  for (const p of [...followedPosts, ...trendingPosts, ...freshPosts]) {
    if (!merged.has(p.id)) merged.set(p.id, p);
  }

  const postIds = [...merged.keys()];
  const [boostRows] = await Promise.all([
    postIds.length === 0 ? Promise.resolve([]) : db
      .select({ targetId: boosts.targetId })
      .from(boosts)
      .where(and(
        eq(boosts.targetType, "post"),
        eq(boosts.status, "active"),
        gte(boosts.endsAt, now),
        inArray(boosts.targetId, postIds),
      )),
  ]);
  const boostedIds = new Set(boostRows.map((b) => b.targetId));

  const candidates: RankingCandidate[] = [...merged.values()].map((p) => ({
    id: p.id,
    sellerId: p.userId,
    createdAt: p.createdAt,
    styleTags: Array.isArray(p.styleTags) ? (p.styleTags as string[]) : [],
    isFollowed: followedSet.has(p.userId),
    isBoosted: boostedIds.has(p.id),
    isLive: false,
    sellerScore: sellerScoreById.get(p.userId) ?? 0,
  }));

  return candidates.slice(0, CANDIDATE_POOL_CAP);
}

async function liveCandidates(): Promise<RankingCandidate[]> {
  const rows = await db
    .select({ id: liveStreams.id, sellerId: liveStreams.sellerId, startedAt: liveStreams.startedAt })
    .from(liveStreams)
    .where(eq(liveStreams.status, "live"))
    .orderBy(desc(liveStreams.viewerCount))
    .limit(10);
  return rows.map((r) => ({
    id: r.id,
    sellerId: r.sellerId,
    createdAt: r.startedAt,
    styleTags: [],
    isFollowed: false,
    isBoosted: false,
    isLive: true,
    sellerScore: 0,
  }));
}

const COMPLETION_RE = "^(0(\\.[0-9]+)?|1(\\.0+)?)$";

/**
 * Per-post community signals over the last `windowDays`, for a candidate set.
 * One grouped query over `interactions` plus one each for saves, comments and
 * purchases (order items of products tagged on the post) - never per post.
 */
export async function loadPostEngagement(postIds: string[], windowDays: number): Promise<Map<string, PostEngagementStats>> {
  const out = new Map<string, PostEngagementStats>();
  if (postIds.length === 0) return out;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const get = (id: string) => {
    let v = out.get(id);
    if (!v) {
      v = { views: 0, avgCompletion: null, likes: 0, shares: 0, saves: 0, purchases: 0, comments: 0, reposts: 0 };
      out.set(id, v);
    }
    return v;
  };
  try {
    const [inter, saveRows, commentRows, purchaseRows] = await Promise.all([
      db.select({
        postId: interactions.postId,
        views: sql<number>`count(*) filter (where ${interactions.type} = 'view')`,
        likes: sql<number>`count(*) filter (where ${interactions.type} = 'like')`,
        shares: sql<number>`count(*) filter (where ${interactions.type} = 'share')`,
        reposts: sql<number>`count(*) filter (where ${interactions.type} = 'repost')`,
        avgCompletion: sql<number | null>`avg(${interactions.value}::numeric) filter (where ${interactions.type} = 'watch_time' and ${interactions.value} ~ ${COMPLETION_RE})`,
      })
        .from(interactions)
        .where(and(inArray(interactions.postId, postIds), gte(interactions.createdAt, since)))
        .groupBy(interactions.postId),
      db.select({ postId: savedItems.targetId, n: sql<number>`count(*)` })
        .from(savedItems)
        .where(and(eq(savedItems.itemType, "post"), inArray(savedItems.targetId, postIds), gte(savedItems.createdAt, since)))
        .groupBy(savedItems.targetId),
      db.select({ postId: postComments.postId, n: sql<number>`count(*)` })
        .from(postComments)
        .where(and(inArray(postComments.postId, postIds), eq(postComments.moderationStatus, "visible"), gte(postComments.createdAt, since)))
        .groupBy(postComments.postId),
      db.select({ postId: postTaggedProducts.postId, n: sql<number>`coalesce(sum(${orderItems.quantity}), 0)` })
        .from(postTaggedProducts)
        .innerJoin(productVariants, eq(productVariants.productId, postTaggedProducts.productId))
        .innerJoin(orderItems, eq(orderItems.variantId, productVariants.id))
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(and(
          inArray(postTaggedProducts.postId, postIds),
          isNotNull(orders.paidAt),
          gte(orders.paidAt, since),
          ne(orders.status, "cancelled"),
        ))
        .groupBy(postTaggedProducts.postId),
    ]);
    for (const r of inter) {
      if (!r.postId) continue;
      const v = get(r.postId);
      v.views = Number(r.views) || 0;
      v.likes = Number(r.likes) || 0;
      v.shares = Number(r.shares) || 0;
      v.reposts = Number(r.reposts) || 0;
      v.avgCompletion = r.avgCompletion == null ? null : Number(r.avgCompletion);
    }
    for (const r of saveRows) get(r.postId).saves = Number(r.n) || 0;
    for (const r of commentRows) get(r.postId).comments = Number(r.n) || 0;
    for (const r of purchaseRows) get(r.postId).purchases = Number(r.n) || 0;
  } catch (err) {
    logger.warn({ err }, "For You engagement aggregate failed; scoring without it");
    return new Map();
  }
  return out;
}

async function notInterestedPostIds(userId: string): Promise<Set<string>> {
  const rows = await db.select({ postId: feedNotInterested.postId }).from(feedNotInterested)
    .where(eq(feedNotInterested.userId, userId));
  return new Set(rows.map((r) => r.postId));
}

async function recentlySeenPostIds(userId: string): Promise<Set<string>> {
  const since = new Date(Date.now() - RECENTLY_SEEN_WINDOW_MS);
  const rows = await db
    .select({ postId: interactions.postId })
    .from(interactions)
    .where(and(
      eq(interactions.userId, userId),
      inArray(interactions.type, ["view", "skip", "not_interested"]),
      gte(interactions.createdAt, since),
    ));
  return new Set(rows.map((r) => r.postId).filter((id): id is string => !!id));
}

/** Computes a fresh For You ranking for one buyer and returns the ranked, diversified list (unpaginated). */
export async function computeForYouRankingForUser(userId: string): Promise<ForYouResultItem[]> {
  const now = Date.now();

  const [cfg, hiddenIds, profile, followRows, blockedRows, seenIds] = await Promise.all([
    getRankingConfig(),
    notInterestedPostIds(userId),
    loadOrSeedProfile(userId),
    db.select({ followingId: follows.followingId }).from(follows).where(eq(follows.followerId, userId)),
    db.select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId }).from(blocks)
      .where(sql`${blocks.blockerId} = ${userId} OR ${blocks.blockedId} = ${userId}`),
    recentlySeenPostIds(userId),
  ]);

  const followedIds = followRows.map((r) => r.followingId);
  const blockedSet = new Set(blockedRows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));

  const [posts_, lives] = await Promise.all([candidatePosts(userId, followedIds), liveCandidates()]);

  const eligible = [...posts_, ...lives].filter(
    (c) => !blockedSet.has(c.sellerId) && !seenIds.has(c.id) && !hiddenIds.has(c.id),
  );

  const engagement = await loadPostEngagement(
    eligible.filter((c) => !c.isLive).map((c) => c.id),
    cfg.engagementWindowDays,
  );

  const scored: ScoredCandidate[] = eligible.map((c) => ({
    ...c,
    engagement: engagement.get(c.id),
    score: scoreCandidate(c, profile.categoryAffinity, profile.styleTagAffinity, profile.sellerAffinity, now, cfg, profile.likedBrandIds),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Exploration pool: candidates outside the top slice but not already filtered out.
  const TOP_SLICE = 60;
  const explorationPool = scored.slice(TOP_SLICE).sort(() => Math.random() - 0.5).slice(0, 20);
  const topRanked = scored.slice(0, TOP_SLICE);

  const diversified = diversifyFeed(topRanked, {
    explorationPool,
    liveInterleaveEvery: cfg.liveInterleaveEvery,
    explorationEvery: cfg.explorationEvery,
  });

  return diversified.map((c) => ({
    postId: c.isLive ? "" : c.id,
    sellerId: c.sellerId,
    createdAt: c.createdAt.toISOString(),
    isLive: c.isLive,
    liveStreamId: c.isLive ? c.id : null,
    score: +c.score.toFixed(4),
  }));
}

async function upsertCache(userId: string, results: ForYouResultItem[]): Promise<void> {
  await db.insert(forYouFeedCache).values({
    userId,
    computedAt: new Date(),
    results,
    itemCount: results.length,
  }).onConflictDoUpdate({
    target: forYouFeedCache.userId,
    set: {
      computedAt: sql`excluded.computed_at`,
      results: sql`excluded.results`,
      itemCount: sql`excluded.item_count`,
    },
  });
}

/** Returns the buyer's current For You ranking, recomputing on cache-miss/stale. */
export async function getForYouFeed(userId: string): Promise<ForYouResultItem[]> {
  try {
    const [cached] = await db.select().from(forYouFeedCache).where(eq(forYouFeedCache.userId, userId)).limit(1);
    if (cached && isCacheFresh(cached.computedAt)) {
      return (cached.results as ForYouResultItem[]) ?? [];
    }
  } catch (err) {
    logger.error({ err, userId }, "For You cache read failed; recomputing");
  }

  const results = await computeForYouRankingForUser(userId);
  await upsertCache(userId, results).catch((err) => {
    logger.error({ err, userId }, "For You cache write failed");
  });
  return results;
}

/** Applies one ingested behavioral event to the buyer's taste profile. */
export async function applyEventToProfile(
  userId: string,
  event: { type: string; value?: string | null; styleTags?: string[]; category?: string | null; sellerId?: string | null },
): Promise<void> {
  const cfg = await getRankingConfig();
  const weight = eventWeight(event.type, event.value, cfg.eventWeights);
  if (weight === 0) return;

  const [existing] = await db.select().from(buyerTasteProfiles).where(eq(buyerTasteProfiles.userId, userId)).limit(1);
  const current = existing ?? {
    userId, categoryAffinity: {}, styleTagAffinity: {}, sellerAffinity: {}, eventCount: 0,
  };

  const styleTagAffinity = updateAffinityForKeys(
    (current.styleTagAffinity as AffinityMap) ?? {},
    event.styleTags ?? [],
    weight,
  );
  const categoryAffinity = event.category
    ? updateAffinity((current.categoryAffinity as AffinityMap) ?? {}, event.category, weight)
    : ((current.categoryAffinity as AffinityMap) ?? {});
  const sellerAffinity = event.sellerId
    ? updateAffinity((current.sellerAffinity as AffinityMap) ?? {}, event.sellerId, weight * 0.5)
    : ((current.sellerAffinity as AffinityMap) ?? {});

  await db.insert(buyerTasteProfiles).values({
    userId, categoryAffinity, styleTagAffinity, sellerAffinity, eventCount: 1,
  }).onConflictDoUpdate({
    target: buyerTasteProfiles.userId,
    set: {
      categoryAffinity,
      styleTagAffinity,
      sellerAffinity,
      eventCount: sql`${buyerTasteProfiles.eventCount} + 1`,
      updatedAt: sql`now()`,
    },
  });
}
