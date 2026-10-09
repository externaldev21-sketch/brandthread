/**
 * Native (iOS / Android) purchase rail for Boost, Create-ad and Featured.
 *
 * GET  /api/iap-promotions/config                    — { enabled, products } so the app knows
 *                                                      whether to use the store sheet
 * GET  /api/iap-promotions/credits                   — unspent store purchases (credit)
 * POST /api/iap-promotions/boost/:id/verify           — body { transactionId }
 * POST /api/iap-promotions/campaign/:id/verify        — body { transactionId }
 * POST /api/iap-promotions/featured/:id/verify        — body { transactionId }
 * POST /api/iap-promotions/{boost|campaign|featured}/:id/apply-credit
 *                                                    — pay with an unspent purchase of the same amount
 *
 * verify re-reads the purchase from RevenueCat (never trusts the device) and
 * grants through lib/iapPromotions, idempotent on the store transaction id.
 * On by default; IAP_PROMOTIONS_ENABLED=false pauses it.
 */
import express, { Router } from "express";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { getAuth } from "@clerk/express";
import { requireAuth, requirePlan } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import {
  IAP_PROMO_TIER_DOLLARS,
  allPromoProductIds,
  applyPromotionCredit,
  grantPromotionPurchase,
  iapPromotionsEnabled,
  type GrantResult,
  type PromoKind,
} from "../lib/iapPromotions";
import { drizzlePromoStore, listPromotionCredits, lookupRevenueCatPurchase } from "../lib/iapPromotionsStore";

const router = Router();
router.use(requireAuth);

router.get("/config", (_req, res) => {
  res.json({
    enabled: iapPromotionsEnabled(),
    tiersCents: IAP_PROMO_TIER_DOLLARS.map((d) => d * 100),
    products: iapPromotionsEnabled() ? allPromoProductIds() : [],
  });
});

router.get("/credits", async (req, res) => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    res.json({ credits: await listPromotionCredits(userId) });
  } catch (err) {
    req.log?.error?.({ err }, "Could not list promotion credits");
    res.status(500).json({ error: "Could not load credits." });
  }
});

/** Featured slots are sold to seller accounts only (same rule as /api/featured-slots). */
async function requireSellerAccount(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ownerId = (req as any).clerkUserId as string | undefined;
  const [u] = ownerId
    ? await db.select({ accountType: users.accountType }).from(users).where(eq(users.clerkId, ownerId)).limit(1)
    : [];
  if (u?.accountType !== "seller") {
    res.status(403).json({ error: "Only sellers can buy a Featured slot", code: "seller_only" });
    return;
  }
  next();
}

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

function applyCreditHandler(kind: PromoKind): express.RequestHandler {
  return async (req, res) => {
    if (!iapPromotionsEnabled()) {
      res.status(503).json({ error: "Native purchases are not enabled.", code: "iap_disabled" });
      return;
    }
    const purchaserId = getAuth(req).userId;
    const ownerId = (req as any).clerkUserId as string | undefined;
    if (!purchaserId || !ownerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const result = await applyPromotionCredit(drizzlePromoStore, {
        appUserId: purchaserId, ownerId, kind, targetId: String(req.params.id),
      });
      const status = result.status === "granted" || result.status === "already_active" ? 200
        : result.status === "ineligible" ? 409 : 404;
      res.status(status).json(result);
    } catch (err) {
      req.log?.error?.({ err, kind, targetId: req.params.id }, "Applying promotion credit failed");
      res.status(500).json({ error: "Could not apply credit." });
    }
  };
}

const json4kb = express.json({ limit: "4kb" });
router.post("/boost/:id/verify", requirePlan("pro"), json4kb, verifyHandler("boost"));
router.post("/campaign/:id/verify", requirePermission("marketing"), json4kb, verifyHandler("ad_campaign"));
router.post("/featured/:id/verify", requireSellerAccount, json4kb, verifyHandler("featured_slot"));
router.post("/boost/:id/apply-credit", requirePlan("pro"), applyCreditHandler("boost"));
router.post("/campaign/:id/apply-credit", requirePermission("marketing"), applyCreditHandler("ad_campaign"));
router.post("/featured/:id/apply-credit", requireSellerAccount, applyCreditHandler("featured_slot"));

export default router;
