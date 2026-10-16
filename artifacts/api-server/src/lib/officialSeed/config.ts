/**
 * @brandthread official account + new-user seeding configuration.
 *
 * Every threshold the seeding planner uses lives here — the feed code never
 * hard-codes a spacing or window. See ./plan.ts for how they are applied.
 */
import { sql, type SQL } from "drizzle-orm";
import { resolveAppEnv } from "../appEnv";

/** Well-known ids for the official account (seeded by migration 270). */
export const OFFICIAL_ACCOUNT_CLERK_ID = "brandthread-official";
export const OFFICIAL_ACCOUNT_USERNAME = "brandthread";
export const OFFICIAL_ACCOUNT_DISPLAY_NAME = "Brandthread";
/** Value the composer sends as `postAs` to publish as the official account. */
export const POST_AS_OFFICIAL = "brandthread";

export function isOfficialAuthor(userId: string | null | undefined): boolean {
  return userId === OFFICIAL_ACCOUNT_CLERK_ID;
}

export type SeedSpacingTier = {
  /** Applies while the eligible real-post pool is below this size. */
  poolBelow: number;
  /** One official Thread every `every` slots (slot 1, then 1+every, …). */
  every: number;
};

export const OFFICIAL_SEED_CONFIG = {
  /** A user is "new" for this many days after their account was created… */
  newUserMaxAgeDays: 7,
  /** …and until they have viewed this many Threads, whichever ends first. */
  newUserMaxThreadsViewed: 50,
  /** 1-based feed slot the first official Thread goes in. */
  firstSlot: 1,
  /**
   * Spacing by the size of the eligible real (non-official) post pool. Past
   * the last tier official posts only appear through normal ranking.
   * `every` must be >= 2 so two official posts are never back to back.
   */
  spacingTiers: [
    { poolBelow: 50, every: 3 },
    { poolBelow: 200, every: 6 },
    { poolBelow: 1_000, every: 12 },
  ] as readonly SeedSpacingTier[],
  /** How long the real-post pool count is cached in memory. */
  poolCountTtlMs: 5 * 60_000,
  /** Most official candidates loaded per request (the starter set is ~10). */
  candidateLimit: 50,
} as const;

// ─── OFFICIAL_SEED_CONTENT_PUBLIC ────────────────────────────────────────────
// Whether non-admins can see the official account's posts at all. Admins
// always can. The starter set reposts other creators' videos, so production
// keeps this OFF until the creators have given permission.
//
// Resolution order:
//   1. a `officialSeedContentPublic` row in feature_flags (moderators flip it
//      at runtime with PUT /api/feature-flags/officialSeedContentPublic);
//   2. the OFFICIAL_SEED_CONTENT_PUBLIC env var ("true"/"false");
//   3. the environment default: OFF in production, ON in staging/development.

export const OFFICIAL_SEED_FLAG_KEY = "officialSeedContentPublic";

export function officialSeedPublicDefault(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.OFFICIAL_SEED_CONTENT_PUBLIC?.trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "off") return false;
  return resolveAppEnv(env) !== "production";
}

/** SQL boolean: the flag's effective value (evaluated once per query). */
export function officialSeedPublicSql(): SQL<boolean> {
  const fallback = officialSeedPublicDefault();
  return sql<boolean>`coalesce((select ff.enabled from feature_flags ff where ff.key = ${OFFICIAL_SEED_FLAG_KEY}), ${fallback})`;
}

/** Spacing for a pool size, or null once official posts rely on normal ranking only. */
export function spacingForPool(
  poolSize: number,
  tiers: readonly SeedSpacingTier[] = OFFICIAL_SEED_CONFIG.spacingTiers,
): number | null {
  const n = Math.max(0, Math.floor(poolSize));
  const tier = tiers.find((t) => n < t.poolBelow);
  return tier ? Math.max(2, Math.floor(tier.every)) : null;
}
