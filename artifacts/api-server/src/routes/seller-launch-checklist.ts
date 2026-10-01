/**
 * Seller launch checklist (migration 114).
 * GET  /api/seller/launch-checklist               — ordered steps + done flags from real account state
 * POST /api/seller/launch-checklist/preview-seen  — the seller has viewed their store as a buyer
 * POST /api/seller/launch-checklist/dismiss       — hide the dashboard card
 */
import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, products, storefronts, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { deriveLaunchChecklist } from "../lib/launchChecklist";

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

export default router;
