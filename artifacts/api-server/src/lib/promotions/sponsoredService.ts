/**
 * DB-facing half of Sponsored delivery: loads candidates + viewer context,
 * runs the pure policy (./sponsored), records the serve, hydrates the posts,
 * and does the impression accounting with an atomic spend cap.
 */
import { and, eq, gt, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import {
  boosts, db, interactions, postTaggedProducts, posts, productVariants, products, sponsoredDeliveries, users,
} from "@workspace/db";
import { blockedUserIds, mutedPhrasesFor } from "../safety";
import { publicPostCondition, visibleCommentCounts } from "../postVisibility";
import { taggedProductVisibleTo } from "../productVisibility";
import { deriveSellerVerified } from "../sellerEligibility";
import {
  planSponsoredSlots, SPONSORED_COST_PER_IMPRESSION_CENTS,
  type SponsoredCandidate,
} from "./sponsored";

const CANDIDATE_LIMIT = 100;

export async function loadSponsoredCandidates(now: Date): Promise<SponsoredCandidate[]> {
  const rows = await db
    .select({
      boostId: boosts.id,
      postId: boosts.targetId,
      sellerId: boosts.sellerId,
      status: boosts.status,
      reviewStatus: boosts.reviewStatus,
      paidAt: boosts.paidAt,
      startsAt: boosts.startsAt,
      endsAt: boosts.endsAt,
      budgetCents: boosts.budgetCents,
      deliveredSpendCents: boosts.deliveredSpendCents,
      caption: posts.caption,
      hashtags: posts.hashtags,
      vacationMode: users.vacationMode,
      vacationUntil: users.vacationUntil,
    })
    .from(boosts)
    .innerJoin(posts, and(eq(sql`${posts.id}::text`, boosts.targetId), eq(posts.userId, boosts.sellerId)))
    .innerJoin(users, eq(users.clerkId, boosts.sellerId))
    .where(and(
      eq(boosts.targetType, "post"),
      eq(boosts.status, "active"),
      eq(boosts.reviewStatus, "approved"),
      isNotNull(boosts.paidAt),
      lte(boosts.startsAt, now),
      gt(boosts.endsAt, now),
      publicPostCondition(now),
    ))
    .limit(CANDIDATE_LIMIT);

  return rows.map((r) => ({
    boostId: r.boostId,
    postId: r.postId,
    sellerId: r.sellerId,
    status: r.status,
    reviewStatus: r.reviewStatus,
    paidAt: r.paidAt,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    budgetCents: r.budgetCents,
    deliveredSpendCents: r.deliveredSpendCents,
    postVisible: true, // enforced in SQL by publicPostCondition
    sellerOnVacation: r.vacationMode === true && (!r.vacationUntil || r.vacationUntil > now),
    text: [r.caption ?? "", ...((r.hashtags as string[] | null) ?? [])].join(" "),
  }));
}

export type SponsoredPost = Awaited<ReturnType<typeof hydrateSponsoredPosts>>[number];

async function hydrateSponsoredPosts(postIds: string[]) {
  if (postIds.length === 0) return [];
  const rows = await db
    .select({
      id: posts.id, userId: posts.userId, mediaUrl: posts.mediaUrl, thumbnailUrl: posts.thumbnailUrl,
      mediaUrls: posts.mediaUrls, mediaType: posts.mediaType, aspectRatio: posts.aspectRatio,
      caption: posts.caption, hashtags: posts.hashtags, styleTags: posts.styleTags, sound: posts.sound,
      visibility: posts.visibility, createdAt: posts.createdAt,
      displayName: users.displayName, brandName: users.brandName, username: users.username,
      verified: users.verified, verificationStatus: users.verificationStatus,
      activeStanding: users.activeStanding, policyRestricted: users.policyRestricted,
    })
    .from(posts)
    .innerJoin(users, eq(users.clerkId, posts.userId))
    .where(inArray(posts.id, postIds));

  const [tagRows, likeRows, commentCounts] = await Promise.all([
    db.select({
      postId: postTaggedProducts.postId, productId: postTaggedProducts.productId,
      position: postTaggedProducts.position, name: products.name, images: products.images,
    })
      .from(postTaggedProducts)
      .leftJoin(products, eq(products.id, postTaggedProducts.productId))
      .where(and(inArray(postTaggedProducts.postId, postIds), taggedProductVisibleTo(null)))
      .orderBy(postTaggedProducts.position),
    db.select({ postId: interactions.postId, cnt: sql<number>`count(*)` })
      .from(interactions)
      .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "like")))
      .groupBy(interactions.postId),
    visibleCommentCounts(postIds),
  ]);
  const productIds = [...new Set(tagRows.map((t) => t.productId))];
  const priceRows = productIds.length === 0 ? [] : await db
    .select({ productId: productVariants.productId, minPriceCents: sql<number>`min(${productVariants.priceCents})` })
    .from(productVariants)
    .where(inArray(productVariants.productId, productIds))
    .groupBy(productVariants.productId);
  const minPrice = new Map(priceRows.map((r) => [r.productId, Number(r.minPriceCents)]));
  const likes = new Map(likeRows.map((r) => [r.postId as string, Number(r.cnt)]));

  return rows.map((p) => ({
    id: p.id, userId: p.userId, mediaUrl: p.mediaUrl, thumbnailUrl: p.thumbnailUrl,
    mediaUrls: p.mediaUrls, mediaType: p.mediaType, aspectRatio: p.aspectRatio,
    caption: p.caption, hashtags: p.hashtags, styleTags: p.styleTags, sound: p.sound,
    visibility: p.visibility, createdAt: p.createdAt,
    seller: { displayName: p.displayName, brandName: p.brandName, username: p.username, verified: deriveSellerVerified(p) },
    taggedProducts: tagRows.filter((t) => t.postId === p.id).map((t) => ({
      productId: t.productId, position: t.position, name: t.name, images: t.images,
      priceCents: minPrice.get(t.productId) ?? 0,
    })),
    likesCount: (p.visibility as any)?.showLikeCount === false ? null : likes.get(p.id) ?? 0,
    commentsCount: commentCounts.get(p.id) ?? 0,
    repostsCount: 0, sharesCount: 0, savesCount: 0,
  }));
}

