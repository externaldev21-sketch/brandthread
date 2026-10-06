/**
 * Seller payment settings. Mounted at /api/seller/payment-settings.
 * GET   -> { bnplEnabled, bnplAvailable }  (bnplAvailable = platform switch on)
 * PATCH -> sets the seller's Klarna / Afterpay opt-in.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, sellerPaymentSettings } from "@workspace/db";
import { z } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { validateRequest } from "../middlewares/validateRequest";
import { bnplPlatformEnabled } from "../lib/payments/bnpl";

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
