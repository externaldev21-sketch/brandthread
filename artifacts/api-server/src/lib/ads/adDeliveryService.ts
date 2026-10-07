/**
 * DB-facing half of ad campaign delivery: loads eligible campaigns + viewer
 * context, runs the shared Sponsored policy (../promotions/sponsored.ts via
 * ./adDelivery.ts), records each serve with a one-time token, bills confirmed
 * viewable impressions atomically, records clicks, completes campaigns, and
 * computes seller results.
 */
import { randomBytes } from "node:crypto";
import { and, eq, gt, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import {
  adCampaigns, adClicks, adImpressions, db, productVariants, products, users,
} from "@workspace/db";
import { blockedUserIds, mutedPhrasesFor } from "../safety";
import { ObjectStorageService } from "../objectStorage";
import { planSponsoredSlots } from "../promotions/sponsored";
import {
  AD_ATTRIBUTION_WINDOW_DAYS, AD_COST_PER_IMPRESSION_CENTS, AD_SERVE_TOKEN_TTL_MS,
  AD_SURFACES, adDestination, budgetExhausted, campaignToCandidate, ctaLabel, ctrPercent,
  fillDailySeries, flightDays,
  type AdCampaignForDelivery, type AdDestination, type AdSurface, type DailyPoint,
} from "./adDelivery";

const CANDIDATE_LIMIT = 100;
const DAY_MS = 86_400_000;

let storage: ObjectStorageService | null = null;
function objectStorage(): ObjectStorageService {
  storage ??= new ObjectStorageService();
  return storage;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── Candidates ───────────────────────────────────────────────────────────────

type CandidateRow = AdCampaignForDelivery & {
  mediaKind: string;
  ctaKind: string | null;
};

/** Active, paid, in-flight campaigns targeting `surface` with budget left. */
export async function loadAdCandidates(surface: AdSurface, now: Date): Promise<CandidateRow[]> {
  const rows = await db
    .select({
      id: adCampaigns.id,
      sellerId: adCampaigns.sellerId,
      status: adCampaigns.status,
      paidAt: adCampaigns.paidAt,
      startsAt: adCampaigns.startsAt,
      endsAt: adCampaigns.endsAt,
      budgetCents: adCampaigns.budgetCents,
      spentCents: adCampaigns.spentCents,
      mediaKind: adCampaigns.mediaKind,
      mediaObjectPaths: adCampaigns.mediaObjectPaths,
      headline: adCampaigns.headline,
      description: adCampaigns.description,
      ctaKind: adCampaigns.ctaKind,
      ctaDestinationKind: adCampaigns.ctaDestinationKind,
      ctaDestinationId: adCampaigns.ctaDestinationId,
      sellerRowId: users.clerkId,
      suspendedAt: users.suspendedAt,
      deletedAt: users.deletedAt,
      vacationMode: users.vacationMode,
      vacationUntil: users.vacationUntil,
      productName: products.name,
      productStatus: products.status,
      productDeletedAt: products.deletedAt,
      productOwnerId: products.ownerId,
    })
    .from(adCampaigns)
    .leftJoin(users, eq(users.clerkId, adCampaigns.sellerId))
    .leftJoin(products, and(
      eq(adCampaigns.ctaDestinationKind, "product"),
      eq(sql`${products.id}::text`, adCampaigns.ctaDestinationId),
    ))
    .where(and(
      eq(adCampaigns.status, "active"),
      isNotNull(adCampaigns.paidAt),
      lte(adCampaigns.startsAt, now),
      gt(adCampaigns.endsAt, now),
      sql`${adCampaigns.spentCents} + ${AD_COST_PER_IMPRESSION_CENTS} <= ${adCampaigns.budgetCents}`,
      sql`${adCampaigns.surfaces} @> ${JSON.stringify([surface])}::jsonb`,
    ))
    .orderBy(adCampaigns.endsAt)
    .limit(CANDIDATE_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    sellerId: r.sellerId,
    status: r.status,
    paidAt: r.paidAt,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    budgetCents: r.budgetCents,
    spentCents: r.spentCents,
    mediaKind: r.mediaKind,
    mediaObjectPaths: r.mediaObjectPaths ?? [],
    headline: r.headline,
    description: r.description,
    ctaKind: r.ctaKind,
    ctaDestinationKind: r.ctaDestinationKind,
    ctaDestinationId: r.ctaDestinationId,
    // A campaign whose seller row is missing is treated as not in good standing.
    sellerInGoodStanding: r.sellerRowId !== null && r.suspendedAt === null && r.deletedAt === null,
    sellerOnVacation: r.vacationMode === true && (!r.vacationUntil || r.vacationUntil > now),
    productAvailable: r.productStatus === "active" && r.productDeletedAt === null && r.productOwnerId === r.sellerId,
    productName: r.productName,
  }));
}

