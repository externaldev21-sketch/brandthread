/**
 * Pop-up mode — in-person sales with Tap to Pay on iPhone (Stripe Terminal).
 * Mounted at /api/seller/terminal behind teamContext; every route needs the
 * store's "orders" permission (owner, admin, manager, orders, staff).
 *
 * GET  /status                     is Pop-up mode on, and is the seller ready
 * GET  /catalog                    the seller's in-stock products, server-priced
 * POST /location                   create/reuse the seller's Terminal Location
 * POST /connection-token           Terminal SDK connection token for that location
 * POST /payment-intents            price + reserve + card_present PaymentIntent
 * GET  /payment-intents/:id        status and the order the webhook made
 * POST /payment-intents/:id/cancel back out of a sale; stock goes back
 *
 * Off unless STRIPE_TERMINAL_ENABLED=1 and STRIPE_SECRET_KEY are set: every
 * route except /status answers 503 TERMINAL_NOT_CONFIGURED.
 *
 * Orders are made only by the Stripe webhook (lib/popup/popupSale.ts).
 */
import { Router, type Request, type Response } from "express";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import {
  db, checkoutSessions, orders, products, productVariants, sellerLocations, sellerTerminalLocations, stockReservations, users,
} from "@workspace/db";
import { z } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission, teamContext } from "../middlewares/requireRole";
import { requestPrimitives, validateRequest } from "../middlewares/validateRequest";
import { requireStripe } from "../lib/stripe";
import { logger } from "../lib/logger";
import { effectiveUnitPrice } from "../lib/pricing/salesRuntime";
import { rejectCardData } from "./checkout-intent";
import { StockReservationError, releaseStockReservation, reserveStock } from "../lib/money/stockReservation";
import {
  POPUP_SALE_KIND, POPUP_SOURCE, PopupSaleError, assertSellerCanTakePayments, pricePopupCart, terminalEnabled,
} from "../lib/popup/popupSale";

const router = Router();
router.use(rejectCardData);
router.use(requireAuth);
router.use(teamContext());
router.use(requirePermission("orders"));

const NOT_CONFIGURED = {
  error: "Pop-up mode isn't available yet.",
  code: "TERMINAL_NOT_CONFIGURED",
};

function sellerOf(req: Request): string {
  return (req as any).clerkUserId as string;
}

/** Gate for everything but /status. */
function stripeOr503(res: Response): ReturnType<typeof requireStripe> | null {
  if (!terminalEnabled()) {
    res.status(503).json(NOT_CONFIGURED);
    return null;
  }
  try {
    return requireStripe();
  } catch {
    res.status(503).json(NOT_CONFIGURED);
    return null;
  }
}

function sendError(res: Response, error: unknown): boolean {
  if (error instanceof PopupSaleError) {
    res.status(error.status).json({ error: error.message, code: error.code, ...error.details });
    return true;
  }
  if (error instanceof StockReservationError) {
    res.status(409).json({ error: error.message, code: "OUT_OF_STOCK", variantId: error.variantId });
    return true;
  }
  return false;
}

async function primaryLocation(sellerId: string, locationId?: string | null) {
  const where = locationId
    ? and(eq(sellerLocations.ownerId, sellerId), eq(sellerLocations.id, locationId))
    : and(eq(sellerLocations.ownerId, sellerId), eq(sellerLocations.isActive, true));
  const [row] = await db.select().from(sellerLocations).where(where)
    .orderBy(desc(sellerLocations.isPrimary), asc(sellerLocations.createdAt)).limit(1);
  return row ?? null;
}

async function terminalLocationOf(sellerId: string) {
  const [row] = await db.select().from(sellerTerminalLocations)
    .where(eq(sellerTerminalLocations.sellerId, sellerId)).limit(1);
  return row ?? null;
}

