/**
 * Seller payment settings. Mounted at /api/seller/payment-settings.
 * GET   -> { bnplEnabled, bnplAvailable }  (bnplAvailable = platform switch on)
 * PATCH -> sets the seller's Klarna / Afterpay opt-in.
 *
 * publicPayLaterRouter, mounted at /api/public (no auth):
 * GET /sellers/:sellerId/pay-later -> { eligible, minCents }
 *   eligible = platform switch on AND the seller opted in. Read-only; used by
 *   the product page's "or 4 interest-free payments" line. With the platform
 *   switch off it answers false without reading the seller's setting, so the
 *   opt-in itself is never exposed.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, sellerPaymentSettings } from "@workspace/db";
import { z } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { validateRequest } from "../middlewares/validateRequest";
import { bnplMinOrderCents, bnplPlatformEnabled } from "../lib/payments/bnpl";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const [row] = await db.select().from(sellerPaymentSettings).where(eq(sellerPaymentSettings.sellerId, sellerId)).limit(1);
  res.json({ bnplEnabled: row?.bnplEnabled ?? false, bnplAvailable: bnplPlatformEnabled() });
});

router.patch("/", validateRequest({ body: z.object({ bnplEnabled: z.boolean() }) }), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { bnplEnabled } = req.body as { bnplEnabled: boolean };
  await db.insert(sellerPaymentSettings).values({ sellerId, bnplEnabled })
    .onConflictDoUpdate({ target: sellerPaymentSettings.sellerId, set: { bnplEnabled, updatedAt: new Date() } });
  res.json({ bnplEnabled, bnplAvailable: bnplPlatformEnabled() });
});

export default router;

export const publicPayLaterRouter = Router();

const SELLER_ID = /^[A-Za-z0-9_-]{1,128}$/;

publicPayLaterRouter.get("/sellers/:sellerId/pay-later", async (req, res) => {
  const sellerId = String(req.params.sellerId ?? "");
  if (!SELLER_ID.test(sellerId)) {
    res.status(400).json({ error: "Invalid seller id" });
    return;
  }
  const minCents = bnplMinOrderCents();
  let eligible = false;
  if (bnplPlatformEnabled()) {
    try {
      const [row] = await db.select({ bnplEnabled: sellerPaymentSettings.bnplEnabled })
        .from(sellerPaymentSettings).where(eq(sellerPaymentSettings.sellerId, sellerId)).limit(1);
      eligible = row?.bnplEnabled === true;
    } catch (err) {
      logger.warn({ err }, "pay-later lookup failed; hiding the line");
    }
  }
  res.set("Cache-Control", "public, max-age=60");
  res.json({ eligible, minCents });
});