// ─── Serve ────────────────────────────────────────────────────────────────────

export type ServedAd = {
  afterIndex: number;
  token: string;
  campaignId: string;
  surface: AdSurface;
  label: "Sponsored";
  headline: string | null;
  description: string | null;
  mediaKind: string;
  mediaUrls: string[];
  ctaKind: string | null;
  ctaLabel: string;
  destination: AdDestination;
  seller: { id: string; displayName: string | null; username: string | null; avatarUrl: string | null };
  product: { id: string; name: string; imageUrl: string | null; priceCents: number | null } | null;
};

function newServeToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Plans + records the ad slots for one page of a viewer's feed. Each serve is
 * one ad_impressions row (unique per campaign/viewer/session, so a campaign
 * never repeats in a session even under concurrent requests); billing happens
 * later, when the client confirms the impression was actually viewable.
 */
export async function serveAds(input: {
  viewerId: string;
  surface: AdSurface;
  sessionId: string;
  organicOffset: number;
  organicCount: number;
  now?: Date;
}): Promise<ServedAd[]> {
  const now = input.now ?? new Date();
  const [candidates, blocked, muted, sessionRows, dayRows] = await Promise.all([
    loadAdCandidates(input.surface, now),
    blockedUserIds(input.viewerId),
    mutedPhrasesFor(input.viewerId),
    db.select({ campaignId: adImpressions.campaignId }).from(adImpressions)
      .where(and(eq(adImpressions.viewerId, input.viewerId), eq(adImpressions.sessionId, input.sessionId))),
    db.select({ campaignId: adImpressions.campaignId, n: sql<number>`count(*)::int` }).from(adImpressions)
      .where(and(
        eq(adImpressions.viewerId, input.viewerId),
        gte(adImpressions.servedAt, new Date(now.getTime() - DAY_MS)),
      ))
      .groupBy(adImpressions.campaignId),
  ]);
  if (candidates.length === 0) return [];

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const slots = planSponsoredSlots({
    candidates: candidates.map(campaignToCandidate),
    ctx: {
      viewerId: input.viewerId,
      blockedUserIds: blocked,
      mutedPhrases: muted,
      sessionSeenBoostIds: new Set(sessionRows.map((r) => r.campaignId)),
      servedLast24h: new Map(dayRows.map((r) => [r.campaignId, Number(r.n)])),
      now,
    },
    organicOffset: input.organicOffset,
    organicCount: input.organicCount,
  });
  if (slots.length === 0) return [];

  const planned = slots.map((s) => ({ afterIndex: s.afterIndex, campaign: byId.get(s.candidate.boostId)!, token: newServeToken() }));
  const inserted = await db
    .insert(adImpressions)
    .values(planned.map((p) => ({
      campaignId: p.campaign.id,
      sellerId: p.campaign.sellerId,
      viewerId: input.viewerId,
      surface: input.surface,
      sessionId: input.sessionId,
      serveToken: p.token,
      costCents: AD_COST_PER_IMPRESSION_CENTS,
      servedAt: now,
    })))
    .onConflictDoNothing()
    .returning({ serveToken: adImpressions.serveToken });
  const recorded = new Set(inserted.map((r) => r.serveToken));
  const won = planned.filter((p) => recorded.has(p.token));
  if (won.length === 0) return [];

  return hydrateServedAds(won, input.surface);
}

