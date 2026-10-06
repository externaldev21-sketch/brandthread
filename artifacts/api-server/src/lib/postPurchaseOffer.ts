/**
 * Post-purchase offer — the seller Checkout settings' "Post-purchase
 * features" (mobile app/checkout.tsx), modelled on Shopify's one-click
 * post-purchase upsell: right after a buyer pays, the order confirmation
 * shows one product from the same seller at an optional discount (0–50%),
 * and "Add to order" charges the card used for the original payment without
 * re-entering anything. The result is a real second order, linked to the
 * first by orders.upsell_of_order_id.
 *
 * Everything is decided here, on the server:
 *   • the offer must be on, its product the seller's own, active, not
 *     deleted and in stock; the discount 0–50%;
 *   • the original order must be the caller's, paid, not cancelled, not
 *     itself an accepted offer, younger than OFFER_WINDOW_MS, and not
 *     already followed by an accepted offer;
 *   • the original payment's card must be saved on the buyer's Stripe
 *     customer (the one-page checkout saves it by default). Guest checkouts
 *     and "Guest checkout only" stores save no card, so they get no offer;
 *   • the price is the variant's current price minus the offer discount —
 *     the client only names a variant. The item ships with the original
 *     order (no shipping charge); Stripe Tax is calculated for the original
 *     order's address.
 *
 * Payment reuses the one-page checkout's pipeline: a checkout_sessions row
 * (charge model "transfer", stock reserved), one PaymentIntent with
 * metadata.kind = cart_checkout confirmed with the saved card, and the
 * existing payment_intent.succeeded webhook creates the order and pays the
 * seller (routes/webhooks.ts handleCartPaymentSucceeded). If the bank asks
 * for 3DS the PaymentIntent comes back requires_action and the app finishes
 * it with Stripe's SDK, exactly like a saved-card checkout.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type Stripe from "stripe";
import {
  db, checkoutSessions, orders, productVariants, products, sellerPostPurchaseOffers, stockReservations, users,
} from "@workspace/db";
import {
  CART_CHECKOUT_KIND, CartCheckoutError, MIN_CARD_CHARGE_CENTS, calculateGroupTax, priceCartGroup,
  type CartShipping, type PricedGroup,
} from "./money/cartCheckout";
import { destinationApplicationFeeCents } from "./money/fees";
import { releaseStockReservation, reserveStock } from "./money/stockReservation";
import { loadSellerCheckoutSettings } from "./sellerCheckoutSettings";
import { logger } from "./logger";

export const MAX_OFFER_DISCOUNT_PERCENT = 50;
/** The offer is shown on the confirmation right after paying; it expires after an hour. */
export const OFFER_WINDOW_MS = 60 * 60_000;

export interface PostPurchaseOfferSettings {
  enabled: boolean;
  productId: string | null;
  discountPercent: number;
}

export const DEFAULT_POST_PURCHASE_OFFER: PostPurchaseOfferSettings = { enabled: false, productId: null, discountPercent: 0 };

export class PostPurchaseError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/** Variant price after the offer discount (half-up to the cent, never below 0). */
export function offerPriceCents(priceCents: number, discountPercent: number): number {
  const pct = Math.min(MAX_OFFER_DISCOUNT_PERCENT, Math.max(0, Math.round(discountPercent)));
  const discount = Math.floor((priceCents * pct + 50) / 100);
  return Math.max(0, priceCents - discount);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape check of a PUT body (ownership/stock are checked against the DB in saveOfferSettings). */
export function validateOfferPatch(body: unknown):
  | { ok: true; value: PostPurchaseOfferSettings }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Body must be an object" };
  const v = body as Record<string, unknown>;
  if (typeof v.enabled !== "boolean") return { ok: false, error: "enabled must be true or false" };
  const productId = v.productId == null || v.productId === "" ? null : v.productId;
  if (productId !== null && (typeof productId !== "string" || !UUID_RE.test(productId))) {
    return { ok: false, error: "productId must be a product id" };
  }
  const pct = v.discountPercent ?? 0;
  if (typeof pct !== "number" || !Number.isInteger(pct) || pct < 0 || pct > MAX_OFFER_DISCOUNT_PERCENT) {
    return { ok: false, error: `discountPercent must be a whole number from 0 to ${MAX_OFFER_DISCOUNT_PERCENT}` };
  }
  if (v.enabled && !productId) return { ok: false, error: "Choose a product to offer" };
  return { ok: true, value: { enabled: v.enabled, productId: productId as string | null, discountPercent: pct } };
}

type OfferProduct = {
  id: string;
  name: string;
  image: string | null;
  variants: Array<{ variantId: string; label: string; priceCents: number; stock: number }>;
};