router.get("/status", async (req, res) => {
  const sellerId = sellerOf(req);
  if (!terminalEnabled()) {
    res.json({ enabled: false, paymentsReady: false, location: null, hasSellerLocation: false });
    return;
  }
  const [seller] = await db.select({ stripeAccountId: users.stripeAccountId, status: users.stripeAccountStatus })
    .from(users).where(eq(users.clerkId, sellerId)).limit(1);
  const terminal = await terminalLocationOf(sellerId);
  const saved = await primaryLocation(sellerId);
  res.json({
    enabled: true,
    paymentsReady: Boolean(seller?.stripeAccountId) && seller?.status === "active",
    location: terminal ? { id: terminal.stripeLocationId, displayName: terminal.displayName } : null,
    hasSellerLocation: Boolean(saved),
  });
});

router.get("/catalog", async (req, res) => {
  if (!stripeOr503(res)) return;
  const sellerId = sellerOf(req);
  const rows = await db.select({
    productId: products.id,
    name: products.name,
    images: products.images,
    variantId: productVariants.id,
    size: productVariants.size,
    color: productVariants.color,
    priceCents: productVariants.priceCents,
    compareAtPriceCents: productVariants.compareAtPriceCents,
    stock: productVariants.stock,
  }).from(products)
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .where(and(
      eq(products.ownerId, sellerId),
      eq(products.status, "active"),
      isNull(products.deletedAt),
      isNull(products.dropId),
      gt(productVariants.stock, 0),
    ))
    .orderBy(desc(products.createdAt), asc(productVariants.priceCents))
    .limit(500);

  const byProduct = new Map<string, {
    productId: string; name: string; imageUrl: string | null;
    variants: Array<{ variantId: string; label: string; priceCents: number; stock: number }>;
  }>();
  for (const row of rows) {
    const unit = await effectiveUnitPrice({
      productId: row.productId, sellerId, priceCents: row.priceCents, compareAtPriceCents: row.compareAtPriceCents,
    });
    let product = byProduct.get(row.productId);
    if (!product) {
      const images = Array.isArray(row.images) ? row.images : [];
      product = { productId: row.productId, name: row.name, imageUrl: images[0] ?? null, variants: [] };
      byProduct.set(row.productId, product);
    }
    product.variants.push({
      variantId: row.variantId,
      label: [row.size, row.color].filter(Boolean).join(" / "),
      priceCents: unit.priceCents,
      stock: row.stock,
    });
  }
  res.json({ products: [...byProduct.values()] });
});

const locationSchema = z.object({ sellerLocationId: requestPrimitives.uuid.optional() });

router.post("/location", validateRequest({ body: locationSchema }), async (req, res) => {
  const stripe = stripeOr503(res);
  if (!stripe) return;
  const sellerId = sellerOf(req);
  const body = req.body as z.infer<typeof locationSchema>;
  const saved = await primaryLocation(sellerId, body.sellerLocationId ?? null);
  if (!saved) {
    res.status(409).json({ error: "Add your pop-up address in Locations first.", code: "LOCATION_REQUIRED" });
    return;
  }
  const existing = await terminalLocationOf(sellerId);
  if (existing && existing.sellerLocationId === saved.id) {
    res.json({ location: { id: existing.stripeLocationId, displayName: existing.displayName } });
    return;
  }
  if (!saved.address?.trim() || !saved.city?.trim() || !saved.zip?.trim() || !saved.country?.trim()) {
    res.status(409).json({ error: "This location needs a street, city and ZIP code.", code: "LOCATION_INCOMPLETE" });
    return;
  }
  const displayName = saved.name.trim().slice(0, 100) || "Pop-up";
  let location;
  try {
    location = await stripe.terminal.locations.create({
      display_name: displayName,
      address: {
        line1: saved.address.trim(),
        city: saved.city.trim(),
        ...(saved.state?.trim() ? { state: saved.state.trim() } : {}),
        postal_code: saved.zip.trim(),
        country: saved.country.trim().toUpperCase(),
      },
      metadata: { sellerId, sellerLocationId: saved.id },
    }, { idempotencyKey: `terminal-location/${sellerId}/${saved.id}` });
  } catch (error) {
    logger.error({ err: error, sellerId }, "Stripe Terminal location create failed");
    res.status(502).json({ error: "Couldn't set up this location. Try again.", code: "LOCATION_CREATE_FAILED" });
    return;
  }
  await db.insert(sellerTerminalLocations).values({
    sellerId, sellerLocationId: saved.id, stripeLocationId: location.id, displayName,
  }).onConflictDoUpdate({
    target: sellerTerminalLocations.sellerId,
    set: { sellerLocationId: saved.id, stripeLocationId: location.id, displayName, updatedAt: new Date() },
  });
  res.json({ location: { id: location.id, displayName } });
});

