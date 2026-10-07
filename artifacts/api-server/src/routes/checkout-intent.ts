/**
 * One-page checkout: ONE PaymentIntent for the whole cart, confirmed in the
 * app with Stripe's own card fields, Apple Pay or Google Pay. 3DS is handled
 * by the Stripe SDK.
 * Mounted at /api/buyer/checkout/payment-intent.
 *
 * POST /quote      prices the cart for an address (shipping, promo, Stripe
 *                  Tax) without reserving anything, so the page and the
 *                  Apple Pay / Google Pay sheet show the real total.
 * POST /           prices every seller group (lib/money/cartCheckout.ts),
 *                  reserves stock atomically, persists one checkout row per
 *                  seller, creates the PaymentIntent. Returns its client
 *                  secret and the server's breakdown.
 * GET  /:id        payment status + the orders it produced (for the
 *                  confirmation screen; the orders are made by the webhook).
 * POST /:id/cancel the buyer backed out after Pay: cancels the intent and
 *                  gives the stock back.
 *
 * Money: separate charges and transfers. The charge lands on Brandthread's
 * balance; each seller's order is paid out by its own transfer right after
 * the webhook creates it (lib/money/cartTransfers.ts).
 *
 * Idempotency: the client key identifies one pay attempt. A retry with the
 * same key returns the same PaymentIntent, and Stripe is also called with
 * idempotency keys.
 *
 * PCI SAQ-A: no card data is ever accepted here (rejectCardData below).
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, checkoutSessions, orders, stockReservations } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { ensureStripeCustomer, requireStripe } from "../lib/stripe";
import { logger } from "../lib/logger";
import { z } from "@workspace/api-zod";
import { requestPrimitives, validateRequest } from "../middlewares/validateRequest";
import {
  CART_CHECKOUT_KIND, CartCheckoutError, MAX_CART_GROUPS, MIN_CARD_CHARGE_CENTS,
  calculateGroupTax, findCardDataInRequest, priceCartGroup, type CartShipping, type PricedGroup,
} from "../lib/money/cartCheckout";
import { StockReservationError, releaseStockReservation, reserveStock } from "../lib/money/stockReservation";

import { resolveLiveAttribution } from "../lib/liveAttribution";
const router = Router();

/** Refuses any request that carries card data, before auth, parsing or logging touch it. */
export function rejectCardData(req: Request, res: Response, next: NextFunction): void {
  const hit = findCardDataInRequest(req.body);
  if (hit) {
    // Log only the path, never the value.
    logger.warn({ path: req.path, field: hit }, "Rejected a checkout request carrying card data");
    res.status(400).json({
      error: "Card details must be entered in the secure payment field, not sent to Brandthread.",
      code: "CARD_DATA_REJECTED",
    });
    return;
  }
  next();
}

router.use(rejectCardData);
router.use(requireAuth);

const itemSchema = z.object({
  variantId: requestPrimitives.uuid,
  productId: requestPrimitives.uuid,
  quantity: z.coerce.number().int().min(1).max(100),
});
const addressSchema = z.object({
  recipientName: requestPrimitives.shortText,
  street: requestPrimitives.shortText,
  line2: z.string().trim().max(160).nullable().optional(),
  city: requestPrimitives.shortText,
  state: requestPrimitives.shortText,
  postalCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 -]{1,15}$/),
  country: z.string().trim().length(2).default("US"),
});
const groupsSchema = z.array(z.object({
  items: z.array(itemSchema).min(1).max(100),
  discountCode: z.string().trim().min(1).max(64).optional(),
  /** Live stream this seller's items were bought from (lib/liveAttribution.ts validates it; a bad id is ignored). */
  liveStreamId: z.string().trim().max(64).nullable().optional(),
})).min(1).max(MAX_CART_GROUPS);
/** A quote only needs where the order goes (a wallet sheet shares no street until the buyer pays). */
const quoteSchema = z.object({
  groups: groupsSchema,
  shippingAddress: z.object({
    street: z.string().trim().max(160).optional(),
    line2: z.string().trim().max(160).nullable().optional(),
    city: z.string().trim().max(160).optional(),
    state: z.string().trim().max(160).optional(),
    postalCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 -]{1,15}$/),
    country: z.string().trim().length(2).default("US"),
  }),
});
const createSchema = z.object({
  groups: groupsSchema,
  contactEmail: requestPrimitives.email,
  contactPhone: z.string().trim().regex(/^[0-9+(). -]{7,32}$/),
  shippingAddress: addressSchema,
  clientIdempotencyKey: z.string().trim().min(8).max(120),
  /** Keep the card on the buyer's Stripe customer for next time (the hosted flow always did). */
  saveCard: z.boolean().optional(),
});