async function hydrateServedAds(
  won: { afterIndex: number; campaign: CandidateRow; token: string }[],
  surface: AdSurface,
): Promise<ServedAd[]> {
  const sellerIds = [...new Set(won.map((w) => w.campaign.sellerId))];
  const productIds = [...new Set(won.flatMap((w) =>
    w.campaign.ctaDestinationKind === "product" && w.campaign.ctaDestinationId ? [w.campaign.ctaDestinationId] : []))];

  const [sellerRows, productRows, priceRows] = await Promise.all([
    db.select({
      clerkId: users.clerkId, displayName: users.displayName, brandName: users.brandName, name: users.name,
      username: users.username, profileImageUrl: users.profileImageUrl, avatarUrl: users.avatarUrl,
    }).from(users).where(inArray(users.clerkId, sellerIds)),
    productIds.length === 0 ? [] : db.select({ id: products.id, name: products.name, images: products.images })
      .from(products).where(inArray(sql`${products.id}::text`, productIds)),
    productIds.length === 0 ? [] : db
      .select({ productId: productVariants.productId, minPriceCents: sql<number>`min(${productVariants.priceCents})::int` })
      .from(productVariants)
      .where(inArray(sql`${productVariants.productId}::text`, productIds))
      .groupBy(productVariants.productId),
  ]);
  const sellers = new Map(sellerRows.map((s) => [s.clerkId, s]));
  const productsById = new Map(productRows.map((p) => [p.id, p]));
  const prices = new Map(priceRows.map((p) => [p.productId, Number(p.minPriceCents)]));

  return Promise.all(won.map(async (w) => {
    const c = w.campaign;
    const seller = sellers.get(c.sellerId);
    const product = c.ctaDestinationKind === "product" && c.ctaDestinationId ? productsById.get(c.ctaDestinationId) : undefined;
    const mediaUrls = await Promise.all(c.mediaObjectPaths.map((p) =>
      objectStorage().getObjectEntityDownloadURL(p).catch(() => null)));
    return {
      afterIndex: w.afterIndex,
      token: w.token,
      campaignId: c.id,
      surface,
      label: "Sponsored" as const,
      headline: c.headline,
      description: c.description,
      mediaKind: c.mediaKind,
      mediaUrls: mediaUrls.filter((u): u is string => typeof u === "string"),
      ctaKind: c.ctaKind,
      ctaLabel: ctaLabel(c.ctaKind),
      destination: adDestination(c),
      seller: {
        id: c.sellerId,
        displayName: seller?.brandName || seller?.displayName || seller?.name || null,
        username: seller?.username ?? null,
        avatarUrl: seller?.profileImageUrl ?? seller?.avatarUrl ?? null,
      },
      product: product ? {
        id: product.id,
        name: product.name,
        imageUrl: (product.images ?? [])[0] ?? null,
        priceCents: prices.get(product.id) ?? null,
      } : null,
    };
  }));
}

// ─── Impression billing ───────────────────────────────────────────────────────

export type ImpressionResult = {
  counted: boolean;
  reason?: "not_served" | "already_counted" | "expired" | "not_active" | "budget_exhausted";
  campaignCompleted?: boolean;
};

type ImpressionRow = typeof adImpressions.$inferSelect;

/**
 * Bills one impression inside `tx`. The impression row and the campaign row
 * are both locked (FOR UPDATE), so concurrent confirmations serialize on the
 * campaign and spend can never pass the budget. When the remaining budget
 * can't buy another impression the campaign completes (budget_spent) in the
 * same transaction, which stops serving immediately.
 */
