/**
 * Search result fallback: bundled sample results only fill an empty result set
 * in the explicit demo preview (?bt_preview=buyer&demo=1). In the live app an
 * empty search stays empty so the "No results" state shows — sample ids open
 * "Product not found" outside the preview.
 */
export function withDemoFallback<T>(live: T[], demoMode: boolean, sample: () => T[]): T[] {
  // Same array back (not a copy) so memoized consumers keep a stable input.
  if (live.length > 0 || !demoMode) return live;
  return sample();
}