router.post("/connection-token", async (req, res) => {
  const stripe = stripeOr503(res);
  if (!stripe) return;
  const sellerId = sellerOf(req);
  const terminal = await terminalLocationOf(sellerId);
  if (!terminal) {
    res.status(409).json({ error: "Set up your pop-up location first.", code: "TERMINAL_LOCATION_REQUIRED" });
    return;
  }
  const token = await stripe.terminal.connectionTokens.create({ location: terminal.stripeLocationId });
  res.json({ secret: token.secret, locationId: terminal.stripeLocationId });
});

const createSchema = z.object({
  items: z.array(z.object({
    productId: requestPrimitives.uuid,
    variantId: requestPrimitives.uuid,
    quantity: z.coerce.number().int().min(1).max(100),
  })).min(1).max(50),
  clientIdempotencyKey: z.string().trim().min(8).max(120),
});

router.post("/payment-intents", validateRequest({ body: createSchema }), async (req, res) => {
  const stripe = stripeOr503(res);
  if (!stripe) return;
  const sellerId = sellerOf(req);
  const body = req.body as z.infer<typeof createSchema>;
  const key = body.clientIdempotencyKey;
  const rowKey = `popup_${sellerId}_${key}`;

  // Retried tap on Charge: hand back the same intent.
  const [prior] = await db.select().from(checkoutSessions)
    .where(and(eq(checkoutSessions.clientIdempotencyKey, rowKey), eq(checkoutSessions.sellerId, sellerId))).limit(1);
  if (prior) {
    if (!prior.stripePaymentIntentId) {
      res.status(409).json({ error: "This payment is still being set up. Try again in a moment.", code: "PAYMENT_PENDING" });
      return;
    }
    const intent = await stripe.paymentIntents.retrieve(prior.stripePaymentIntentId);
    if (intent.status === "canceled") {
      res.status(410).json({ error: "This payment was cancelled. Start a new sale.", code: "PAYMENT_CANCELED" });
      return;
    }
    res.json({
      paymentIntentId: intent.id, clientSecret: intent.client_secret, status: intent.status,
      amountCents: prior.amountTotalCents, lines: prior.items,
    });
    return;
  }

  let priced;
  try {
    await assertSellerCanTakePayments(sellerId);
    priced = await pricePopupCart({ sellerId, items: body.items });
  } catch (error) {
    if (sendError(res, error)) return;
    throw error;
  }

  let row: typeof checkoutSessions.$inferSelect;
  try {
    row = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(checkoutSessions).values({
        buyerId: null,
        sellerId,
        source: POPUP_SOURCE,
        items: priced.lines.map(({ variantId, productName, variantLabel, quantity, priceCents }) => ({
          variantId, productName, variantLabel, quantity, priceCents,
        })),
        clientIdempotencyKey: rowKey,
        chargeModel: "transfer",
        platformFeeCents: priced.platformFeeCents,
        platformFeeBps: priced.platformFeeBps,
        processingFeeEstimateCents: priced.processingFeeEstimateCents,
        amountTotalCents: priced.totalCents,
        shippingCents: 0,
        taxCents: 0,
      }).returning();
      await reserveStock(tx, inserted.id, priced.lines.map((line) => ({
        variantId: line.variantId, quantity: line.quantity, productName: line.productName,
      })));
      return inserted;
    });
  } catch (error: any) {
    if (sendError(res, error)) return;
    if (error?.code === "23505" || error?.cause?.code === "23505") {
      res.status(409).json({ error: "This payment is already being set up. Try again in a moment.", code: "PAYMENT_PENDING" });
      return;
    }
    throw error;
  }

  let intent;
  try {
    intent = await stripe.paymentIntents.create({
      amount: priced.totalCents,
      currency: "usd",
      payment_method_types: ["card_present"],
      capture_method: "automatic",
      transfer_group: `popup_${row.id}`,
      description: `Brandthread pop-up sale (${priced.lines.reduce((n, l) => n + l.quantity, 0)} items)`,
      metadata: {
        kind: POPUP_SALE_KIND,
        source: POPUP_SOURCE,
        sellerId,
        checkoutSessionId: row.id,
      },
    }, { idempotencyKey: `popup-pi/${sellerId}/${key}` });
  } catch (error) {
    await db.transaction(async (tx) => {
      await releaseStockReservation(tx, row.id);
      await tx.delete(checkoutSessions).where(eq(checkoutSessions.id, row.id));
    }).catch((err) => logger.error({ err }, "Could not undo a pop-up sale whose PaymentIntent failed"));
    logger.error({ err: error, sellerId }, "Pop-up PaymentIntent creation failed");
    res.status(502).json({ error: "Couldn't start the payment. No one was charged. Try again.", code: "PAYMENT_START_FAILED" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.update(checkoutSessions).set({
      stripePaymentIntentId: intent.id,
      stripeSessionId: `${intent.id}:${row.id}`,
    }).where(eq(checkoutSessions.id, row.id));
    // Linked so the expiry sweep cancels the intent before releasing stock.
    await tx.update(stockReservations).set({ stripePaymentIntentId: intent.id })
      .where(inArray(stockReservations.checkoutSessionId, [row.id]));
  });

  res.json({
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    status: intent.status,
    amountCents: priced.totalCents,
    lines: priced.lines,
  });
});