async function billImpressionInTx(tx: Tx, imp: ImpressionRow, now: Date): Promise<ImpressionResult> {
  if (imp.viewedAt) return { counted: false, reason: "already_counted" };
  if (now.getTime() - imp.servedAt.getTime() > AD_SERVE_TOKEN_TTL_MS) return { counted: false, reason: "expired" };

  const [camp] = await tx
    .select({
      status: adCampaigns.status, spentCents: adCampaigns.spentCents,
      budgetCents: adCampaigns.budgetCents, endsAt: adCampaigns.endsAt,
    })
    .from(adCampaigns)
    .where(eq(adCampaigns.id, imp.campaignId))
    .limit(1)
    .for("update");
  if (!camp || camp.status !== "active" || !camp.endsAt || camp.endsAt <= now) {
    return { counted: false, reason: "not_active" };
  }
  const cost = imp.costCents;
  if (camp.spentCents + cost > camp.budgetCents) {
    await tx.update(adCampaigns).set({
      status: "completed", completionReason: "budget_spent", completedAt: now, updatedAt: now,
    }).where(eq(adCampaigns.id, imp.campaignId));
    return { counted: false, reason: "budget_exhausted", campaignCompleted: true };
  }

  const spent = camp.spentCents + cost;
  const completes = budgetExhausted(spent, camp.budgetCents);
  await tx.update(adCampaigns).set({
    spentCents: spent,
    impressionsCount: sql`${adCampaigns.impressionsCount} + 1`,
    updatedAt: now,
    ...(completes ? { status: "completed", completionReason: "budget_spent", completedAt: now } : {}),
  }).where(eq(adCampaigns.id, imp.campaignId));
  await tx.update(adImpressions).set({ viewedAt: now, billedCents: cost }).where(eq(adImpressions.id, imp.id));
  return { counted: true, campaignCompleted: completes };
}

async function lockImpression(tx: Tx, viewerId: string, token: string): Promise<ImpressionRow | null> {
  const [imp] = await tx
    .select()
    .from(adImpressions)
    .where(and(eq(adImpressions.serveToken, token), eq(adImpressions.viewerId, viewerId)))
    .limit(1)
    .for("update");
  return imp ?? null;
}

/** Confirms a viewable impression for a serve token; bills it once. */
export async function recordAdImpression(input: { viewerId: string; token: string; now?: Date }): Promise<ImpressionResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const imp = await lockImpression(tx, input.viewerId, input.token);
    if (!imp) return { counted: false, reason: "not_served" } as ImpressionResult;
    return billImpressionInTx(tx, imp, now);
  });
}

// ─── Clicks ───────────────────────────────────────────────────────────────────

export type ClickResult =
  | { ok: false; reason: "not_served" }
  | { ok: true; counted: boolean; destination: AdDestination };

/**
 * Records a click on a served ad (once per impression) and returns where the
 * CTA goes. A click proves the ad was on screen, so an impression that hadn't
 * been confirmed yet is billed first (if the campaign can still pay for it).
 */
export async function recordAdClick(input: { viewerId: string; token: string; now?: Date }): Promise<ClickResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const imp = await lockImpression(tx, input.viewerId, input.token);
    if (!imp) return { ok: false, reason: "not_served" } as ClickResult;
    if (!imp.viewedAt) await billImpressionInTx(tx, imp, now);

    const [camp] = await tx
      .select({
        sellerId: adCampaigns.sellerId,
        ctaDestinationKind: adCampaigns.ctaDestinationKind,
        ctaDestinationId: adCampaigns.ctaDestinationId,
      })
      .from(adCampaigns)
      .where(eq(adCampaigns.id, imp.campaignId))
      .limit(1);
    if (!camp) return { ok: false, reason: "not_served" } as ClickResult;

    const inserted = await tx.insert(adClicks).values({
      campaignId: imp.campaignId,
      impressionId: imp.id,
      viewerId: input.viewerId,
      surface: imp.surface,
      createdAt: now,
    }).onConflictDoNothing().returning({ id: adClicks.id });
    if (inserted.length > 0) {
      await tx.update(adCampaigns)
        .set({ clicksCount: sql`${adCampaigns.clicksCount} + 1` })
        .where(eq(adCampaigns.id, imp.campaignId));
    }
    return { ok: true, counted: inserted.length > 0, destination: adDestination(camp) } as ClickResult;
  });
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/** Completes every active/paused campaign whose flight is over. Returns how many. */
export async function completeEndedAdCampaigns(now: Date = new Date(), sellerId?: string): Promise<number> {
  const rows = await db.update(adCampaigns)
    .set({ status: "completed", completionReason: "ended", completedAt: now, updatedAt: now })
    .where(and(
      inArray(adCampaigns.status, ["active", "paused"]),
      isNotNull(adCampaigns.endsAt),
      lte(adCampaigns.endsAt, now),
      sellerId ? eq(adCampaigns.sellerId, sellerId) : undefined,
    ))
    .returning({ id: adCampaigns.id });
  return rows.length;
}

