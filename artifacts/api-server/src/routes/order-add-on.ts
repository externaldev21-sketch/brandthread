/**
 * "Add to this order": one-tap post-purchase add-on (lib/orderAddOn).
 * Mounted at /api/buyer/add-on.
 *
 * GET  /:orderId   the open offer: when it closes, the card on file, and up
 *                  to 8 in-stock pieces from the same seller.
 * POST /:orderId   { productId, variantId, clientKey } — prices the piece on
 *                  the server (no shipping: it ships with the order), records
 *                  it as a one-page-checkout group, reserves stock, and
 *                  charges the order's saved card off-session. The existing
 *                  payment_intent.succeeded webhook turns it into an order,
 *                  exactly like a bag checkout.
 *
 * The intent is created unconfirmed and linked to its checkout row before it
 * is confirmed, so the webhook can never arrive before the row it needs.
 */
import { Router, type Response } from "express";
import { and, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db, checkoutSessions, orderItems, orders, productVariants, products, stockReservations } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe } from "../lib/stripe";
import { logger } from "../lib/logger";
import { z } from "@workspace/api-zod";
import { requestPrimitives, validateRequest } from "../middlewares/validateRequest";
import {
  CART_CHECKOUT_KIND, CartCheckoutError, MIN_CARD_CHARGE_CENTS, calculateGroupTax, priceCartGroup,
  type CartShipping, type PricedGroup,
} from "../lib/money/cartCheckout";
import { destinationApplicationFeeCents } from "../lib/money/fees";
import { StockReservationError, releaseStockReservation, reserveStock } from "../lib/money/stockReservation";
import { effectiveUnitPrice } from "../lib/pricing/salesRuntime";
import { addOnExpiresAt, addOnIneligibleReason, reusableCard } from "../lib/orderAddOn/eligibility";

const router = Router();
router.use(requireAuth);

const MAX_OFFERS = 8;

const addSchema = z.object({
  productId: requestPrimitives.uuid,
  variantId: requestPrimitives.uuid,
  clientKey: z.string().trim().min(8).max(120),
});

type Stripe = ReturnType<typeof requireStripe>;

async function loadOrder(orderId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return order ?? null;
}

/** The order if its add-on offer is open for this buyer, plus the card to charge. */
async function openOffer(stripe: Stripe, orderId: string, buyerId: string, res: Response) {
  const order = await loadOrder(orderId);
  if (!order) {
    res.status(404).json({ error: "Order not found", code: "NOT_FOUND" });
    return null;
  }
  const reason = addOnIneligibleReason(order, buyerId);
  if (reason === "NOT_YOUR_ORDER") {
    res.status(404).json({ error: "Order not found", code: "NOT_FOUND" });
    return null;
  }
  if (reason) {
    res.status(409).json({ error: "This order can't take add-ons anymore.", code: `ADD_ON_${reason}` });
    return null;
  }
  const intent = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId!, { expand: ["payment_method"] });
  const card = reusableCard(intent as any);
  if (!card) {
    res.status(409).json({ error: "This order can't take add-ons anymore.", code: "ADD_ON_NO_SAVED_CARD" });
    return null;
  }
  return { order, card };
}

function stripeOr503(res: Response): Stripe | null {
  try {
    return requireStripe();
  } catch {
    res.status(503).json({ error: "Payments are unavailable right now.", code: "STRIPE_NOT_CONFIGURED" });
    return null;
  }
}