type GroupBreakdown = {
  sellerId: string;
  checkoutSessionId: string;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  processingDays: number | null;
};

function breakdownFromRows(rows: Array<typeof checkoutSessions.$inferSelect>): GroupBreakdown[] {
  return rows.map((row) => {
    const subtotal = (row.items ?? []).reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
    return {
      sellerId: row.sellerId,
      checkoutSessionId: row.id,
      subtotalCents: subtotal,
      shippingCents: row.shippingCents ?? 0,
      discountCents: row.discountCodeAmountCents ?? 0,
      taxCents: row.taxCents ?? 0,
      totalCents: row.amountTotalCents ?? 0,
      processingDays: null,
    };
  });
}

type PricedCartGroup = PricedGroup & { taxCents: number; calculationId: string | null; totalCents: number };

/** Prices every seller group, then its Stripe Tax. Throws CartCheckoutError. */
async function priceCart(
  stripe: ReturnType<typeof requireStripe>,
  buyerId: string,
  groups: z.infer<typeof groupsSchema>,
  shipping: CartShipping,
): Promise<PricedCartGroup[]> {
  const priced: PricedCartGroup[] = [];
  const sellers = new Set<string>();
  for (const group of groups) {
    const pricedGroup = await priceCartGroup({ buyerId, items: group.items, discountCode: group.discountCode ?? null, shipping });
    if (sellers.has(pricedGroup.sellerId)) {
      throw new CartCheckoutError(400, "DUPLICATE_SELLER_GROUP", "Each seller's items must be in one group.");
    }
    sellers.add(pricedGroup.sellerId);
    const tax = await calculateGroupTax(stripe, pricedGroup, shipping);
    priced.push({
      ...pricedGroup,
      taxCents: tax.taxCents,
      calculationId: tax.calculationId,
      totalCents: pricedGroup.subtotalCents + pricedGroup.shippingCents - pricedGroup.discountCents + tax.taxCents,
    });
  }
  return priced;
}

function breakdown(priced: PricedCartGroup[], rows?: Array<{ id: string }>): GroupBreakdown[] {
  return priced.map((group, index) => ({
    sellerId: group.sellerId,
    checkoutSessionId: rows?.[index]?.id ?? "",
    subtotalCents: group.subtotalCents,
    shippingCents: group.shippingCents,
    discountCents: group.discountCents,
    taxCents: group.taxCents,
    totalCents: group.totalCents,
    processingDays: group.processingDays,
  }));
}

function stripeFor(res: Response): ReturnType<typeof requireStripe> | null {
  try {
    return requireStripe();
  } catch {
    res.status(503).json({ error: "Payments are unavailable right now.", code: "STRIPE_NOT_CONFIGURED" });
    return null;
  }
}

function sendError(res: Response, error: unknown): boolean {
  if (error instanceof CartCheckoutError) {
    res.status(error.status).json({ error: error.message, code: error.code, ...error.details });
    return true;
  }
  if (error instanceof StockReservationError) {
    res.status(409).json({ error: error.message, code: "OUT_OF_STOCK", variantId: error.variantId });
    return true;
  }
  return false;
}

router.post("/quote", validateRequest({ body: quoteSchema }), async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const body = req.body as z.infer<typeof quoteSchema>;
  const stripe = stripeFor(res);
  if (!stripe) return;
  const address = body.shippingAddress;
  const shipping: CartShipping = {
    name: "",
    street: address.street ?? "",
    line2: address.line2 ?? null,
    city: address.city ?? "",
    state: address.state ?? "",
    zip: address.postalCode.toUpperCase(),
    country: address.country.toUpperCase(),
    phone: "",
  };
  try {
    const priced = await priceCart(stripe, buyerId, body.groups, shipping);
    res.json({
      amountCents: priced.reduce((sum, group) => sum + group.totalCents, 0),
      groups: breakdown(priced),
    });
  } catch (error) {
    if (sendError(res, error)) return;
    throw error;
  }
});