// ─── Seller results ───────────────────────────────────────────────────────────

export type AdResultsSummary = {
  impressions: number;
  uniqueReach: number;
  clicks: number;
  ctrPercent: number;
  spentCents: number;
  budgetCents: number;
  remainingCents: number;
};

type CampaignCounters = { id: string; impressionsCount: number; clicksCount: number; spentCents: number; budgetCents: number };

/** Summaries for the campaign list (one grouped query for unique reach). */
export async function adResultsSummaries(campaigns: readonly CampaignCounters[]): Promise<Map<string, AdResultsSummary>> {
  const ids = campaigns.map((c) => c.id);
  const reachRows = ids.length === 0 ? [] : await db
    .select({ campaignId: adImpressions.campaignId, reach: sql<number>`count(DISTINCT ${adImpressions.viewerId})::int` })
    .from(adImpressions)
    .where(and(inArray(adImpressions.campaignId, ids), isNotNull(adImpressions.viewedAt)))
    .groupBy(adImpressions.campaignId);
  const reach = new Map(reachRows.map((r) => [r.campaignId, Number(r.reach)]));
  return new Map(campaigns.map((c) => [c.id, summarize(c, reach.get(c.id) ?? 0)]));
}

function summarize(c: CampaignCounters, uniqueReach: number): AdResultsSummary {
  return {
    impressions: c.impressionsCount,
    uniqueReach,
    clicks: c.clicksCount,
    ctrPercent: ctrPercent(c.clicksCount, c.impressionsCount),
    spentCents: c.spentCents,
    budgetCents: c.budgetCents,
    remainingCents: Math.max(0, c.budgetCents - c.spentCents),
  };
}

export type AdSurfaceResults = { surface: AdSurface; impressions: number; clicks: number; spendCents: number };

export type AdCampaignResults = AdResultsSummary & {
  bySurface: AdSurfaceResults[];
  daily: DailyPoint[];
  attribution: { windowDays: number; orders: number; revenueCents: number };
};