router.get("/:orderId", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const stripe = stripeOr503(res);
  if (!stripe) return;
  const offer = await openOffer(stripe, String(req.params.orderId), buyerId, res);
  if (!offer) return;
  const { order, card } = offer;

  const inOrder = (await db.select({ productId: productVariants.productId }).from(orderItems)
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .where(eq(orderItems.orderId, order.id))).map((row) => row.productId);

  const rows = await db.select({
    productId: products.id,
    name: products.name,
    images: products.images,
    variantId: productVariants.id,
    size: productVariants.size,
    color: productVariants.color,
    priceCents: productVariants.priceCents,
    compareAtPriceCents: productVariants.compareAtPriceCents,
  }).from(products)
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .where(and(
      eq(products.ownerId, order.ownerId),
      eq(products.status, "active"),
      isNull(products.deletedAt),
      isNull(products.dropId),
      eq(products.isPreOrder, false),
      gt(productVariants.stock, 0),
      ...(inOrder.length ? [notInArray(products.id, inOrder)] : []),
    ))
    .orderBy(sql`${products.createdAt} desc`, productVariants.priceCents)
    .limit(200);

  const byProduct = new Map<string, { productId: string; name: string; imageUrl: string | null; variants: Array<{ variantId: string; label: string; priceCents: number }> }>();
  for (const row of rows) {
    let entry = byProduct.get(row.productId);
    if (!entry) {
      if (byProduct.size >= MAX_OFFERS) continue;
      entry = { productId: row.productId, name: row.name, imageUrl: row.images?.find(Boolean) ?? null, variants: [] };
      byProduct.set(row.productId, entry);
    }
    const unit = await effectiveUnitPrice({
      productId: row.productId, sellerId: order.ownerId, priceCents: row.priceCents, compareAtPriceCents: row.compareAtPriceCents,
    });
    entry.variants.push({
      variantId: row.variantId,
      label: [row.size, row.color].filter(Boolean).join(" / "),
      priceCents: unit.priceCents,
    });
  }

  res.json({
    orderId: order.id,
    sellerId: order.ownerId,
    expiresAt: addOnExpiresAt(order.paidAt!).toISOString(),
    card: { brand: card.brand, last4: card.last4 },
    products: [...byProduct.values()],
  });
});

/** The piece priced like a bag checkout, minus shipping (it rides with the order). */
function withoutShipping(group: PricedGroup): PricedGroup {
  const discountCents = Math.max(0, group.discountCents - group.shippingDiscountCents);
  const fee = destinationApplicationFeeCents({
    shippingCents: 0,
    merchandiseCents: Math.max(0, group.subtotalCents - discountCents),
    preTaxTotalCents: Math.max(0, group.subtotalCents - discountCents),
    platformFeeBps: group.platformFeeBps,
  });
  return {
    ...group,
    shippingCents: 0,
    shippingDiscountCents: 0,
    discountCents,
    platformFeeCents: fee.platformFeeCents,
    processingFeeEstimateCents: fee.processingFeeEstimateCents,
  };
}

