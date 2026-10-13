/**
 * Ordering for "new from brands you follow" at the top of Threads.
 *
 * Input is newest-first. Output keeps newest-first as closely as possible
 * while never letting one brand fill more than `maxRun` consecutive slots:
 * at each step the newest remaining post whose author would not extend a run
 * past the cap is taken. Posts that can only be placed by breaking the cap
 * (one brand left) are deferred — the regular feed serves them later.
 */
export function interleaveByAuthor<T extends { userId: string }>(rows: T[], maxRun = 2): T[] {
  const remaining = [...rows];
  const out: T[] = [];
  while (remaining.length > 0) {
    const tail = out.slice(-maxRun);
    const capped = tail.length === maxRun && tail.every((row) => row.userId === tail[0].userId)
      ? tail[0].userId
      : null;
    const index = remaining.findIndex((row) => row.userId !== capped);
    if (index < 0) break;
    out.push(remaining.splice(index, 1)[0]);
  }
  return out;
}

export const FOLLOWED_FRESH_DEFAULT_HOURS = 72;
export const FOLLOWED_FRESH_MAX_HOURS = 168;
export const FOLLOWED_FRESH_DEFAULT_LIMIT = 20;
export const FOLLOWED_FRESH_MAX_LIMIT = 30;

/** Clamp `?limit=&hours=`; non-numeric values fall back to the defaults. */
export function parseFollowedFreshQuery(query: { limit?: unknown; hours?: unknown }) {
  const num = (value: unknown, fallback: number, max: number) => {
    const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
    return Number.isFinite(parsed) ? Math.min(max, Math.max(1, parsed)) : fallback;
  };
  return {
    limit: num(query.limit, FOLLOWED_FRESH_DEFAULT_LIMIT, FOLLOWED_FRESH_MAX_LIMIT),
    hours: num(query.hours, FOLLOWED_FRESH_DEFAULT_HOURS, FOLLOWED_FRESH_MAX_HOURS),
  };
}