/** The seller's own, active, non-deleted product with its variants (null otherwise). */
export async function loadOfferProduct(sellerId: string, productId: string): Promise<OfferProduct | null> {
  const [product] = await db.select({
    id: products.id, name: products.name, images: products.images, ownerId: products.ownerId, status: products.status,
  }).from(products).where(and(eq(products.id, productId), isNull(products.deletedAt))).limit(1);
  if (!product || product.ownerId !== sellerId || product.status !== "active") return null;
  const variants = await db.select({
    id: productVariants.id, priceCents: productVariants.priceCents, stock: productVariants.stock,
    size: productVariants.size, color: productVariants.color,
  }).from(productVariants).where(eq(productVariants.productId, productId));
  return {
    id: product.id,
    name: product.name,
    image: Array.isArray(product.images) && product.images[0] ? product.images[0] : null,
    variants: variants.map((v) => ({
      variantId: v.id,
      label: [v.size, v.color].filter(Boolean).join(" / "),
      priceCents: v.priceCents,
      stock: v.stock,
    })),
  };
}

export async function getOfferSettings(sellerId: string): Promise<PostPurchaseOfferSettings> {
  const [row] = await db.select().from(sellerPostPurchaseOffers).where(eq(sellerPostPurchaseOffers.sellerId, sellerId)).limit(1);
  if (!row) return { ...DEFAULT_POST_PURCHASE_OFFER };
  return { enabled: row.enabled, productId: row.productId ?? null, discountPercent: row.discountPercent };
}

/** Saves the seller's offer. Turning it on requires their own active, in-stock product. */
export async function saveOfferSettings(sellerId: string, value: PostPurchaseOfferSettings): Promise<PostPurchaseOfferSettings> {
  if (value.productId) {
    const product = await loadOfferProduct(sellerId, value.productId);
    if (!product) throw new PostPurchaseError(400, "INVALID_PRODUCT", "Choose one of your active products.");
    if (value.enabled && !product.variants.some((v) => v.stock > 0)) {
      throw new PostPurchaseError(400, "OUT_OF_STOCK", `${product.name} is out of stock. Choose a product you have in stock.`);
    }
  }
  const set = { enabled: value.enabled, productId: value.productId, discountPercent: value.discountPercent, updatedAt: new Date() };
  await db.insert(sellerPostPurchaseOffers).values({ sellerId, ...set })
    .onConflictDoUpdate({ target: sellerPostPurchaseOffers.sellerId, set });
  return { ...value };
}

// ─── Buyer side ──────────────────────────────────────────────────────────────

export type OfferForOrder =
  | { available: false; reason: string; acceptedOrderId?: string | null }
  | {
      available: true;
      orderId: string;
      sellerId: string;
      sellerName: string;
      product: { id: string; name: string; image: string | null };
      discountPercent: number;
      variants: Array<{ variantId: string; label: string; priceCents: number; offerPriceCents: number; inStock: boolean }>;
      card: { brand: string | null; last4: string | null };
      expiresAt: string;
    };

type OriginalOrder = typeof orders.$inferSelect;

async function originalPaymentMethod(
  stripe: Pick<Stripe, "paymentIntents">,
  order: OriginalOrder,
  stripeCustomerId: string | null,
): Promise<{ id: string; brand: string | null; last4: string | null } | null> {
  if (!order.stripePaymentIntentId || !stripeCustomerId) return null;
  const intent = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId, { expand: ["payment_method"] });
  const pm = intent.payment_method;
  if (!pm || typeof pm === "string") return null;
  const pmCustomer = typeof pm.customer === "string" ? pm.customer : pm.customer?.id ?? null;
  // Only a card saved on this buyer's own customer can be charged again.
  if (pm.type !== "card" || pmCustomer !== stripeCustomerId) return null;
  return { id: pm.id, brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null };
}

type Eligibility =
  | { ok: false; reason: string; acceptedOrderId?: string | null }
  | {
      ok: true;
      order: OriginalOrder;
      offer: PostPurchaseOfferSettings & { productId: string };
      product: OfferProduct;
      paymentMethod: { id: string; brand: string | null; last4: string | null };
      stripeCustomerId: string;
      sellerName: string;
    };