async function ownedSale(sellerId: string, intentId: string) {
  const [row] = await db.select().from(checkoutSessions).where(and(
    eq(checkoutSessions.sellerId, sellerId),
    eq(checkoutSessions.stripePaymentIntentId, intentId),
    eq(checkoutSessions.source, POPUP_SOURCE),
  )).limit(1);
  return row ?? null;
}

router.get("/payment-intents/:id", async (req, res) => {
  const stripe = stripeOr503(res);
  if (!stripe) return;
  const sale = await ownedSale(sellerOf(req), String(req.params.id));
  if (!sale) {
    res.status(404).json({ error: "Payment not found", code: "NOT_FOUND" });
    return;
  }
  const intent = await stripe.paymentIntents.retrieve(sale.stripePaymentIntentId!);
  const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, totalCents: orders.totalCents, status: orders.status })
    .from(orders).where(eq(orders.stripeCheckoutSessionId, sale.stripeSessionId ?? "")).limit(1);
  res.json({
    status: intent.status,
    amountCents: sale.amountTotalCents,
    order: order ? { orderId: order.id, orderNumber: order.orderNumber, totalCents: order.totalCents, status: order.status } : null,
  });
});

router.post("/payment-intents/:id/cancel", async (req, res) => {
  const stripe = stripeOr503(res);
  if (!stripe) return;
  const sale = await ownedSale(sellerOf(req), String(req.params.id));
  if (!sale) {
    res.status(404).json({ error: "Payment not found", code: "NOT_FOUND" });
    return;
  }
  const intent = await stripe.paymentIntents.retrieve(sale.stripePaymentIntentId!);
  if (intent.status === "succeeded" || intent.status === "processing") {
    res.status(409).json({ error: "This payment already went through.", code: "PAYMENT_ALREADY_SUCCEEDED" });
    return;
  }
  if (intent.status !== "canceled") {
    await stripe.paymentIntents.cancel(intent.id, { cancellation_reason: "requested_by_customer" });
  }
  await db.transaction((tx) => releaseStockReservation(tx, sale.id));
  res.json({ ok: true });
});

export default router;
