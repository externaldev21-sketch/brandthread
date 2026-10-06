/**
 * The seller Checkout settings' post-purchase offer, conversion tracking and
 * the buyer checkout's store profile (language + checkout mode).
 *
 * Seller (signed in, team context → the store owner):
 *   GET  /api/seller/post-purchase-offer      the offer + its product (or null)
 *   PUT  /api/seller/post-purchase-offer      { enabled, productId, discountPercent }
 *   GET  /api/seller/conversion-tracking      IDs + masked secrets
 *   PUT  /api/seller/conversion-tracking      { metaPixelId?, metaAccessToken?, … } (null clears)
 *
 * Buyer (signed in):
 *   GET  /api/buyer/post-purchase/:orderId          the offer for this order, if eligible
 *   POST /api/buyer/post-purchase/:orderId/accept   { variantId, clientIdempotencyKey }
 *        → charges the original card; poll GET /api/buyer/checkout/payment-intent/:id
 *          for the new order (the webhook makes it).
 *
 * Public:
 *   GET  /api/checkout-profile?sellerIds=a,b   { profiles: { [sellerId]: { language, checkoutMode } } }
 *        (the store language and checkout mode the buyer checkout follows).
 */
import { Router, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe } from "../lib/stripe";
import { logger } from "../lib/logger";
import { CartCheckoutError, findCardDataInRequest } from "../lib/money/cartCheckout";
import { StockReservationError } from "../lib/money/stockReservation";
import { loadSellerCheckoutSettings } from "../lib/sellerCheckoutSettings";
import {
  PostPurchaseError, acceptOffer, getOfferSettings, loadOfferProduct, offerForOrder, offerPriceCents,
  saveOfferSettings, validateOfferPatch,
} from "../lib/postPurchaseOffer";
import {
  TrackingStorageUnavailable, getConversionTracking, saveConversionTracking, validateConversionTrackingPatch,
} from "../lib/conversionTracking";

function userId(req: unknown): string {
  return (req as { clerkUserId: string }).clerkUserId;
}

function sendKnownError(res: Response, error: unknown): boolean {
  if (error instanceof PostPurchaseError || error instanceof CartCheckoutError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return true;
  }
  if (error instanceof StockReservationError) {
    res.status(409).json({ error: "This item just sold out.", code: "OUT_OF_STOCK" });
    return true;
  }
  return false;
}

// ─── Seller ──────────────────────────────────────────────────────────────────

/** Mounted at /api/seller/post-purchase-offer. */
export const sellerPostPurchaseOfferRouter = Router();
sellerPostPurchaseOfferRouter.use(requireAuth);
/** Mounted at /api/seller/conversion-tracking. */
export const sellerConversionTrackingRouter = Router();
sellerConversionTrackingRouter.use(requireAuth);

async function offerResponse(sellerId: string) {
  const offer = await getOfferSettings(sellerId);
  const product = offer.productId ? await loadOfferProduct(sellerId, offer.productId) : null;
  return {
    offer,
    product: product ? {
      id: product.id,
      name: product.name,
      image: product.image,
      inStock: product.variants.some((v) => v.stock > 0),
      priceCents: product.variants.length ? Math.min(...product.variants.map((v) => v.priceCents)) : 0,
      offerPriceCents: product.variants.length
        ? Math.min(...product.variants.map((v) => offerPriceCents(v.priceCents, offer.discountPercent)))
        : 0,
    } : null,
  };
}

sellerPostPurchaseOfferRouter.get("/", async (req, res) => {
  res.json(await offerResponse(userId(req)));
});

sellerPostPurchaseOfferRouter.put("/", async (req, res) => {
  const parsed = validateOfferPatch(req.body);
  if (!parsed.ok) return void res.status(400).json({ error: parsed.error, code: "VALIDATION_ERROR" });
  try {
    await saveOfferSettings(userId(req), parsed.value);
  } catch (error) {
    if (sendKnownError(res, error)) return;
    throw error;
  }
  res.json(await offerResponse(userId(req)));
});

sellerConversionTrackingRouter.get("/", async (req, res) => {
  res.json({ tracking: await getConversionTracking(userId(req)) });
});

sellerConversionTrackingRouter.put("/", async (req, res) => {
  const parsed = validateConversionTrackingPatch(req.body);
  if (!parsed.ok) return void res.status(400).json({ error: parsed.error, field: parsed.field, code: "VALIDATION_ERROR" });
  try {
    res.json({ tracking: await saveConversionTracking(userId(req), parsed.patch) });
  } catch (error) {
    if (error instanceof TrackingStorageUnavailable) {
      logger.error("Conversion tracking secrets can't be saved: META_TOKEN_ENCRYPTION_KEY is not set");
      return void res.status(503).json({ error: "Tracking keys can't be saved right now. Try again later.", code: "SECRET_STORAGE_UNAVAILABLE" });
    }
    throw error;
  }
});

// ─── Buyer ───────────────────────────────────────────────────────────────────

export const buyerPostPurchaseRouter = Router();
buyerPostPurchaseRouter.use((req, res, next) => {
  // Same PCI guard as the one-page checkout: no card data, ever.
  if (findCardDataInRequest(req.body)) {
    return void res.status(400).json({ error: "Card details are never sent to Brandthread.", code: "CARD_DATA_REJECTED" });
  }
  next();
});
buyerPostPurchaseRouter.use(requireAuth);

function stripeOr503(res: Response) {
  try {
    return requireStripe();
  } catch {
    res.status(503).json({ error: "Payments are unavailable right now.", code: "STRIPE_NOT_CONFIGURED" });
    return null;
  }
}

buyerPostPurchaseRouter.get("/:orderId", async (req, res) => {
  const stripe = stripeOr503(res);
  if (!stripe) return;
  try {
    res.json(await offerForOrder(stripe, userId(req), String(req.params.orderId)));
  } catch (error) {
    logger.warn({ err: error }, "Post-purchase offer lookup failed");
    res.json({ available: false, reason: "UNAVAILABLE" });
  }
});

buyerPostPurchaseRouter.post("/:orderId/accept", async (req, res) => {
  const stripe = stripeOr503(res);
  if (!stripe) return;
  const body = (req.body ?? {}) as { variantId?: unknown; clientIdempotencyKey?: unknown };
  const variantId = typeof body.variantId === "string" ? body.variantId : "";
  const key = typeof body.clientIdempotencyKey === "string" ? body.clientIdempotencyKey.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(variantId)) return void res.status(400).json({ error: "Choose an option", code: "VALIDATION_ERROR" });
  if (key.length < 8 || key.length > 120) return void res.status(400).json({ error: "clientIdempotencyKey is required", code: "VALIDATION_ERROR" });
  try {
    res.json(await acceptOffer(stripe, { buyerId: userId(req), orderId: String(req.params.orderId), variantId, clientIdempotencyKey: key }));
  } catch (error) {
    if (sendKnownError(res, error)) return;
    throw error;
  }
});

// ─── Public ──────────────────────────────────────────────────────────────────

export const checkoutProfileRouter = Router();

checkoutProfileRouter.get("/", async (req, res) => {
  const ids = String(req.query.sellerIds ?? "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 10);
  if (ids.some((id) => id.length > 128)) return void res.status(400).json({ error: "Invalid seller id" });
  const settings = await loadSellerCheckoutSettings(ids);
  const profiles: Record<string, { language: string; checkoutMode: string }> = {};
  for (const [id, value] of settings) profiles[id] = { language: value.storeLanguage, checkoutMode: value.checkoutMode };
  res.json({ profiles });
});