/** Every rule in the module comment, in order. `now` is injectable for tests. */
export async function checkEligibility(
  stripe: Pick<Stripe, "paymentIntents">,
  buyerId: string,
  orderId: string,
  now = Date.now(),
): Promise<Eligibility> {
  if (!UUID_RE.test(orderId)) return { ok: false, reason: "ORDER_NOT_FOUND" };
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.buyerId !== buyerId) return { ok: false, reason: "ORDER_NOT_FOUND" };
  if (!order.paidAt || order.status === "cancelled" || order.status === "refund_pending") return { ok: false, reason: "ORDER_NOT_PAID" };
  if (order.upsellOfOrderId) return { ok: false, reason: "ALREADY_AN_OFFER" };
  const [accepted] = await db.select({ id: orders.id }).from(orders).where(eq(orders.upsellOfOrderId, order.id)).limit(1);
  if (accepted) return { ok: false, reason: "ALREADY_ACCEPTED", acceptedOrderId: accepted.id };
  if (now - order.paidAt.getTime() > OFFER_WINDOW_MS) return { ok: false, reason: "EXPIRED" };

  const offer = await getOfferSettings(order.ownerId);
  if (!offer.enabled || !offer.productId) return { ok: false, reason: "NO_OFFER" };
  const settings = (await loadSellerCheckoutSettings([order.ownerId])).get(order.ownerId);
  if (settings?.checkoutMode === "guest_only") return { ok: false, reason: "GUEST_CHECKOUT_ONLY" };
  const product = await loadOfferProduct(order.ownerId, offer.productId);
  if (!product) return { ok: false, reason: "PRODUCT_UNAVAILABLE" };
  if (!product.variants.some((v) => v.stock > 0)) return { ok: false, reason: "OUT_OF_STOCK" };

  const [buyer] = await db.select({ stripeCustomerId: users.stripeCustomerId }).from(users).where(eq(users.clerkId, buyerId)).limit(1);
  const paymentMethod = await originalPaymentMethod(stripe, order, buyer?.stripeCustomerId ?? null);
  if (!paymentMethod || !buyer?.stripeCustomerId) return { ok: false, reason: "NO_SAVED_PAYMENT_METHOD" };
  const [seller] = await db.select({ name: users.name, brandName: users.brandName, displayName: users.displayName }).from(users).where(eq(users.clerkId, order.ownerId)).limit(1);
  return {
    ok: true,
    order,
    offer: { ...offer, productId: offer.productId },
    product,
    paymentMethod,
    stripeCustomerId: buyer.stripeCustomerId,
    sellerName: seller?.brandName || seller?.displayName || seller?.name || "this shop",
  };
}

export async function offerForOrder(stripe: Pick<Stripe, "paymentIntents">, buyerId: string, orderId: string): Promise<OfferForOrder> {
  const check = await checkEligibility(stripe, buyerId, orderId);
  if (!check.ok) return { available: false, reason: check.reason, ...(check.acceptedOrderId ? { acceptedOrderId: check.acceptedOrderId } : {}) };
  return {
    available: true,
    orderId: check.order.id,
    sellerId: check.order.ownerId,
    sellerName: check.sellerName,
    product: { id: check.product.id, name: check.product.name, image: check.product.image },
    discountPercent: check.offer.discountPercent,
    variants: check.product.variants.map((v) => ({
      variantId: v.variantId,
      label: v.label,
      priceCents: v.priceCents,
      offerPriceCents: offerPriceCents(v.priceCents, check.offer.discountPercent),
      inStock: v.stock > 0,
    })),
    card: { brand: check.paymentMethod.brand, last4: check.paymentMethod.last4 },
    expiresAt: new Date(check.order.paidAt!.getTime() + OFFER_WINDOW_MS).toISOString(),
  };
}

/** The original order's ship-to address as the checkout's shipping (for tax and the PaymentIntent). */
function shippingFromOrder(order: OriginalOrder): CartShipping {
  const a = order.shippingAddress;
  if (!a?.street || !a.zip) throw new PostPurchaseError(409, "NO_SHIPPING_ADDRESS", "This order has no shipping address to add to.");
  return {
    name: a.name ?? "", street: a.street, line2: a.line2 ?? null, city: a.city, state: a.state,
    zip: a.zip, country: (a.country || "US").toUpperCase(), phone: "",
  };
}

/** Applies the offer to a priced one-item group: discount on merchandise, no shipping (ships with the order). */
export function applyOfferToGroup(group: PricedGroup, discountPercent: number): PricedGroup {
  const subtotal = group.subtotalCents;
  const discounted = group.items.reduce((sum, item) => sum + offerPriceCents(item.priceCents, discountPercent) * item.quantity, 0);
  const discountCents = subtotal - discounted;
  const fee = destinationApplicationFeeCents({ merchandiseCents: discounted, preTaxTotalCents: discounted });
  return {
    ...group,
    shippingCents: 0,
    shippingLineName: "Ships with your order",
    discountCodeId: null,
    discountCode: null,
    discountCents,
    merchandiseDiscountCents: discountCents,
    shippingDiscountCents: 0,
    platformFeeCents: fee.platformFeeCents,
    processingFeeEstimateCents: fee.processingFeeEstimateCents,
  };
}

