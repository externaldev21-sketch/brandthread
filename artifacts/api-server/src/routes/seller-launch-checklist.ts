/**
 * Seller launch checklist (migration 114).
 * GET  /api/seller/launch-checklist               — ordered steps + done flags from real account state
 * POST /api/seller/launch-checklist/preview-seen  — the seller has viewed their store as a buyer
 * POST /api/seller/launch-checklist/dismiss       — hide the dashboard card
 * GET  /api/seller/launch-checklist/ready-to-sell — dashboard "Get ready to sell" (6 steps + first sale)
 * POST /api/seller/launch-checklist/store-shared  — the seller copied / shared their store link
 */
import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, orders, posts, products, sellerStoreShares, shippingRates, shippingZones, storefrontCustomDomains, storefronts, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { deriveLaunchChecklist } from "../lib/launchChecklist";
import { deriveReadyToSell } from "../lib/readyToSell";
import { profileBannerFromRow } from "../lib/profileCover";
import {
  DERIVED_SETUP_TASK_IDS,
  deriveSetupTasks,
  normalizeOnboardingGoals,
  orderSetupTasks,
  sanitizeSetupState,
} from "../lib/sellerSetupChecklist";
import { getOrCreateStorefront } from "./store";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;

  const [[user], [store], [productRow], [zoneRow], [rateRow]] = await Promise.all([
    db.select({
      brandName: users.brandName,
      username: users.username,
      logoUrl: users.logoUrl,
      bannerUrl: users.bannerUrl,
      coverVideoUrl: users.coverVideoUrl,
      coverImageUrl: users.coverImageUrl,
      coverMediaType: users.coverMediaType,
      storeAccentColor: users.storeAccentColor,
      socialLinks: users.socialLinks,
      storePreviewedAt: users.storePreviewedAt,
      launchChecklistDismissedAt: users.launchChecklistDismissedAt,
      stripeAccountStatus: users.stripeAccountStatus,
    }).from(users).where(eq(users.clerkId, clerkId)).limit(1),
    db.select({ status: storefronts.status }).from(storefronts)
      .where(eq(storefronts.ownerId, clerkId)).limit(1),
    // Only products buyers can see count (drafts and archived don't).
    db.select({ n: sql<number>`count(*)::int` }).from(products)
      .where(and(eq(products.ownerId, clerkId), eq(products.status, "active"), isNull(products.deletedAt))),
    db.select({ n: sql<number>`count(*)::int` }).from(shippingZones)
      .where(eq(shippingZones.sellerId, clerkId)),
    db.select({ n: sql<number>`count(*)::int` }).from(shippingRates)
      .where(eq(shippingRates.sellerId, clerkId)),
  ]);

  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  // One banner: the profile banner (or a not-yet-adopted storefront banner) counts.
  const hasBanner = !!profileBannerFromRow(user) || !!user.bannerUrl;
  const checklist = deriveLaunchChecklist({
    ...user,
    bannerUrl: hasBanner ? "set" : null,
    productCount: Number(productRow?.n ?? 0),
    shippingConfigured: Number(zoneRow?.n ?? 0) + Number(rateRow?.n ?? 0) > 0,
    storePublished: store?.status === "published",
  });

  res.json({
    ...checklist,
    handle: user.username,
    dismissed: user.launchChecklistDismissedAt != null,
  });
});

router.post("/preview-seen", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  await db.update(users)
    .set({ storePreviewedAt: new Date() })
    .where(and(eq(users.clerkId, clerkId), isNull(users.storePreviewedAt)));
  res.status(204).end();
});

router.post("/dismiss", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  await db.update(users)
    .set({ launchChecklistDismissedAt: new Date() })
    .where(eq(users.clerkId, clerkId));
  res.status(204).end();
});

