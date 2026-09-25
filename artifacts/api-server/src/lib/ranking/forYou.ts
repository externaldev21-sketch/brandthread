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
  buyerTasteProfiles, sellerRankingCache, forYouFeedCache, liveStreams,
} from "@workspace/db";
import { eq, and, inArray, gte, sql, desc } from "drizzle-orm";
import { logger } from "../logger";

// ─── Constants ────────────────────────────────────────────────────────────────

export const EVENT_WEIGHTS: Record<string, number> = {
  view:            0.15,
  watch_time:      0.35, // scaled further by completion fraction when `value` is a 0..1 fraction
  rewatch:         1.0,
  like:            1.5,
  save:            2.0,
  repost:          1.8,
  share:           2.2,
  comment:         1.8,
  shop_click:      1.6,
  add_to_bag:      2.5,
  purchase:        4.0,
  follow:          2.0,
  skip:           -0.6,
  not_interested: -3.0,
};

const AAFINITY_DECAY = 0.985; // per-event decay applied to the existing weight before adding the new one
const CANDIDATE_POOL_CAP = 400;
const FRESH_UPLOAD_WINDOW_MS = 48 * 60 * 60 * 1000;
const SIMILAR_STYLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FOLLOWED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const RECENCY_HALF_LIFE_MS = 18 * 60 * 60 * 1000;
const RECENTLY_SEEN_WINDOW_MS = 20 * 60 * 60 * 1000;
const CACHE_STALE_MS = 6 * 60 * 1000; // 6 minutes — feed should feel fresh, not daily
const LIVE_INTERLEAVE_EVERY = 6; // owner's rule: mostly videos, lives mixed in
const EXPLORATION_SLOT_EVERY = 8;

const W_AFFINITY   = 3.0;
const W_FRESHNESS  = 1.5;
const W_TRENDING   = 1.2;
const W_FOLLOWED   = 1.0;
const W_BOOSTED    = 2.0;

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
export function eventWeight(type: string, value?: string | null): number {
  const base = EVENT_WEIGHTS[type] ?? 0;
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
};

export type ScoredCandidate = RankingCandidate & { score: number };

/** Combines every signal into one score. Exported so tests can assert weighting behavior directly. */
export function scoreCandidate(
  candidate: RankingCandidate,
  categoryAffinity: AffinityMap,
  styleTagAffinity: AffinityMap,
  sellerAffinity: AffinityMap,
  now: number,
): number {
  const affinity = affinityMatchScore(styleTagAffinity, candidate.styleTags)
    + affinityMatchScore(categoryAffinity, candidate.category ? [candidate.category] : []);
  const penalty = negativeAffinityPenalty(styleTagAffinity, candidate.styleTags)
    + negativeAffinityPenalty(sellerAffinity, [candidate.sellerId]);
  const ageMs = Math.max(0, now - candidate.createdAt.getTime());
  const freshness = applyRecencyDecay(1, ageMs);

  return (
    affinity * W_AFFINITY +
    freshness * W_FRESHNESS +
    candidate.sellerScore * W_TRENDING +
    (candidate.isFollowed ? W_FOLLOWED : 0) +
    (candidate.isBoosted ? W_BOOSTED : 0) +
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

async function loadOrSeedProfile(userId: string): Promise<{
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

  const [profile, followRows, blockedRows, seenIds] = await Promise.all([
    loadOrSeedProfile(userId),
    db.select({ followingId: follows.followingId }).from(follows).where(eq(follows.followerId, userId)),
    db.select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId }).from(blocks)
      .where(sql`${blocks.blockerId} = ${userId} OR ${blocks.blockedId} = ${userId}`),
    recentlySeenPostIds(userId),
  ]);

  const followedIds = followRows.map((r) => r.followingId);
  const blockedSet = new Set(blockedRows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));

  const [posts_, lives] = await Promise.all([candidatePosts(userId, followedIds), liveCandidates()]);

  const eligible = [...posts_, ...lives].filter((c) => !blockedSet.has(c.sellerId) && !seenIds.has(c.id));

  const scored: ScoredCandidate[] = eligible.map((c) => ({
    ...c,
    score: scoreCandidate(c, profile.categoryAffinity, profile.styleTagAffinity, profile.sellerAffinity, now),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Exploration pool: candidates outside the top slice but not already filtered out.
  const TOP_SLICE = 60;
  const explorationPool = scored.slice(TOP_SLICE).sort(() => Math.random() - 0.5).slice(0, 20);
  const topRanked = scored.slice(0, TOP_SLICE);

  const diversified = diversifyFeed(topRanked, { explorationPool });

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
  const weight = eventWeight(event.type, event.value);
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
