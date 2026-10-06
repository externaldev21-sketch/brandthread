/**
 * Native (iOS / Android) purchase rail for Boost and Create-ad.
 *
 * GET  /api/iap-promotions/config             — { enabled, products } so the app knows
 *                                               whether to use the store sheet
 * POST /api/iap-promotions/boost/:id/verify    — body { transactionId }
 * POST /api/iap-promotions/campaign/:id/verify — body { transactionId }
 * POST /api/iap-promotions/featured/:id/verify — body { transactionId } (QA-0004)
 *
 * verify re-reads the purchase from RevenueCat (never trusts the device) and
 * grants through lib/iapPromotions, idempotent on the store transaction id.
 * On by default; IAP_PROMOTIONS_ENABLED=false is an emergency kill switch.
 */
import express, { Router } from "express";
import { getAuth } from "@clerk/express";
import { requireAuth, requirePlan } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import {
  IAP_PROMO_TIER_DOLLARS,
  allPromoProductIds,
  grantPromotionPurchase,
  iapPromotionsEnabled,
  type GrantResult,
  type PromoKind,
} from "../lib/iapPromotions";
import { drizzlePromoStore, lookupRevenueCatPurchase } from "../lib/iapPromotionsStore";

const router = Router();
router.use(requireAuth);

router.get("/config", (_req, res) => {
  res.json({
    enabled: iapPromotionsEnabled(),
    tiersCents: IAP_PROMO_TIER_DOLLARS.map((d) => d * 100),
    products: iapPromotionsEnabled() ? allPromoProductIds() : [],
  });
});

function statusFor(result: GrantResult): number {
  switch (result.status) {
    case "granted":
    case "already_granted":
      return 200;
    case "unmatched":
      return 404;
    case "ineligible":
    case "amount_mismatch":
    case "conflict":
      return 409;
    default:
      return 400;
  }
}

function verifyHandler(kind: PromoKind): express.RequestHandler {
  return async (req, res) => {
    if (!iapPromotionsEnabled()) {
      res.status(503).json({ error: "Native purchases are not enabled.", code: "iap_disabled" });
      return;
    }
    const transactionId = typeof req.body?.transactionId === "string" ? req.body.transactionId.trim() : "";
    if (!transactionId) {
      res.status(400).json({ error: "transactionId is required" });
      return;
    }
    // The purchaser is the signed-in user (RevenueCat app user id); the target
    // belongs to the store owner, which differs only for team members.
    const purchaserId = getAuth(req).userId;
    const ownerId = (req as any).clerkUserId as string | undefined;
    if (!purchaserId || !ownerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const purchase = await lookupRevenueCatPurchase(purchaserId, transactionId);
      if (!purchase) {
        // The store receipt may not have reached RevenueCat yet; the client retries
        // and the RevenueCat webhook grants it regardless.
        res.status(404).json({ error: "Purchase not found yet.", code: "purchase_not_found" });
        return;
      }
      const result = await grantPromotionPurchase(drizzlePromoStore, {
        appUserId: purchaserId,
        ownerId,
        transactionId: purchase.transactionId,
        productId: purchase.productId,
        source: "client_verify",
        explicitTargetId: String(req.params.id),
        expectedKind: kind,
      });
      res.status(statusFor(result)).json(result);
    } catch (err) {
      req.log?.error?.({ err, kind, targetId: req.params.id }, "Native promotion purchase verification failed");
      res.status(502).json({ error: "Could not verify the purchase. It will be applied automatically.", code: "verify_unavailable" });
    }
  };
}

router.post("/boost/:id/verify", requirePlan("pro"), express.json({ limit: "4kb" }), verifyHandler("boost"));
router.post("/campaign/:id/verify", requirePermission("marketing"), express.json({ limit: "4kb" }), verifyHandler("ad_campaign"));
// Featured slots belong to the seller account itself (featured-slots.ts checks
// the same); the slot lookup is scoped to the signed-in owner.
router.post("/featured/:id/verify", express.json({ limit: "4kb" }), verifyHandler("featured_slot"));

export default router;