router.get("/ready-to-sell", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;

  const [[user], [store], [productRow], [rateRow], [zoneRow], [share], [orderRow]] = await Promise.all([
    db.select({
      brandName: users.brandName,
      logoUrl: users.logoUrl,
      storeAccentColor: users.storeAccentColor,
      stripeAccountStatus: users.stripeAccountStatus,
    }).from(users).where(eq(users.clerkId, clerkId)).limit(1),
    db.select({ id: storefronts.id }).from(storefronts).where(eq(storefronts.ownerId, clerkId)).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(products)
      .where(and(eq(products.ownerId, clerkId), isNull(products.deletedAt))),
    db.select({ id: shippingRates.id }).from(shippingRates)
      .where(and(eq(shippingRates.sellerId, clerkId), eq(shippingRates.active, true))).limit(1),
    db.select({ id: shippingZones.id }).from(shippingZones).where(eq(shippingZones.sellerId, clerkId)).limit(1),
    db.select({ at: sellerStoreShares.firstSharedAt }).from(sellerStoreShares)
      .where(eq(sellerStoreShares.sellerId, clerkId)).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(orders)
      .where(and(eq(orders.ownerId, clerkId), sql`${orders.status} <> 'cancelled'`)),
  ]);

  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  res.json(deriveReadyToSell({
    ...user,
    productCount: Number(productRow?.n ?? 0),
    hasShippingRates: Boolean(rateRow || zoneRow),
    storefrontSaved: Boolean(store),
    storeShared: Boolean(share),
    orderCount: Number(orderRow?.n ?? 0),
  }));
});

router.post("/store-shared", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  await db.insert(sellerStoreShares)
    .values({ sellerId: clerkId })
    .onConflictDoUpdate({
      target: sellerStoreShares.sellerId,
      set: { lastSharedAt: new Date(), shareCount: sql`${sellerStoreShares.shareCount} + 1` },
    });
  res.status(204).end();
});
async function loadSetupChecklist(clerkId: string) {
  const sf = await getOrCreateStorefront(clerkId);
  const [[user], [productRow], [rateRow], [zoneRow], [domainRow], [postRow]] = await Promise.all([
    db.select({
      accountType: users.accountType,
      onboardingComplete: users.onboardingComplete,
      stripeAccountStatus: users.stripeAccountStatus,
      logoUrl: users.logoUrl,
    }).from(users).where(eq(users.clerkId, clerkId)).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(products)
      .where(and(eq(products.ownerId, clerkId), isNull(products.deletedAt))),
    db.select({ n: sql<number>`count(*)::int` }).from(shippingRates)
      .where(and(eq(shippingRates.sellerId, clerkId), eq(shippingRates.active, true))),
    db.select({ n: sql<number>`count(*)::int` }).from(shippingZones)
      .where(eq(shippingZones.sellerId, clerkId)),
    db.select({ n: sql<number>`count(*)::int` }).from(storefrontCustomDomains)
      .where(and(eq(storefrontCustomDomains.storefrontId, sf.id), eq(storefrontCustomDomains.verified, true))),
    db.select({ n: sql<number>`count(*)::int` }).from(posts)
      .where(and(eq(posts.userId, clerkId), eq(posts.postStatus, "published"))),
  ]);
  if (!user) return null;
  const derived = deriveSetupTasks({
    accountType: user.accountType,
    onboardingComplete: user.onboardingComplete,
    stripeAccountStatus: user.stripeAccountStatus,
    productCount: Number(productRow?.n ?? 0),
    shippingConfigured: Number(rateRow?.n ?? 0) + Number(zoneRow?.n ?? 0) > 0,
    logoUrl: user.logoUrl,
    verifiedDomain: Number(domainRow?.n ?? 0) > 0,
    storePublished: sf.status === "published",
    postCount: Number(postRow?.n ?? 0),
  });
  const goals = normalizeOnboardingGoals((sf.onboarding as Record<string, unknown> | null)?.goals);
  return {
    storefrontId: sf.id,
    body: {
      derived,
      derivedTaskIds: DERIVED_SETUP_TASK_IDS,
      state: sanitizeSetupState(sf.setupChecklist),
      goals,
      order: orderSetupTasks(goals),
    },
  };
}

router.get("/setup", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const result = await loadSetupChecklist(clerkId);
  if (!result) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json(result.body);
});

router.put("/setup", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const body = req.body?.state;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ error: "state must be an object" });
    return;
  }
  const state = sanitizeSetupState(body);
  const sf = await getOrCreateStorefront(clerkId);
  await db.update(storefronts)
    .set({ setupChecklist: state as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(storefronts.id, sf.id));
  const result = await loadSetupChecklist(clerkId);
  if (!result) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json(result.body);
});

export default router;
