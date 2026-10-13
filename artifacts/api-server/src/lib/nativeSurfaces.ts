/**
 * `nativeSurfaces` feature flag: the one switch for every iOS system surface
 * (order-tracking Live Activity pushes, the seller widget summary, the Watch
 * sale-ping copy). Read from the feature_flags table (seeded OFF by
 * migration 275), OFF when the row is missing, and FAILS CLOSED when the
 * lookup errors. Cached for 30 s because order webhooks call it on every
 * tracking event.
 */
export const NATIVE_SURFACES_FLAG = "nativeSurfaces";

const CACHE_MS = 30_000;
let cache: { value: boolean; at: number } | null = null;

export async function isNativeSurfacesEnabled(now: number = Date.now()): Promise<boolean> {
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  let value = false;
  try {
    const { pool } = await import("@workspace/db");
    const result = await pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM feature_flags WHERE key = $1`,
      [NATIVE_SURFACES_FLAG],
    );
    value = result.rows[0]?.enabled === true;
  } catch {
    value = false;
  }
  cache = { value, at: now };
  return value;
}

export function __resetNativeSurfacesFlagCacheForTests(): void {
  cache = null;
}