router.post("/", validateRequest({ body: createSchema }), async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const body = req.body as z.infer<typeof createSchema>;
  const key = body.clientIdempotencyKey;
  const stripe = stripeFor(res);
  if (!stripe) return;

  // ── Retried pay attempt: hand back the same intent ────────────────────────
  const likeKey = key.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const prior = await db.select().from(checkoutSessions)
    .where(and(eq(checkoutSessions.buyerId, buyerId), like(checkoutSessions.clientIdempotencyKey, `${likeKey}\\_%`)));
  if (prior.length > 0) {
    const intentId = prior[0].stripePaymentIntentId;
    if (!intentId) {
      res.status(409).json({ error: "Your payment is still being set up. Try again in a moment.", code: "PAYMENT_PENDING" });
      return;
    }
    const intent = await stripe.paymentIntents.retrieve(intentId);
    if (intent.status === "canceled") {
      res.status(410).json({ error: "This payment attempt was closed. Tap Pay again to start a new one.", code: "PAYMENT_CANCELED" });
      return;
    }
    res.json({
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      status: intent.status,
      amountCents: intent.amount,
      groups: breakdownFromRows(prior),
    });
    return;
  }

  const shipping: CartShipping = {
    name: body.shippingAddress.recipientName,
    street: body.shippingAddress.street,
    line2: body.shippingAddress.line2 ?? null,
    city: body.shippingAddress.city,
    state: body.shippingAddress.state,
    zip: body.shippingAddress.postalCode.toUpperCase(),
    country: body.shippingAddress.country.toUpperCase(),
    phone: body.contactPhone,
  };

  // ── Price every seller group and its tax ──────────────────────────────────
  let priced: PricedCartGroup[];
  try {
    priced = await priceCart(stripe, buyerId, body.groups, shipping);
  } catch (error) {
    if (sendError(res, error)) return;
    throw error;
  }
  const amountCents = priced.reduce((sum, group) => sum + group.totalCents, 0);
  if (amountCents < MIN_CARD_CHARGE_CENTS) {
    res.status(400).json({ error: "The order total must be at least $0.50.", code: "BELOW_MINIMUM" });
    return;
  }

  // Bought from a live: kept per seller group only when the stream is that
  // seller's (or they co-hosted it) and is live or just ended.
  const liveSources = await Promise.all(priced.map((group, index) =>
    resolveLiveAttribution(body.groups[index]?.liveStreamId, group.sellerId)));
  const liveSourceByGroup = new Map(priced.map((group, index) => [group, liveSources[index]] as const));

  // ── Persist the groups and reserve their stock, all or nothing ───────────
  let rows: Array<typeof checkoutSessions.$inferSelect> = [];
  try {
    rows = await db.transaction(async (tx) => {
      const inserted: Array<typeof checkoutSessions.$inferSelect> = [];
      for (const group of priced) {
        const [row] = await tx.insert(checkoutSessions).values({
          buyerId,
          sellerId: group.sellerId,
          items: group.items.map(({ variantId, productName, variantLabel, quantity, priceCents }) => ({
            variantId, productName, variantLabel, quantity, priceCents,
          })),
          shippingAddress: {
            name: shipping.name, street: shipping.street, line2: shipping.line2,
            city: shipping.city, state: shipping.state, zip: shipping.zip, country: shipping.country,
          },
          clientIdempotencyKey: `${key}_${group.sellerId}`,
          chargeModel: "transfer",
          platformFeeCents: group.platformFeeCents,
          processingFeeEstimateCents: group.processingFeeEstimateCents,
          ...(group.discountCodeId ? { discountCodeId: group.discountCodeId, discountCodeAmountCents: group.discountCents } : {}),
          amountTotalCents: group.totalCents,
          shippingCents: group.shippingCents,
          taxCents: group.taxCents,
          stripeTaxCalculationId: group.calculationId,
          ...(liveSourceByGroup.get(group) ? { sourceLiveStreamId: liveSourceByGroup.get(group) } : {}),
        }).returning();
        await reserveStock(tx, row.id, group.items.map((item) => ({
          variantId: item.variantId, quantity: item.quantity, productName: item.productName,
        })));
        inserted.push(row);
      }
      return inserted;
    });
  } catch (error: any) {
    if (sendError(res, error)) return;
    if (error?.code === "23505" || error?.cause?.code === "23505") {
      res.status(409).json({ error: "Your payment is already being set up. Try again in a moment.", code: "PAYMENT_PENDING" });
      return;
    }
    throw error;
  }

  const releaseAll = async () => {
    await db.transaction(async (tx) => {
      for (const row of rows) {
        await releaseStockReservation(tx, row.id);
        await tx.delete(checkoutSessions).where(eq(checkoutSessions.id, row.id));
      }
    });
  };

  // ── One PaymentIntent for the cart ────────────────────────────────────────
  let intent;
  try {
    const customer = await ensureStripeCustomer(stripe, buyerId, body.contactEmail, shipping, body.contactPhone);
    intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer,
      // Card covers Apple Pay and Google Pay (both are card wallets).
      payment_method_types: ["card"],
      ...(body.saveCard === false ? {} : { setup_future_usage: "off_session" as const }),
      receipt_email: body.contactEmail,
      shipping: {
        name: shipping.name,
        phone: shipping.phone,
        address: {
          line1: shipping.street,
          ...(shipping.line2 ? { line2: shipping.line2 } : {}),
          city: shipping.city,
          state: shipping.state,
          postal_code: shipping.zip,
          country: shipping.country,
        },
      },
      transfer_group: `cart_${rows[0].id}`,
      description: `Brandthread order (${rows.length} ${rows.length === 1 ? "seller" : "sellers"})`,
      metadata: { kind: CART_CHECKOUT_KIND, buyerId, checkoutKey: key.slice(0, 100) },
    }, { idempotencyKey: `cart-pi/${buyerId}/${key}` });
  } catch (error) {
    await releaseAll().catch((err) => logger.error({ err }, "Could not undo a checkout whose PaymentIntent failed"));
    logger.error({ err: error }, "Cart PaymentIntent creation failed");
    res.status(502).json({ error: "We couldn't start your payment. You haven't been charged. Try again.", code: "PAYMENT_START_FAILED" });
    return;
  }

  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.update(checkoutSessions).set({
        stripePaymentIntentId: intent.id,
        stripeSessionId: `${intent.id}:${row.id}`,
      }).where(eq(checkoutSessions.id, row.id));
    }
    // Link the reservations to the intent so the expiry sweep cancels it first.
    await tx.update(stockReservations).set({ stripePaymentIntentId: intent.id })
      .where(inArray(stockReservations.checkoutSessionId, rows.map((row) => row.id)));
  });

  res.json({
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    status: intent.status,
    amountCents,
    groups: breakdown(priced, rows),
  });
});

