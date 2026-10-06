/**
 * Drizzle implementation of PromoStore plus the RevenueCat purchase lookup.
 * Kept apart from iapPromotions.ts so the rules there stay DB-free.
 */
import { ReplitConnectors } from "@replit/connectors-sdk";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { adCampaigns, boosts, db, featuredSlots, iapPromotionPurchases, posts } from "@workspace/db";
import { checkPostMediaEligibility, estimateBoostReach } from "../routes/boosts";
import { activateFeaturedSlotFromStore } from "../routes/featured-slots";
import {
  findPurchaseInPayload,
  type ActivateResult,
  type PromoKind,
  type PromoStore,
  type PurchaseRow,
} from "./iapPromotions";

const AD_CAMPAIGN_BUDGET_MIN_CENTS = 500;

function toRow(r: typeof iapPromotionPurchases.$inferSelect): PurchaseRow {
  return {
    transactionId: r.transactionId,
    appUserId: r.appUserId,
    productId: r.productId,
    kind: r.kind as PromoKind,
    amountCents: r.amountCents,
    targetId: r.targetId,
    grantedAt: r.grantedAt,
  };
}

async function activateBoost(id: string, paidAt: Date): Promise<ActivateResult> {
  const [boost] = await db.select().from(boosts).where(eq(boosts.id, id)).limit(1);
  if (!boost) return "ineligible";
  if (boost.status === "active") return "already_active";
  if (boost.status !== "pending_payment" && boost.status !== "failed") return "ineligible";

  const [post] = await db.select({
    userId: posts.userId, mediaType: posts.mediaType, mediaUrl: posts.mediaUrl,
    mediaUrls: posts.mediaUrls, mediaPaths: posts.mediaPaths, postStatus: posts.postStatus,
    scheduledAt: posts.scheduledAt, visibility: posts.visibility,
  }).from(posts).where(eq(posts.id, boost.targetId)).limit(1);
  if (!post) return "ineligible";
  const eligibility = checkPostMediaEligibility({
    ...post,
    mediaUrls: post.mediaUrls as string[] | null,
    mediaPaths: post.mediaPaths as string[] | null,
    visibility: post.visibility as { isPublic?: boolean } | null,
  });
  if (!eligibility.eligible) return "ineligible";

  const [updated] = await db.update(boosts).set({
    status: "active",
    paidAt,
    startsAt: paidAt,
    endsAt: new Date(paidAt.getTime() + boost.durationDays * 86_400_000),
    spentCents: boost.budgetCents,
  }).where(and(eq(boosts.id, id), inArray(boosts.status, ["pending_payment", "failed"]))).returning({ id: boosts.id });
  // Lost the race to another delivery: it is active now.
  return updated ? "activated" : "already_active";
}

async function activateCampaign(id: string, paidAt: Date): Promise<ActivateResult> {
  const [campaign] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, id)).limit(1);
  if (!campaign) return "ineligible";
  if (campaign.status === "active") return "already_active";
  if (!["draft", "pending_payment", "failed"].includes(campaign.status)) return "ineligible";
  // Same readiness rules as POST /ad-campaigns/:id/pay.
  if (campaign.mediaObjectPaths.length === 0 || !campaign.ctaKind
    || !campaign.formats || (campaign.formats as string[]).length === 0
    || campaign.budgetCents < AD_CAMPAIGN_BUDGET_MIN_CENTS) return "ineligible";

  const reach = estimateBoostReach(campaign.budgetCents);
  const [updated] = await db.update(adCampaigns).set({
    status: "active",
    paidAt,
    startsAt: paidAt,
    endsAt: new Date(paidAt.getTime() + campaign.durationDays * 86_400_000),
    estimatedReachLow: reach.low,
    estimatedReachHigh: reach.high,
    updatedAt: new Date(),
  }).where(and(eq(adCampaigns.id, id), inArray(adCampaigns.status, ["draft", "pending_payment", "failed"])))
    .returning({ id: adCampaigns.id });
  return updated ? "activated" : "already_active";
}