export async function adCampaignResults(campaign: typeof adCampaigns.$inferSelect, now: Date = new Date()): Promise<AdCampaignResults> {
  const id = campaign.id;
  const [reachRow] = await db
    .select({ reach: sql<number>`count(DISTINCT ${adImpressions.viewerId})::int` })
    .from(adImpressions)
    .where(and(eq(adImpressions.campaignId, id), isNotNull(adImpressions.viewedAt)));

  const [surfaceImp, surfaceClicks, dailyImp, dailyClicks, attribution] = await Promise.all([
    db.select({
      surface: adImpressions.surface,
      impressions: sql<number>`count(*)::int`,
      spend: sql<number>`coalesce(sum(${adImpressions.billedCents}), 0)::int`,
    }).from(adImpressions)
      .where(and(eq(adImpressions.campaignId, id), isNotNull(adImpressions.viewedAt)))
      .groupBy(adImpressions.surface),
    db.select({ surface: adClicks.surface, clicks: sql<number>`count(*)::int` })
      .from(adClicks).where(eq(adClicks.campaignId, id)).groupBy(adClicks.surface),
    db.select({
      day: sql<string>`to_char(${adImpressions.viewedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      impressions: sql<number>`count(*)::int`,
      spend: sql<number>`coalesce(sum(${adImpressions.billedCents}), 0)::int`,
    }).from(adImpressions)
      .where(and(eq(adImpressions.campaignId, id), isNotNull(adImpressions.viewedAt)))
      .groupBy(sql`1`),
    db.select({
      day: sql<string>`to_char(${adClicks.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      clicks: sql<number>`count(*)::int`,
    }).from(adClicks).where(eq(adClicks.campaignId, id)).groupBy(sql`1`),
    attributedOrders(campaign),
  ]);

  const impBySurface = new Map(surfaceImp.map((r) => [r.surface, r]));
  const clicksBySurface = new Map(surfaceClicks.map((r) => [r.surface, Number(r.clicks)]));
  const bySurface = AD_SURFACES.map((surface) => ({
    surface,
    impressions: Number(impBySurface.get(surface)?.impressions ?? 0),
    clicks: clicksBySurface.get(surface) ?? 0,
    spendCents: Number(impBySurface.get(surface)?.spend ?? 0),
  }));

  let daily: DailyPoint[] = [];
  if (campaign.startsAt) {
    const flightEnd = campaign.completedAt ?? campaign.endsAt ?? now;
    const end = flightEnd < now ? flightEnd : now;
    daily = fillDailySeries(
      flightDays(campaign.startsAt, end < campaign.startsAt ? campaign.startsAt : end),
      new Map(dailyImp.map((r) => [r.day, { impressions: Number(r.impressions), spendCents: Number(r.spend) }])),
      new Map(dailyClicks.map((r) => [r.day, Number(r.clicks)])),
    );
  }

  return {
    ...summarize(campaign, Number(reachRow?.reach ?? 0)),
    bySurface,
    daily,
    attribution,
  };
}

/**
 * Paid orders from buyers who clicked this campaign, placed within
 * AD_ATTRIBUTION_WINDOW_DAYS after the click: orders containing the advertised
 * product for product CTAs, any order from the seller's store otherwise.
 * Cancelled orders are excluded.
 */
async function attributedOrders(campaign: typeof adCampaigns.$inferSelect): Promise<AdCampaignResults["attribution"]> {
  const windowDays = AD_ATTRIBUTION_WINDOW_DAYS;
  const productId = campaign.ctaDestinationKind === "product" ? campaign.ctaDestinationId : null;
  const clicked = sql`EXISTS (
    SELECT 1 FROM ad_clicks c
    WHERE c.campaign_id = ${campaign.id}
      AND c.viewer_id = o.buyer_id
      AND (o.paid_at AT TIME ZONE 'UTC') >= c.created_at
      AND (o.paid_at AT TIME ZONE 'UTC') < c.created_at + make_interval(days => ${windowDays})
  )`;
  const result = productId
    ? await db.execute(sql`
        SELECT count(DISTINCT o.id)::int AS orders,
               coalesce(sum(oi.price_cents * oi.quantity), 0)::int AS revenue
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE o.owner_id = ${campaign.sellerId}
          AND o.paid_at IS NOT NULL AND o.buyer_id IS NOT NULL AND o.status <> 'cancelled'
          AND pv.product_id::text = ${productId}
          AND ${clicked}`)
    : await db.execute(sql`
        SELECT count(*)::int AS orders, coalesce(sum(o.total_cents), 0)::int AS revenue
        FROM orders o
        WHERE o.owner_id = ${campaign.sellerId}
          AND o.paid_at IS NOT NULL AND o.buyer_id IS NOT NULL AND o.status <> 'cancelled'
          AND ${clicked}`);
  const row = (result as unknown as { rows: { orders: number; revenue: number }[] }).rows[0];
  return { windowDays, orders: Number(row?.orders ?? 0), revenueCents: Number(row?.revenue ?? 0) };
}