async function ownedGroups(buyerId: string, intentId: string) {
  return db.select().from(checkoutSessions)
    .where(and(eq(checkoutSessions.buyerId, buyerId), eq(checkoutSessions.stripePaymentIntentId, intentId)));
}

router.get("/:id", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const intentId = String(req.params.id);
  const groups = await ownedGroups(buyerId, intentId);
  if (groups.length === 0) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  const stripe = requireStripe();
  const intent = await stripe.paymentIntents.retrieve(intentId);
  const made = await db.select({
    id: orders.id, orderNumber: orders.orderNumber, ownerId: orders.ownerId, totalCents: orders.totalCents,
    sessionId: orders.stripeCheckoutSessionId,
  }).from(orders).where(inArray(orders.stripeCheckoutSessionId, groups.map((g) => g.stripeSessionId ?? "")));
  const decline = intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code ?? null;
  res.json({
    status: intent.status,
    paymentStatus: intent.status === "succeeded" ? "paid" : intent.status === "processing" ? "processing" : "unpaid",
    amountTotal: intent.amount,
    declineReason: decline,
    orders: made.map((order) => ({
      orderId: order.id, orderNumber: order.orderNumber, sellerId: order.ownerId, amountTotalCents: order.totalCents,
    })),
    // Every group has an order once the webhook ran for all of them.
    complete: made.length === groups.length,
  });
});

router.post("/:id/cancel", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const intentId = String(req.params.id);
  const groups = await ownedGroups(buyerId, intentId);
  if (groups.length === 0) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  const stripe = requireStripe();
  const intent = await stripe.paymentIntents.retrieve(intentId);
  if (intent.status === "succeeded" || intent.status === "processing") {
    res.status(409).json({ error: "This payment already went through.", code: "PAYMENT_ALREADY_SUCCEEDED" });
    return;
  }
  if (intent.status !== "canceled") {
    await stripe.paymentIntents.cancel(intentId, { cancellation_reason: "requested_by_customer" });
  }
  await db.transaction(async (tx) => {
    for (const group of groups) await releaseStockReservation(tx, group.id);
  });
  res.json({ ok: true });
});

export default router;
