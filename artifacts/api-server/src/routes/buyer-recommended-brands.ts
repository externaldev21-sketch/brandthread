/**
 * GET /api/buyer/recommended-brands?limit= — "Brands you might like".
 * Ranked by overlap with the buyer's style interests + liked brands + popularity
 * (see lib/recommendedBrands.ts). Excludes brands the buyer already follows,
 * blocked either way, suspended / restricted sellers, and the buyer themself.
 * Returns { brands: [] } when there is nothing honest to recommend (the client hides the row).
 */
import { Router } from "express";
import { db, users, follows, posts, buyerPreferences } from "@workspace/db";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { notBlockedWith } from "../lib/safety";
import { deriveSellerVerified } from "../lib/sellerEligibility";
import { rankRecommendedBrands, type BrandCandidate } from "../lib/recommendedBrands";

const router = Router();
router.use(requireAuth);

const CANDIDATE_POOL = 200;
const POST_WINDOW_DAYS = 90;

router.get("/", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "12"), 10) || 12, 1), 30);
  try {
    const [prefs] = await db.select().from(buyerPreferences).where(eq(buyerPreferences.userId, myId)).limit(1);
    const [me] = await db.select({ interests: users.buyerStyleInterests }).from(users)
      .where(eq(users.clerkId, myId)).limit(1);
    const styleInterests = [...new Set([
      ...(((prefs?.styleInterests as string[] | undefined) ?? [])),
      ...(((me?.interests as string[] | null) ?? [])),
    ])];
    const likedBrandIds = (prefs?.likedBrandIds as string[] | undefined) ?? [];

    const followedRows = await db.select({ id: follows.followingId }).from(follows)
      .where(eq(follows.followerId, myId));
    const followed = new Set(followedRows.map((r) => r.id));

    const sellers = await db.select({
      clerkId: users.clerkId, displayName: users.displayName, brandName: users.brandName,
      brandType: users.brandType, profileImageUrl: users.profileImageUrl, avatarUrl: users.avatarUrl,
      verified: users.verified, verificationStatus: users.verificationStatus,
      activeStanding: users.activeStanding, policyRestricted: users.policyRestricted,
    }).from(users).where(and(
      eq(users.accountType, "seller"),
      isNull(users.suspendedAt),
      isNull(users.deletedAt),
      eq(users.policyRestricted, false),
      notBlockedWith(myId, users.clerkId),
    )).orderBy(desc(users.createdAt)).limit(CANDIDATE_POOL);

    // How many brands (seller accounts) the buyer already follows — the client hides the row past a threshold.
    const followedBrandRows = followed.size === 0 ? [] : await db.select({ id: users.clerkId }).from(users)
      .where(and(inArray(users.clerkId, [...followed]), eq(users.accountType, "seller")));
    const followedBrandCount = followedBrandRows.length;

    const pool = sellers.filter((s) => s.clerkId !== myId && !followed.has(s.clerkId));
    if (pool.length === 0) { res.json({ brands: [], followedBrandCount }); return; }
    const ids = pool.map((s) => s.clerkId);

    const since = new Date(Date.now() - POST_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [followerRows, tagRows, likedRows] = await Promise.all([
      db.select({ id: follows.followingId, n: sql<number>`count(*)::int` }).from(follows)
        .where(inArray(follows.followingId, ids)).groupBy(follows.followingId),
      db.select({ userId: posts.userId, styleTags: posts.styleTags }).from(posts)
        .where(and(inArray(posts.userId, ids), eq(posts.postStatus, "published"), gte(posts.createdAt, since)))
        .limit(3000),
      likedBrandIds.length === 0 ? Promise.resolve([]) : db.select({ brandType: users.brandType }).from(users)
        .where(inArray(users.clerkId, likedBrandIds)),
    ]);
    const followerCount = new Map(followerRows.map((r) => [r.id, Number(r.n)]));
    const tagsBySeller = new Map<string, string[]>();
    for (const r of tagRows) {
      const tags = Array.isArray(r.styleTags) ? (r.styleTags as string[]) : [];
      tagsBySeller.set(r.userId, (tagsBySeller.get(r.userId) ?? []).concat(tags));
    }

    const candidates: BrandCandidate[] = pool.map((s) => ({
      sellerId: s.clerkId,
      name: s.brandName || s.displayName || "Brand",
      brandType: s.brandType ?? null,
      logoUrl: s.profileImageUrl ?? s.avatarUrl ?? null,
      verified: deriveSellerVerified(s),
      followerCount: followerCount.get(s.clerkId) ?? 0,
      styleTags: tagsBySeller.get(s.clerkId) ?? [],
    }));

    const brands = rankRecommendedBrands(candidates, {
      styleInterests,
      likedBrandIds,
      likedBrandTypes: likedRows.map((r) => r.brandType).filter((t): t is string => !!t),
      excludeIds: followed,
    }, limit).map(({ score: _score, ...b }) => b);

    res.json({ brands, followedBrandCount });
  } catch (err) {
    (req as any).log?.error?.({ err }, "recommended brands failed");
    res.status(500).json({ error: "Couldn't load brand recommendations." });
  }
});

export default router;
