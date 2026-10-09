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
import { db, orders, products, sellerStoreShares, shippingRates, shippingZones, storefronts, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { deriveLaunchChecklist } from "../lib/launchChecklist";
import { deriveReadyToSell } from "../lib/readyToSell";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;

  const [[user], [store], [productRow]] = await Promise.all([
    db.select({
      brandName: users.brandName,
      username: users.username,
      logoUrl: users.logoUrl,
      bannerUrl: users.bannerUrl,
      storeAccentColor: users.storeAccentColor,
      socialLinks: users.socialLinks,
      storePreviewedAt: users.storePreviewedAt,
      launchChecklistDismissedAt: users.launchChecklistDismissedAt,
      stripeAccountStatus: users.stripeAccountStatus,
    }).from(users).where(eq(users.clerkId, clerkId)).limit(1),
    db.select({ status: storefronts.status }).from(storefronts)
      .where(eq(storefronts.ownerId, clerkId)).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(products)
      .where(and(eq(products.ownerId, clerkId), isNull(products.deletedAt))),
  ]);

  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const checklist = deriveLaunchChecklist({
    ...user,
    productCount: Number(productRow?.n ?? 0),
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

export default router;
