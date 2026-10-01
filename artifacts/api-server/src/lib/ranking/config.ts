/**
 * Tunable For You ranking config.
 *
 * Precedence (later wins): defaults in code < `ranking_config` row with key
 * `ranking_weights` < env `RANKING_WEIGHTS_JSON`. Every source is run through
 * `sanitizeRankingConfig`, which clamps values, ignores unknown keys and never
 * throws, so a bad row / bad env JSON can only ever fall back to defaults.
 * The merged result is cached in memory for ~60s.
 */
import { db, rankingConfig } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger";

export const RANKING_CONFIG_KEY = "ranking_weights";
export const RANKING_CONFIG_TTL_MS = 60_000;

export type ScoreWeights = {
  affinity: number;
  freshness: number;
  trending: number;
  followed: number;
  boosted: number;
  /** Bounded per-post engagement-quality term (views/completion/likes/shares/saves/purchases). */
  engagement: number;
};

export type RankingConfig = {
  eventWeights: Record<string, number>;
  scoreWeights: ScoreWeights;
  recencyHalfLifeHours: number;
  liveInterleaveEvery: number;
  explorationEvery: number;
  /** Lookback for the per-post engagement aggregate. */
  engagementWindowDays: number;
};

export const DEFAULT_EVENT_WEIGHTS: Record<string, number> = {
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

export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  eventWeights: DEFAULT_EVENT_WEIGHTS,
  scoreWeights: {
    affinity: 3.0,
    freshness: 1.5,
    trending: 1.2,
    followed: 1.0,
    boosted: 2.0,
    engagement: 1.5,
  },
  recencyHalfLifeHours: 18,
  liveInterleaveEvery: 6,
  explorationEvery: 8,
  engagementWindowDays: 14,
};

const SCORE_WEIGHT_RANGE: [number, number] = [0, 20];
const EVENT_WEIGHT_RANGE: [number, number] = [-10, 10];

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function clamp(v: number, [lo, hi]: [number, number]): number {
  return Math.min(hi, Math.max(lo, v));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Applies `raw` (any JSON) on top of `base`: known keys only, numbers clamped,
 * everything else ignored. Never throws; returns a fresh object.
 */
export function sanitizeRankingConfig(raw: unknown, base: RankingConfig = DEFAULT_RANKING_CONFIG): RankingConfig {
  const out: RankingConfig = {
    eventWeights: { ...base.eventWeights },
    scoreWeights: { ...base.scoreWeights },
    recencyHalfLifeHours: base.recencyHalfLifeHours,
    liveInterleaveEvery: base.liveInterleaveEvery,
    explorationEvery: base.explorationEvery,
    engagementWindowDays: base.engagementWindowDays,
  };
  try {
    if (!isObj(raw)) return out;

    if (isObj(raw.eventWeights)) {
      for (const key of Object.keys(DEFAULT_EVENT_WEIGHTS)) {
        const n = num(raw.eventWeights[key]);
        if (n !== null) out.eventWeights[key] = clamp(n, EVENT_WEIGHT_RANGE);
      }
    }
    if (isObj(raw.scoreWeights)) {
      for (const key of Object.keys(DEFAULT_RANKING_CONFIG.scoreWeights) as (keyof ScoreWeights)[]) {
        const n = num(raw.scoreWeights[key]);
        if (n !== null) out.scoreWeights[key] = clamp(n, SCORE_WEIGHT_RANGE);
      }
    }
    const half = num(raw.recencyHalfLifeHours);
    if (half !== null) out.recencyHalfLifeHours = clamp(half, [1, 24 * 14]);
    const live = num(raw.liveInterleaveEvery);
    if (live !== null) out.liveInterleaveEvery = Math.round(clamp(live, [2, 50]));
    const explore = num(raw.explorationEvery);
    if (explore !== null) out.explorationEvery = Math.round(clamp(explore, [2, 50]));
    const days = num(raw.engagementWindowDays);
    if (days !== null) out.engagementWindowDays = Math.round(clamp(days, [1, 90]));
  } catch {
    /* fall through with whatever was applied */
  }
  return out;
}

/** Parses the env override; invalid JSON yields `null` (ignored). */
export function parseEnvOverride(json: string | undefined): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

let cache: { config: RankingConfig; expiresAt: number } | null = null;

/** Current config without touching the DB: cached value if present, else defaults (+ env). */
export function getRankingConfigSync(): RankingConfig {
  if (cache) return cache.config;
  return sanitizeRankingConfig(parseEnvOverride(process.env.RANKING_WEIGHTS_JSON));
}

export function invalidateRankingConfigCache(): void {
  cache = null;
}

/** Raw stored override (or null). Never throws. */
export async function loadStoredRankingOverride(): Promise<unknown> {
  try {
    const [row] = await db.select().from(rankingConfig).where(eq(rankingConfig.key, RANKING_CONFIG_KEY)).limit(1);
    return row?.value ?? null;
  } catch (err) {
    logger.warn({ err }, "Ranking config read failed; using defaults");
    return null;
  }
}

/** Merged config (defaults < DB < env), cached ~60s. Never throws. */
export async function getRankingConfig(now: number = Date.now()): Promise<RankingConfig> {
  if (cache && cache.expiresAt > now) return cache.config;
  const stored = await loadStoredRankingOverride();
  let config = sanitizeRankingConfig(stored);
  config = sanitizeRankingConfig(parseEnvOverride(process.env.RANKING_WEIGHTS_JSON), config);
  cache = { config, expiresAt: now + RANKING_CONFIG_TTL_MS };
  return config;
}

/**
 * Persists an override. The patch is merged onto the currently stored override
 * (sanitized, so the stored row is always a full valid config), and the cache
 * is dropped so this instance sees it immediately.
 */
export async function saveRankingConfig(patch: unknown): Promise<RankingConfig> {
  const stored = await loadStoredRankingOverride();
  const next = sanitizeRankingConfig(patch, sanitizeRankingConfig(stored));
  await db.insert(rankingConfig).values({ key: RANKING_CONFIG_KEY, value: next as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: rankingConfig.key,
      set: { value: next as unknown as Record<string, unknown>, updatedAt: new Date() },
    });
  invalidateRankingConfigCache();
  return getRankingConfig();
}