export const drizzlePromoStore: PromoStore = {
  async claimPurchase(row) {
    const [inserted] = await db.insert(iapPromotionPurchases).values({
      transactionId: row.transactionId,
      appUserId: row.appUserId,
      productId: row.productId,
      kind: row.kind,
      amountCents: row.amountCents,
      source: row.source,
    }).onConflictDoNothing().returning();
    if (inserted) return { created: true, purchase: toRow(inserted) };
    const [existing] = await db.select().from(iapPromotionPurchases)
      .where(eq(iapPromotionPurchases.transactionId, row.transactionId)).limit(1);
    return { created: false, purchase: toRow(existing) };
  },

  async findTarget(kind, ownerId, explicitId) {
    if (kind === "boost") {
      const where = explicitId
        ? and(eq(boosts.id, explicitId), eq(boosts.sellerId, ownerId))
        : and(eq(boosts.sellerId, ownerId), eq(boosts.status, "pending_payment"));
      const [row] = await db.select({ id: boosts.id, budgetCents: boosts.budgetCents })
        .from(boosts).where(where).orderBy(desc(boosts.createdAt)).limit(1);
      return row ?? null;
    }
    if (kind === "featured_slot") {
      const where = explicitId
        ? and(eq(featuredSlots.id, explicitId), eq(featuredSlots.sellerId, ownerId))
        : and(eq(featuredSlots.sellerId, ownerId), eq(featuredSlots.status, "pending_payment"));
      const [row] = await db.select({ id: featuredSlots.id, budgetCents: featuredSlots.priceCents })
        .from(featuredSlots).where(where).orderBy(desc(featuredSlots.createdAt)).limit(1);
      return row ?? null;
    }
    const where = explicitId
      ? and(eq(adCampaigns.id, explicitId), eq(adCampaigns.sellerId, ownerId))
      : and(eq(adCampaigns.sellerId, ownerId), eq(adCampaigns.status, "pending_payment"));
    const [row] = await db.select({ id: adCampaigns.id, budgetCents: adCampaigns.budgetCents })
      .from(adCampaigns).where(where).orderBy(desc(adCampaigns.createdAt)).limit(1);
    return row ?? null;
  },

  activate: (kind, targetId, paidAt) => (
    kind === "boost" ? activateBoost(targetId, paidAt)
      : kind === "featured_slot" ? activateFeaturedSlotFromStore(targetId, paidAt)
        : activateCampaign(targetId, paidAt)),

  async markGranted(transactionId, targetId, at) {
    await db.update(iapPromotionPurchases)
      .set({ targetId, grantedAt: at })
      .where(and(eq(iapPromotionPurchases.transactionId, transactionId), sql`${iapPromotionPurchases.grantedAt} IS NULL`));
  },
};

/**
 * Reads the customer's purchases from RevenueCat (server-side, through the
 * same connector nativeEntitlements uses) and confirms this transaction exists.
 */
export async function lookupRevenueCatPurchase(appUserId: string, transactionId: string) {
  const projectId = process.env.REVENUECAT_PROJECT_ID;
  if (!projectId) throw new Error("REVENUECAT_PROJECT_ID is required to verify native purchases");
  const connectors = new ReplitConnectors();
  const base = `/v2/projects/${encodeURIComponent(projectId)}`;
  const [purchasesRes, productsRes] = await Promise.all([
    connectors.proxy("revenuecat", `${base}/customers/${encodeURIComponent(appUserId)}/purchases?limit=100`, {
      method: "GET", headers: { Accept: "application/json" },
    }),
    connectors.proxy("revenuecat", `${base}/products?limit=100`, { method: "GET", headers: { Accept: "application/json" } }),
  ]);
  const [purchasesText, productsText] = await Promise.all([purchasesRes.text(), productsRes.text()]);
  if (!purchasesRes.ok) throw new Error(`RevenueCat purchase lookup failed (${purchasesRes.status})`);
  if (!productsRes.ok) throw new Error(`RevenueCat product lookup failed (${productsRes.status})`);
  const products = (productsText ? JSON.parse(productsText) : {}) as { items?: Array<{ id?: string; store_identifier?: string }> };
  const storeIds = Object.fromEntries(
    (products.items ?? []).flatMap((p) => (p.id && p.store_identifier ? [[p.id, p.store_identifier]] : [])),
  );
  return findPurchaseInPayload(purchasesText ? JSON.parse(purchasesText) : {}, storeIds, transactionId);
}
