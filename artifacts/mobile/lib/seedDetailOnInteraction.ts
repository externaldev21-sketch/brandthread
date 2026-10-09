import type { QueryClient, QueryKey } from '@tanstack/react-query';

export interface DetailSeedSnapshot {
  ownerId: string | null;
  rows: ReadonlyMap<string, unknown>;
}

/**
 * Seed only the selected detail. Bulk per-row cache writes trigger whole-cache
 * persistence work even when storage writes themselves are throttled.
 */
export function seedDetailOnInteraction(
  client: QueryClient,
  key: QueryKey,
  id: string,
  snapshot: DetailSeedSnapshot | null,
  ownerId: string | null,
): boolean {
  if (!snapshot || snapshot.ownerId !== ownerId || !snapshot.rows.has(id)) return false;
  const row = snapshot.rows.get(id);
  if (client.getQueryData(key) !== row) client.setQueryData(key, row);
  return true;
}