export type ServedSponsoredSlot = { afterIndex: number; boostId: string; post: SponsoredPost };

/**
 * Plans + records Sponsored slots for one page of a viewer's For You feed.
 * Serving inserts a delivery row (unique per boost/viewer/session, so a boost
 * can never repeat within a session); billing happens later on the impression.
 */
export async function serveSponsoredSlots(input: {
  viewerId: string;
  sessionId: string;
  organicOffset: number;
  organicCount: number;
  now?: Date;
}): Promise<ServedSponsoredSlot[]> {
  const now = input.now ?? new Date();
  const [candidates, blocked, muted, sessionRows, dayRows] = await Promise.all([
    loadSponsoredCandidates(now),
    blockedUserIds(input.viewerId),
    mutedPhrasesFor(input.viewerId),
    db.select({ boostId: sponsoredDeliveries.boostId }).from(sponsoredDeliveries)
      .where(and(eq(sponsoredDeliveries.viewerId, input.viewerId), eq(sponsoredDeliveries.sessionId, input.sessionId))),
    db.select({ boostId: sponsoredDeliveries.boostId, n: sql<number>`count(*)` }).from(sponsoredDeliveries)
      .where(and(
        eq(sponsoredDeliveries.viewerId, input.viewerId),
        gte(sponsoredDeliveries.servedAt, new Date(now.getTime() - 86_400_000)),
      ))
      .groupBy(sponsoredDeliveries.boostId),
  ]);
  if (candidates.length === 0) return [];

  const slots = planSponsoredSlots({
    candidates,
    ctx: {
      viewerId: input.viewerId,
      blockedUserIds: blocked,
      mutedPhrases: muted,
      sessionSeenBoostIds: new Set(sessionRows.map((r) => r.boostId)),
      servedLast24h: new Map(dayRows.map((r) => [r.boostId, Number(r.n)])),
      now,
    },
    organicOffset: input.organicOffset,
    organicCount: input.organicCount,
  });
  if (slots.length === 0) return [];

  const inserted = await db
    .insert(sponsoredDeliveries)
    .values(slots.map((s) => ({
      boostId: s.candidate.boostId,
      viewerId: input.viewerId,
      sessionId: input.sessionId,
      costCents: SPONSORED_COST_PER_IMPRESSION_CENTS,
      servedAt: now,
    })))
    .onConflictDoNothing()
    .returning({ boostId: sponsoredDeliveries.boostId });
  const recorded = new Set(inserted.map((r) => r.boostId));
  const won = slots.filter((s) => recorded.has(s.candidate.boostId));
  if (won.length === 0) return [];

  const hydrated = await hydrateSponsoredPosts(won.map((s) => s.candidate.postId));
  const byId = new Map(hydrated.map((p) => [p.id, p]));
  return won.flatMap((s) => {
    const post = byId.get(s.candidate.postId);
    return post ? [{ afterIndex: s.afterIndex, boostId: s.candidate.boostId, post }] : [];
  });
}

