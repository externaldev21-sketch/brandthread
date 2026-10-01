/**
 * "Brands you might like" ranking (pure, unit-tested).
 *
 * score = 3 * styleOverlap      share of the buyer's style interests that appear in the brand's post style tags
 *       + 1.5 * likedSimilarity brand shares a brandType with a brand the buyer liked in the survey
 *       + 2 * likedBoost        the buyer liked this brand but does not follow it yet
 *       + 1 * popularity        log-scaled follower count, normalized to the candidate pool
 * Followed / blocked / self brands are removed by the caller's query; `rankRecommendedBrands`
 * also drops any id in `excludeIds` defensively. Ties break on follower count then id.
 */
export interface BrandCandidate {
  sellerId: string;
  name: string;
  brandType: string | null;
  logoUrl: string | null;
  verified: boolean;
  followerCount: number;
  styleTags: string[];
}

export interface RecommendedBrand {
  id: string;
  sellerId: string;
  name: string;
  brandType: string | null;
  logoUrl: string | null;
  verified: boolean;
  followerCount: number;
  reason: string;
  score: number;
}

const lc = (xs: string[]) => [...new Set(xs.map((x) => x.trim().toLowerCase()).filter(Boolean))];

export function styleOverlap(buyerInterests: string[], brandTags: string[]): { ratio: number; matched: string[] } {
  const wanted = lc(buyerInterests);
  if (wanted.length === 0) return { ratio: 0, matched: [] };
  const have = new Set(lc(brandTags));
  const matched = wanted.filter((w) => have.has(w));
  return { ratio: matched.length / wanted.length, matched };
}

export function rankRecommendedBrands(
  candidates: BrandCandidate[],
  ctx: { styleInterests: string[]; likedBrandIds: string[]; likedBrandTypes: string[]; excludeIds?: ReadonlySet<string> },
  limit = 12,
): RecommendedBrand[] {
  const liked = new Set(ctx.likedBrandIds);
  const likedTypes = new Set(lc(ctx.likedBrandTypes));
  const pool = candidates.filter((c) => !ctx.excludeIds?.has(c.sellerId));
  const maxLog = Math.max(0, ...pool.map((c) => Math.log1p(c.followerCount)));

  const scored = pool.map((c) => {
    const { ratio, matched } = styleOverlap(ctx.styleInterests, c.styleTags);
    const similar = !!c.brandType && likedTypes.has(c.brandType.trim().toLowerCase()) && !liked.has(c.sellerId);
    const likedBoost = liked.has(c.sellerId);
    const popularity = maxLog > 0 ? Math.log1p(c.followerCount) / maxLog : 0;
    const score = 3 * ratio + (similar ? 1.5 : 0) + (likedBoost ? 2 : 0) + popularity;
    let reason = "Popular on Brandthread";
    if (likedBoost) reason = "You liked this brand";
    else if (matched.length > 0) reason = `Matches your ${matched[0]} style`;
    else if (similar) reason = "Similar to brands you liked";
    return { c, score, reason };
  });

  scored.sort((a, b) =>
    b.score - a.score || b.c.followerCount - a.c.followerCount || a.c.sellerId.localeCompare(b.c.sellerId));

  return scored.slice(0, limit).map(({ c, score, reason }) => ({
    id: c.sellerId,
    sellerId: c.sellerId,
    name: c.name,
    brandType: c.brandType,
    logoUrl: c.logoUrl,
    verified: c.verified,
    followerCount: c.followerCount,
    reason,
    score: +score.toFixed(4),
  }));
}