router.post("/:orderId", validateRequest({ body: addSchema }), async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const body = req.body as z.infer<typeof addSchema>;
  const stripe = stripeOr503(res);
  if (!stripe) return;
  const offer = await openOffer(stripe, String(req.params.orderId), buyerId, res);
  if (!offer) return;
  const { order, card } = offer;
  const idempotencyKey = `addon_${order.id}_${body.clientKey}`.slice(0, 200);

  // A retried tap returns the first attempt's result.
  const [prior] = await db.select().from(checkoutSessions)
    .where(and(eq(checkoutSessions.buyerId, buyerId), eq(checkoutSessions.clientIdempotencyKey, idempotencyKey)))
    .limit(1);
  if (prior?.stripePaymentIntentId) {
    const intent = await stripe.paymentIntents.retrieve(prior.stripePaymentIntentId);
    res.json({ status: intent.status, amountCents: prior.amountTotalCents, paymentIntentId: intent.id });
    return;
  }
  if (prior) {
    res.status(409).json({ error: "Your add-on is still being set up. Try again in a moment.", code: "PAYMENT_PENDING" });
    return;
  }

  const address = order.shippingAddress;
  if (!address) {
    res.status(409).json({ error: "This order can't take add-ons anymore.", code: "ADD_ON_NO_ADDRESS" });
    return;
  }
  const shipping: CartShipping = {
    name: address.name ?? "",
    street: address.street,
    line2: address.line2 ?? null,
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: address.country,
    phone: "",
  };

  let priced: PricedGroup;
  let tax: { taxCents: number; calculationId: string | null };
  try {
    priced = withoutShipping(await priceCartGroup({
      buyerId, items: [{ productId: body.productId, variantId: body.variantId, quantity: 1 }], shipping,
    }));
    if (priced.sellerId !== order.ownerId) {
      res.status(400).json({ error: "Add-ons must come from the same seller.", code: "ADD_ON_OTHER_SELLER" });
      return;
    }
    tax = await calculateGroupTax(stripe, priced, shipping);
  } catch (error) {
    if (error instanceof CartCheckoutError) {
      res.status(error.status).json({ error: error.message, code: error.code, ...error.details });
      return;
    }
    throw error;
  }
  const amountCents = priced.subtotalCents - priced.discountCents + tax.taxCents;
  if (amountCents < MIN_CARD_CHARGE_CENTS) {
    res.status(400).json({ error: "The add-on total must be at least $0.50.", code: "BELOW_MINIMUM" });
    return;
  }

  let row: typeof checkoutSessions.$inferSelect;
  try {
    row = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(checkoutSessions).values({
        buyerId,
        sellerId: priced.sellerId,
        items: priced.items.map(({ variantId, productName, variantLabel, quantity, priceCents }) => ({
          variantId, productName, variantLabel, quantity, priceCents,
        })),
        shippingAddress: {
          name: shipping.name, street: shipping.street, line2: shipping.line2,
          city: shipping.city, state: shipping.state, zip: shipping.zip, country: shipping.country,
        },
        clientIdempotencyKey: idempotencyKey,
        chargeModel: "transfer",
        platformFeeCents: priced.platformFeeCents,
        platformFeeBps: priced.platformFeeBps,
        processingFeeEstimateCents: priced.processingFeeEstimateCents,
        amountTotalCents: amountCents,
        shippingCents: 0,
        taxCents: tax.taxCents,
        stripeTaxCalculationId: tax.calculationId,
      }).returning();
      await reserveStock(tx, inserted.id, priced.items.map((item) => ({
        variantId: item.variantId, quantity: item.quantity, productName: item.productName,
      })));
      return inserted;
    });
  } catch (error: any) {
    if (error instanceof StockReservationError) {
      res.status(409).json({ error: error.message, code: "OUT_OF_STOCK", variantId: error.variantId });
      return;
    }
    if (error?.code === "23505" || error?.cause?.code === "23505") {
      res.status(409).json({ error: "Your add-on is still being set up. Try again in a moment.", code: "PAYMENT_PENDING" });
      return;
    }
    throw error;
  }

  const release = async () => {
    await db.transaction(async (tx) => {
      await releaseStockReservation(tx, row.id);
      await tx.delete(checkoutSessions).where(eq(checkoutSessions.id, row.id));
    });
  };

  let intent;
  try {
    intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: card.customerId,
      payment_method: card.paymentMethodId,
      payment_method_types: ["card"],
      shipping: {
        name: shipping.name,
        address: {
          line1: shipping.street,
          ...(shipping.line2 ? { line2: shipping.line2 } : {}),
          city: shipping.city,
          state: shipping.state,
          postal_code: shipping.zip,
          country: shipping.country,
        },
      },
      transfer_group: `cart_${row.id}`,
      description: `Brandthread add-on to ${order.orderNumber}`,
      metadata: { kind: CART_CHECKOUT_KIND, buyerId, addOnToOrderId: order.id },
    }, { idempotencyKey: `addon-pi/${idempotencyKey}` });
  } catch (error) {
    await release().catch((err) => logger.error({ err }, "Could not undo an add-on whose PaymentIntent failed"));
    logger.error({ err: error, orderId: order.id }, "Add-on PaymentIntent creation failed");
    res.status(502).json({ error: "We couldn't add this. You haven't been charged.", code: "PAYMENT_START_FAILED" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.update(checkoutSessions).set({
      stripePaymentIntentId: intent.id,
      stripeSessionId: `${intent.id}:${row.id}`,
    }).where(eq(checkoutSessions.id, row.id));
    await tx.update(stockReservations).set({ stripePaymentIntentId: intent.id })
      .where(inArray(stockReservations.checkoutSessionId, [row.id]));
  });

  try {
    const confirmed = await stripe.paymentIntents.confirm(intent.id, {
      payment_method: card.paymentMethodId,
      off_session: true,
    }, { idempotencyKey: `addon-confirm/${idempotencyKey}` });
    res.json({ status: confirmed.status, amountCents, paymentIntentId: confirmed.id });
  } catch (error: any) {
    // Declined, or the bank wants the buyer present (3-D Secure): nothing is
    // charged. Cancel so the stock goes back now, not at the expiry sweep.
    await stripe.paymentIntents.cancel(intent.id, { cancellation_reason: "abandoned" }).catch(() => {});
    await db.transaction((tx) => releaseStockReservation(tx, row.id)).catch(() => {});
    const needsAuth = error?.code === "authentication_required";
    res.status(402).json({
      error: needsAuth
        ? "Your bank wants to confirm this one. Add it to your bag to check out."
        : "Your card was declined. You haven't been charged.",
      code: needsAuth ? "ADD_ON_NEEDS_CHECKOUT" : "ADD_ON_CARD_DECLINED",
    });
  }
});

export default router;