export type ImpressionResult = { counted: boolean; reason?: "not_served" | "already_counted" | "budget_exhausted" };

/**
 * Bills one confirmed impression: marks the delivery viewed and increments the
 * boost's counters atomically. The UPDATE's WHERE clause is the spend cap — a
 * boost can never deliver past its budget even under concurrent requests.
 */
export async function recordSponsoredImpression(input: {
  viewerId: string; boostId: string; sessionId: string; now?: Date;
}): Promise<ImpressionResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .update(sponsoredDeliveries)
      .set({ viewedAt: now })
      .where(and(
        eq(sponsoredDeliveries.boostId, input.boostId),
        eq(sponsoredDeliveries.viewerId, input.viewerId),
        eq(sponsoredDeliveries.sessionId, input.sessionId),
        sql`${sponsoredDeliveries.viewedAt} IS NULL`,
      ))
      .returning({ costCents: sponsoredDeliveries.costCents });
    if (!delivery) {
      const [existing] = await tx.select({ id: sponsoredDeliveries.id }).from(sponsoredDeliveries)
        .where(and(
          eq(sponsoredDeliveries.boostId, input.boostId),
          eq(sponsoredDeliveries.viewerId, input.viewerId),
          eq(sponsoredDeliveries.sessionId, input.sessionId),
        )).limit(1);
      return { counted: false, reason: existing ? "already_counted" : "not_served" } as ImpressionResult;
    }

    const cost = delivery.costCents;
    const [billed] = await tx
      .update(boosts)
      .set({
        impressionsCount: sql`${boosts.impressionsCount} + 1`,
        deliveredSpendCents: sql`${boosts.deliveredSpendCents} + ${cost}`,
        // Budget fully delivered: the boost ends.
        status: sql`CASE WHEN ${boosts.deliveredSpendCents} + ${cost} + ${SPONSORED_COST_PER_IMPRESSION_CENTS} > ${boosts.budgetCents} THEN 'completed' ELSE ${boosts.status} END`,
      })
      .where(and(
        eq(boosts.id, input.boostId),
        eq(boosts.status, "active"),
        eq(boosts.reviewStatus, "approved"),
        sql`${boosts.deliveredSpendCents} + ${cost} <= ${boosts.budgetCents}`,
      ))
      .returning({ id: boosts.id });
    if (!billed) {
      tx.rollback();
    }
    return { counted: true } as ImpressionResult;
  }).catch((err) => {
    if (err?.name === "TransactionRollbackError" || /rollback/i.test(String(err?.message))) {
      return { counted: false, reason: "budget_exhausted" } as ImpressionResult;
    }
    throw err;
  });
}
