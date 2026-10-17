/**
 * Seller launch checklist (migration 114).
 * GET  /api/seller/launch-checklist               — ordered steps + done flags from real account state
 * POST /api/seller/launch-checklist/preview-seen  — the seller has viewed their store as a buyer
 * POST /api/seller/launch-checklist/dismiss       — hide the dashboard card
 * GET  /api/seller/launch-checklist/setup         — guided "Store setup" tasks: derived done flags,
 *                                                   stored per-seller state, goal-based order
 * PUT  /api/seller/launch-checklist/setup         — save per-seller setup state (skips, tips, ...)
 */
import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db, posts, products, shippingRates, shippingZones, storefrontCustomDomains, storefronts, users,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { deriveLaunchChecklist } from "../lib/launchChecklist";
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
