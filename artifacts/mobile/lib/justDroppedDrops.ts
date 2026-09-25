/**
 * Pure helper for the buyer feed's "Just dropped from brands you follow"
 * rail: intersects the buyer's follow graph with the platform's currently
 * live drops client-side (no server change needed — GET /api/public/drops
 * isn't scoped by viewer), most-recently-released first.
 */
export interface FollowedDrop {
  id: string;
  name: string;
  sellerName: string;
  heroImageUrl: string | null;
  releaseAt: string | null;
}

export function computeJustDroppedDrops(
  followingRows: Array<{ userId: string }>,
  liveDrops: Array<{
    id: string;
    name: string;
    ownerId: string;
    heroImageUrl?: string | null;
    releaseAt?: string | null;
    seller?: { brandName?: string | null; displayName?: string | null } | null;
  }>,
  limit = 10,
): FollowedDrop[] {
  const followedIds = new Set(followingRows.map((f) => f.userId));
  return liveDrops
    .filter((d) => followedIds.has(d.ownerId))
    .map((d) => ({
      id: d.id,
      name: d.name,
      sellerName: d.seller?.brandName ?? d.seller?.displayName ?? 'Seller',
      heroImageUrl: d.heroImageUrl ?? null,
      releaseAt: d.releaseAt ?? null,
    }))
    .sort((a, b) => new Date(b.releaseAt ?? 0).getTime() - new Date(a.releaseAt ?? 0).getTime())
    .slice(0, limit);
}
