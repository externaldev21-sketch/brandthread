/**
 * Pure policy for seeding @brandthread official Threads into a new user's
 * Threads (For You) feed. Nothing here touches the database, so every rule
 * is unit-testable in isolation; ./service.ts loads the inputs.
 *
 * Rules:
 *  - Only "new" users are seeded: account younger than newUserMaxAgeDays AND
 *    fewer than newUserMaxThreadsViewed Threads viewed.
 *  - The first official Thread goes in slot `firstSlot` (1), then one every
 *    `every` slots, where `every` grows with the eligible real-post pool
 *    (config.spacingTiers). Past the last tier nobody is seeded: official
 *    posts only appear through normal ranking.
 *  - An official Thread is never served twice (seen + already-served ids are
 *    excluded by the caller) and two official posts are never back to back.
 *  - Official posts already seen stay in the organic list (normal ranking);
 *    unseen ones are removed from it because the planner places them.
 */
import { OFFICIAL_SEED_CONFIG, spacingForPool, type SeedSpacingTier } from "./config";

const DAY_MS = 86_400_000;

export type SeedEligibilityInput = {
  accountCreatedAt: Date | null;
  now: Date;
  threadsViewed: number;
  /** Eligible real (non-official) Thread posts on the platform. */
  poolSize: number;
  /** Official Threads this viewer has not seen yet. */
  unseenCount: number;
  config?: {
    newUserMaxAgeDays: number;
    newUserMaxThreadsViewed: number;
    spacingTiers: readonly SeedSpacingTier[];
  };
};

export type SeedEligibility =
  | { eligible: true; every: number }
  | { eligible: false; reason: "not_new_user" | "threads_viewed" | "pool_large" | "all_seen" };

export function seedEligibility(input: SeedEligibilityInput): SeedEligibility {
  const cfg = input.config ?? OFFICIAL_SEED_CONFIG;
  if (!input.accountCreatedAt) return { eligible: false, reason: "not_new_user" };
  const ageMs = input.now.getTime() - input.accountCreatedAt.getTime();
  if (ageMs >= cfg.newUserMaxAgeDays * DAY_MS) return { eligible: false, reason: "not_new_user" };
  if (input.threadsViewed >= cfg.newUserMaxThreadsViewed) return { eligible: false, reason: "threads_viewed" };
  const every = spacingForPool(input.poolSize, cfg.spacingTiers);
  if (every === null) return { eligible: false, reason: "pool_large" };
  if (input.unseenCount <= 0) return { eligible: false, reason: "all_seen" };
  return { eligible: true, every };
}

/** Where the viewer is in this session's feed: carried by the client between pages. */
export type SeedCursor = {
  /** Items (organic + official) already emitted this session. */
  position: number;
  /** 1-based position of the last official item emitted; 0 = none yet. */
  lastOfficialPosition: number;
};

export type SeedPageRow = { id: string; official: boolean };
export type SeedPageItem = { kind: "organic"; id: string } | { kind: "official"; id: string };

export type SeedPagePlan = {
  items: SeedPageItem[];
  /** Organic rows removed from this page (unseen official, or an official that would sit back to back). */
  dropped: string[];
  cursor: SeedCursor;
};

/**
 * Interleaves official candidates into one page of organic rows.
 * `candidates` are unseen, not-yet-served official post ids in serve order.
 */
export function planSeedPage(input: {
  organic: readonly SeedPageRow[];
  candidates: readonly string[];
  cursor: SeedCursor;
  every: number;
  firstSlot?: number;
  /** True when no further organic page exists — lets one official close out the feed. */
  isLastPage?: boolean;
}): SeedPagePlan {
  const every = Math.max(2, Math.floor(input.every));
  const firstSlot = Math.max(1, Math.floor(input.firstSlot ?? OFFICIAL_SEED_CONFIG.firstSlot));
  let position = Math.max(0, Math.floor(input.cursor.position));
  let lastOfficial = Math.max(0, Math.min(position, Math.floor(input.cursor.lastOfficialPosition)));

  const queue = [...new Set(input.candidates)];
  const candidateSet = new Set(queue);
  const items: SeedPageItem[] = [];
  const dropped: string[] = [];

  const previousIsOfficial = () => position > 0 && lastOfficial === position;
  const officialDue = () => {
    const next = position + 1;
    return lastOfficial === 0 ? next >= firstSlot : next - lastOfficial >= every;
  };
  const tryPlaceOfficial = () => {
    if (queue.length === 0 || !officialDue() || previousIsOfficial()) return;
    items.push({ kind: "official", id: queue.shift()! });
    position += 1;
    lastOfficial = position;
  };

  for (const row of input.organic) {
    tryPlaceOfficial();
    if (row.official) {
      // Unseen: the planner owns its placement. Seen but adjacent to another
      // official: skip it this time rather than show two in a row.
      if (candidateSet.has(row.id) || previousIsOfficial()) {
        dropped.push(row.id);
        continue;
      }
      items.push({ kind: "organic", id: row.id });
      position += 1;
      lastOfficial = position;
      continue;
    }
    items.push({ kind: "organic", id: row.id });
    position += 1;
  }
  // A page that ends exactly on a due slot gets its official at the end; the
  // next page's first check still prevents back-to-back across the boundary.
  if (input.isLastPage || input.organic.length > 0) tryPlaceOfficial();

  return { items, dropped, cursor: { position, lastOfficialPosition: lastOfficial } };
}

/** Official positions (1-based) a fresh session would get for `count` officials across `organicCount` organic posts. */
export function officialPositions(plan: SeedPagePlan): number[] {
  const out: number[] = [];
  plan.items.forEach((item, i) => { if (item.kind === "official") out.push(i + 1); });
  return out;
}