/** A failed or abandoned attempt: give its unit back and drop its checkout row. */
async function clearAttempt(checkoutSessionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await releaseStockReservation(tx, checkoutSessionId);
    await tx.delete(checkoutSessions).where(eq(checkoutSessions.id, checkoutSessionId));
  });
}

export type AcceptResult = {
  paymentIntentId: string;
  status: string;
  /** Present only when the bank needs the buyer (3DS): the app confirms it with the saved card. */
  clientSecret: string | null;
  paymentMethodId: string;
  amountCents: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
};

/**
 * "Add to order": prices the offer server-side, reserves the unit, and
 * charges the original card. Idempotent per original order: while an
 * accepted offer's payment is in flight or paid, the same PaymentIntent is
 * returned instead of a new charge.
 */
export async function acceptOffer(
  stripe: Pick<Stripe, "paymentIntents" | "tax">,
  input: { buyerId: string; orderId: string; variantId: string; clientIdempotencyKey: string },
): Promise<AcceptResult> {
  const check = await checkEligibility(stripe, input.buyerId, input.orderId);

  // An earlier "Add to order" for this order (double tap, retry, app
  // restart): hand back a live or paid payment; clear failed ones.
  const priors = await db.select().from(checkoutSessions)
    .where(and(eq(checkoutSessions.buyerId, input.buyerId), eq(checkoutSessions.upsellOfOrderId, input.orderId)))
    .orderBy(desc(checkoutSessions.createdAt));
  for (const prior of priors) {
    if (!prior.stripePaymentIntentId) {
      if (Date.now() - prior.createdAt.getTime() < 2 * 60_000) {
        throw new PostPurchaseError(409, "PAYMENT_PENDING", "Your payment is already being processed.");
      }
      await clearAttempt(prior.id);
      continue;
    }
    const intent = await stripe.paymentIntents.retrieve(prior.stripePaymentIntentId);
    if (intent.status === "canceled" || intent.status === "requires_payment_method") {
      if (intent.status === "requires_payment_method") await stripe.paymentIntents.cancel(intent.id).catch(() => undefined);
      await clearAttempt(prior.id);
      continue;
    }
    const subtotal = (prior.items ?? []).reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
    return {
      paymentIntentId: intent.id,
      status: intent.status,
      clientSecret: intent.status === "requires_action" ? intent.client_secret : null,
      paymentMethodId: typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id ?? "",
      amountCents: intent.amount,
      subtotalCents: subtotal,
      discountCents: Math.max(0, subtotal + (prior.taxCents ?? 0) - (prior.amountTotalCents ?? 0)),
      taxCents: prior.taxCents ?? 0,
    };
  }
  if (!check.ok) {
    const messages: Record<string, string> = {
      ORDER_NOT_FOUND: "Order not found.",
      ALREADY_ACCEPTED: "This offer was already added to your order.",
      EXPIRED: "This offer has expired.",
      OUT_OF_STOCK: "This item just sold out.",
      NO_SAVED_PAYMENT_METHOD: "The card from this order can't be charged again. Buy the item from the shop instead.",
    };
    throw new PostPurchaseError(check.reason === "ORDER_NOT_FOUND" ? 404 : 409, check.reason, messages[check.reason] ?? "This offer isn't available.");
  }
  const variant = check.product.variants.find((v) => v.variantId === input.variantId);
  if (!variant) throw new PostPurchaseError(400, "INVALID_VARIANT", "Choose an option of the offered item.");
  if (variant.stock < 1) throw new PostPurchaseError(409, "OUT_OF_STOCK", "That option just sold out.");

  const shipping = shippingFromOrder(check.order);
  // Same validation as checkout (active, stock, seller payments, vacation,
  // no preorders), then the offer's own price and shipping.
  const priced = applyOfferToGroup(await priceCartGroup({
    buyerId: input.buyerId,
    items: [{ variantId: variant.variantId, productId: check.product.id, quantity: 1 }],
    shipping,
  }), check.offer.discountPercent);
  if (priced.sellerId !== check.order.ownerId) throw new PostPurchaseError(400, "INVALID_PRODUCT", "This item isn't from the same shop.");
  const tax = await calculateGroupTax(stripe, priced, shipping);
  const amountCents = priced.subtotalCents - priced.discountCents + tax.taxCents;
  if (amountCents < MIN_CARD_CHARGE_CENTS) throw new PostPurchaseError(400, "BELOW_MINIMUM", "This offer is below the minimum card charge.");

  const key = `pp_${input.orderId}_${input.clientIdempotencyKey}`.slice(0, 200);
  let row: typeof checkoutSessions.$inferSelect;
  try {
    row = await db.transaction(async (tx) => {
      // Serialise concurrent "Add to order" taps on this order.
      await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, input.orderId)).for("update");
      const [inFlight] = await tx.select({ id: checkoutSessions.id }).from(checkoutSessions)
        .where(eq(checkoutSessions.upsellOfOrderId, input.orderId)).limit(1);
      if (inFlight) throw new PostPurchaseError(409, "PAYMENT_PENDING", "Your payment is already being processed.");
      const [inserted] = await tx.insert(checkoutSessions).values({
        buyerId: input.buyerId,
        sellerId: priced.sellerId,
        items: priced.items.map(({ variantId, productName, variantLabel, quantity, priceCents }) => ({
          variantId, productName, variantLabel, quantity, priceCents,
        })),
        shippingAddress: {
          name: shipping.name, street: shipping.street, line2: shipping.line2,
          city: shipping.city, state: shipping.state, zip: shipping.zip, country: shipping.country,
        },
        clientIdempotencyKey: key,
        chargeModel: "transfer",
        platformFeeCents: priced.platformFeeCents,
        processingFeeEstimateCents: priced.processingFeeEstimateCents,
        amountTotalCents: amountCents,
        shippingCents: 0,
        taxCents: tax.taxCents,
        tipCents: 0,
        stripeTaxCalculationId: tax.calculationId,
        upsellOfOrderId: input.orderId,
      }).returning();
      await reserveStock(tx, inserted.id, priced.items.map((item) => ({
        variantId: item.variantId, quantity: item.quantity, productName: item.productName,
      })));
      return inserted;
    });
  } catch (error: any) {
    if (error?.code === "23505" || error?.cause?.code === "23505") {
      throw new PostPurchaseError(409, "PAYMENT_PENDING", "Your payment is already being processed.");
    }
    throw error;
  }

  const undo = () => clearAttempt(row.id);

  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: check.stripeCustomerId,
      payment_method: check.paymentMethod.id,
      payment_method_types: ["card"],
      confirm: true,
      // The buyer is here and tapped "Add to order"; the app finishes 3DS if asked.
      use_stripe_sdk: true,
      shipping: {
        name: shipping.name || "Customer",
        address: {
          line1: shipping.street,
          ...(shipping.line2 ? { line2: shipping.line2 } : {}),
          city: shipping.city, state: shipping.state, postal_code: shipping.zip, country: shipping.country,
        },
      },
      transfer_group: `cart_${row.id}`,
      description: `Brandthread post-purchase offer (adds to order ${check.order.orderNumber})`,
      metadata: {
        kind: CART_CHECKOUT_KIND, buyerId: input.buyerId, checkoutKey: key.slice(0, 100), upsellOfOrderId: input.orderId,
      },
    }, { idempotencyKey: `post-purchase-pi/${input.buyerId}/${key}` });
  } catch (error: any) {
    // A declined card throws, leaving an unpaid intent behind: close it.
    const failedIntent = error?.raw?.payment_intent ?? error?.payment_intent;
    if (failedIntent?.id) await stripe.paymentIntents.cancel(failedIntent.id).catch(() => undefined);
    await undo().catch((err) => logger.error({ err }, "Could not undo a post-purchase offer whose payment failed"));
    if (error?.type === "StripeCardError") {
      throw new PostPurchaseError(402, error.decline_code ?? error.code ?? "card_declined", error.message ?? "Your card was declined.");
    }
    logger.error({ err: error }, "Post-purchase PaymentIntent failed");
    throw new PostPurchaseError(502, "PAYMENT_START_FAILED", "We couldn't add this to your order. You haven't been charged.");
  }

  await db.transaction(async (tx) => {
    await tx.update(checkoutSessions).set({
      stripePaymentIntentId: intent.id,
      stripeSessionId: `${intent.id}:${row.id}`,
    }).where(eq(checkoutSessions.id, row.id));
    await tx.update(stockReservations).set({ stripePaymentIntentId: intent.id })
      .where(inArray(stockReservations.checkoutSessionId, [row.id]));
  });

  return {
    paymentIntentId: intent.id,
    status: intent.status,
    clientSecret: intent.status === "requires_action" ? intent.client_secret : null,
    paymentMethodId: check.paymentMethod.id,
    amountCents,
    subtotalCents: priced.subtotalCents,
    discountCents: priced.discountCents,
    taxCents: tax.taxCents,
  };
}
