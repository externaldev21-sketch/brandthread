/**
 * Guest checkout deliberately has no Clerk middleware.  Its opaque access
 * token is an authorization capability for post-redirect status only; the DB
 * stores a SHA-256 digest, never the capability itself.
 */
import { Router } from "express";
import crypto from "node:crypto";
import {
  db, checkoutSessions, orders, productVariants, products, users, shippingRates,
  shippingZones, shippingZoneWeightTiers,
} from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { mapStripeError, requireStripe } from "../lib/stripe";
import { CheckoutPlanError, paymentIntentMoney, resolveChargePlan, type ChargePlan } from "../lib/money/checkoutPlan";
import { getSellerVacationStatus } from "../lib/sellerAvailability";
import { resolveShippingForDestination, type ShippingZoneRow, type ShippingZoneWeightTierRow } from "../lib/shippingZones";
import { z } from "@workspace/api-zod";
import { requestPrimitives, validateRequest } from "../middlewares/validateRequest";

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const guestTokenSecret = process.env.SESSION_SECRET;
const shippingAddressSchema = z.object({
  name: requestPrimitives.shortText.optional(),
  recipientName: requestPrimitives.shortText.optional(),
  street: requestPrimitives.shortText,
  line2: z.string().trim().max(160).nullable().optional(),
  city: requestPrimitives.shortText,
  state: requestPrimitives.shortText,
  zip: z.string().trim().min(2).max(20).optional(),
  postalCode: z.string().trim().min(2).max(20).optional(),
  country: z.string().trim().length(2).default("US"),
  phone: z.string().trim().regex(/^[0-9+(). -]{7,32}$/),
}).refine((value) => Boolean(value.name ?? value.recipientName), {
  message: "A recipient name is required",
  path: ["name"],
}).refine((value) => Boolean(value.zip ?? value.postalCode), {
  message: "A postal code is required",
  path: ["zip"],
});
const guestCheckoutSchema = z.object({
  items: z.array(z.object({
    productId: requestPrimitives.uuid,
    variantId: requestPrimitives.uuid,
    quantity: z.coerce.number().int().min(1).max(100),
  })).min(1).max(100),
  successUrl: requestPrimitives.url,
  cancelUrl: requestPrimitives.url,
  contactEmail: requestPrimitives.email,
  contactPhone: z.string().trim().regex(/^[0-9+(). -]{7,32}$/),
  shippingAddress: shippingAddressSchema,
  clientIdempotencyKey: z.string().trim().min(8).max(160),
  dropId: requestPrimitives.uuid.nullable().optional(),
}).passthrough();
const guestVerifyParamsSchema = z.object({ sessionId: requestPrimitives.id });
const guestVerifyBodySchema = z.object({
  guestAccessToken: z.string().min(32).max(512),
});

function guestAccessToken(checkoutId: string): string {
  if (!guestTokenSecret) {
    throw Object.assign(new Error("Guest checkout is temporarily unavailable"), { status: 503 });
  }
  return crypto
    .createHmac("sha256", guestTokenSecret)
    .update(`guest-checkout:${checkoutId}`)
    .digest("base64url");
}

function text(value: unknown, field: string, required = true, max = 160): string | null {
  if (value == null && !required) return null;
  if (typeof value !== "string") throw Object.assign(new Error(`${field} must be a string`), { status: 400 });
  const valueClean = value.trim().replace(/\s+/g, " ");
  if (required && !valueClean) throw Object.assign(new Error(`${field} is required`), { status: 400 });
  if (valueClean.length > max) throw Object.assign(new Error(`${field} is too long`), { status: 400 });
  return valueClean || null;
}

function shipping(raw: any) {
  if (!raw || typeof raw !== "object") throw Object.assign(new Error("shippingAddress is required"), { status: 400 });
  const country = text(raw.country ?? "US", "shippingAddress.country", true, 2)!.toUpperCase();
  const zip = text(raw.zip ?? raw.postalCode, "shippingAddress.zip", true, 20)!.toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z0-9][A-Z0-9 -]{1,15}$/.test(zip)) {
    throw Object.assign(new Error("shippingAddress country or postal code is invalid"), { status: 400 });
  }
  return {
    name: text(raw.name ?? raw.recipientName, "shippingAddress.name", true)!,
    street: text(raw.street, "shippingAddress.street", true)!,
    line2: text(raw.line2, "shippingAddress.line2", false),
    city: text(raw.city, "shippingAddress.city", true)!,
    state: text(raw.state, "shippingAddress.state", true)!,
    zip, country,
    phone: text(raw.phone, "shippingAddress.phone", true, 32)!,
  };
}

router.post("/session", validateRequest({ body: guestCheckoutSchema }), async (req, res) => {
  let checkoutId: string | null = null;
  let stripeStarted = false;
  try {
    const stripe = requireStripe();
    const { items, successUrl, cancelUrl, contactEmail, contactPhone, shippingAddress, clientIdempotencyKey, dropId } = req.body ?? {};
    const email = typeof contactEmail === "string" ? contactEmail.trim().toLowerCase() : "";
    if (!emailPattern.test(email)) return res.status(400).json({ error: "A valid contactEmail is required" });
    const phone = typeof contactPhone === "string" ? contactPhone.trim() : "";
    if (!/^[0-9+(). -]{7,32}$/.test(phone)) return res.status(400).json({ error: "A valid contactPhone is required" });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items required" });
    if (typeof successUrl !== "string" || typeof cancelUrl !== "string" || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: "successUrl and cancelUrl required" });
    }
    const shippingAddressValue = shipping(shippingAddress);
    const seen = new Set<string>();
    const cartItems: any[] = [];
    const lineItems: any[] = [];
    let sellerId = "";
    // Tracked separately (not persisted on the checkout-session row) so it
    // can feed weight-tiered shipping zones without changing the shape of
    // the stored cart item snapshot.
    let cartWeightGrams = 0;

    // Batch-fetch every variant+product pair in one round trip instead of one
    // query per cart line (was: 1 query per item, O(N) round trips; now: 1
    // query total, O(1)). Pairing with the caller-declared productId is still
    // enforced in-memory below so a variantId cannot be claimed under the
    // wrong product.
    const requestedVariantIds = [...new Set(
      items.map((item: { variantId?: unknown }) => item?.variantId).filter((id): id is string => typeof id === "string"),
    )];
    const variantRows = requestedVariantIds.length > 0
      ? await db.select({
          variantId: productVariants.id, productId: productVariants.productId,
          priceCents: productVariants.priceCents, stock: productVariants.stock,
          size: productVariants.size, color: productVariants.color, productName: products.name,
          images: products.images, sellerId: products.ownerId, status: products.status,
          weightGrams: productVariants.weightGrams,
        }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId))
          .where(and(inArray(productVariants.id, requestedVariantIds), isNull(products.deletedAt)))
      : [];
    const variantById = new Map(variantRows.map((row) => [row.variantId, row]));

    for (let i = 0; i < items.length; i++) {
      const item = items[i] ?? {};
      if (typeof item.variantId !== "string" || seen.has(item.variantId)) {
        return res.status(400).json({ error: "Duplicate or invalid variantId" });
      }
      seen.add(item.variantId);
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ error: `Item ${i}: quantity must be >= 1` });
      const variant = variantById.get(item.variantId);
      if (!variant || variant.productId !== item.productId) return res.status(404).json({ error: `Variant ${item.variantId} not found` });
      if (variant.status !== "active" || variant.stock < quantity) return res.status(400).json({ error: `${variant.productName} is unavailable or out of stock` });
      if (sellerId && sellerId !== variant.sellerId) return res.status(400).json({ error: "All items must belong to the same seller" });
      sellerId = variant.sellerId;
      const variantLabel = [variant.size, variant.color].filter(Boolean).join(" / ");
      cartItems.push({ variantId: variant.variantId, productName: variant.productName, variantLabel, quantity, priceCents: variant.priceCents });
      cartWeightGrams += (variant.weightGrams ?? 0) * quantity;
      lineItems.push({ price_data: { currency: "usd", unit_amount: variant.priceCents, tax_behavior: "exclusive", product_data: {
        name: variant.productName, ...(variantLabel ? { description: variantLabel } : {}),
        ...(Array.isArray(variant.images) && variant.images[0] ? { images: [variant.images[0]] } : {}),
      } }, quantity });
    }
    const [seller] = await db.select({ stripeAccountId: users.stripeAccountId, stripeAccountStatus: users.stripeAccountStatus })
      .from(users).where(eq(users.clerkId, sellerId)).limit(1);
    const vacation = await getSellerVacationStatus(sellerId);
    if (vacation.active) {
      return res.status(409).json({
        error: vacation.message,
        code: "SELLER_ON_VACATION",
        vacationUntil: vacation.until?.toISOString() ?? null,
      });
    }
    if (!seller?.stripeAccountId || seller.stripeAccountStatus !== "active") {
      return res.status(400).json({ error: "Seller payment account is not active. Please try again later." });
    }
    let chargePlan: ChargePlan;
    try {
      chargePlan = await resolveChargePlan({
        productIds: items.map((item: { productId: string }) => item.productId),
        sellerId,
        clientDropId: typeof dropId === "string" && dropId.trim() ? dropId.trim() : null,
      });
    } catch (planError) {
      if (planError instanceof CheckoutPlanError) {
        return res.status(planError.status).json({ error: planError.message, code: planError.code });
      }
      throw planError;
    }
    const key = typeof clientIdempotencyKey === "string" && clientIdempotencyKey.trim() ? clientIdempotencyKey.trim() : null;
    if (key) {
      const [existing] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.clientIdempotencyKey, key)).limit(1);
      if (existing) {
        // Never let a key from an authenticated checkout reveal its session.
        if (existing.buyerId || existing.guestEmail !== email || !existing.stripeSessionId) return res.status(409).json({ error: "Checkout idempotency key cannot be reused" });
        const accessToken = guestAccessToken(existing.id);
        if (tokenHash(accessToken) !== existing.guestAccessTokenHash) {
          return res.status(409).json({ error: "Checkout idempotency key cannot be reused" });
        }
        const stripeSession = await stripe.checkout.sessions.retrieve(existing.stripeSessionId);
        return res.json({ sessionId: existing.stripeSessionId, url: stripeSession.url, guestAccessToken: accessToken });
      }
    }
    const subtotalCents = cartItems.reduce((n, item) => n + item.priceCents * item.quantity, 0);

    // Prefer the seller's worldwide shipping zones; fall back to the legacy
    // single flat-rate row (shippingRates) when they have no zones configured
    // yet, so existing sellers keep working unchanged. This only decides the
    // shipping line item amount — Stripe payment-intent construction and the
    // seller's payout amount below are unaffected by which path priced it.
    const zoneRows = await db.select().from(shippingZones)
      .where(and(eq(shippingZones.sellerId, sellerId), eq(shippingZones.active, true)));
    let shippingCents = 0;
    let shippingLineName = "Shipping";
    if (zoneRows.length > 0) {
      const [sellerRow] = await db.select({ country: users.sellerShipFromCountry }).from(users).where(eq(users.clerkId, sellerId)).limit(1);
      const weightTierRows: ShippingZoneWeightTierRow[] = [];
      for (const z of zoneRows) {
        if (z.pricingModel !== "weight_tiered") continue;
        const rows = await db.select().from(shippingZoneWeightTiers).where(eq(shippingZoneWeightTiers.zoneId, z.id));
        weightTierRows.push(...rows);
      }
      const resolved = resolveShippingForDestination({
        zones: zoneRows as unknown as ShippingZoneRow[],
        weightTiers: weightTierRows,
        destinationCountry: shippingAddressValue.country,
        sellerHomeCountry: sellerRow?.country ?? "US",
        subtotalCents,
        weightGrams: cartWeightGrams,
      });
      if (resolved.unavailable) {
        return res.status(400).json({ error: "This seller does not ship to the selected destination" });
      }
      shippingCents = resolved.shippingCents;
      shippingLineName = resolved.zoneName ? `Shipping (${resolved.zoneName})` : "Shipping";
    } else {
      const [rate] = await db.select().from(shippingRates).where(and(eq(shippingRates.sellerId, sellerId), eq(shippingRates.active, true))).limit(1);
      shippingCents = !rate || (rate.freeAboveCents != null && subtotalCents >= rate.freeAboveCents) ? 0 : rate.flatRateCents;
      shippingLineName = rate?.name ?? "Shipping";
    }
    if (shippingCents) lineItems.push({ price_data: {
      currency: "usd",
      unit_amount: shippingCents,
      tax_behavior: "exclusive",
      product_data: { name: shippingLineName },
    }, quantity: 1 });
    const money = paymentIntentMoney({
      plan: chargePlan,
      sellerStripeAccountId: seller.stripeAccountId,
      merchandiseCents: subtotalCents,
      preTaxTotalCents: subtotalCents + shippingCents,
    });
    const checkoutIdValue = crypto.randomUUID();
    const accessToken = guestAccessToken(checkoutIdValue);
    let checkout: { id: string };
    try {
      [checkout] = await db.insert(checkoutSessions).values({
        id: checkoutIdValue,
        buyerId: null, guestEmail: email, guestAccessTokenHash: tokenHash(accessToken), sellerId, items: cartItems,
        shippingAddress: shippingAddressValue, ...(key ? { clientIdempotencyKey: key } : {}),
        chargeModel: chargePlan.chargeModel,
        dropId: chargePlan.dropId,
        platformFeeCents: money.platformFeeCents,
        processingFeeEstimateCents: money.processingFeeEstimateCents,
      }).returning({ id: checkoutSessions.id });
    } catch (error: any) {
      // A concurrent duplicate request lost the DB uniqueness race. Reuse only
      // its own guest checkout, never an authenticated row sharing a key.
      if (key && error?.code === "23505") {
        const [winner] = await db.select().from(checkoutSessions)
          .where(eq(checkoutSessions.clientIdempotencyKey, key)).limit(1);
        if (winner && !winner.buyerId && winner.guestEmail === email && winner.stripeSessionId) {
          const winnerAccessToken = guestAccessToken(winner.id);
          if (tokenHash(winnerAccessToken) !== winner.guestAccessTokenHash) {
            return void res.status(409).json({ error: "Checkout idempotency key cannot be reused" });
          }
          const stripeSession = await stripe.checkout.sessions.retrieve(winner.stripeSessionId);
          return void res.json({
            sessionId: winner.stripeSessionId,
            url: stripeSession.url,
            guestAccessToken: winnerAccessToken,
          });
        }
        return void res.status(409).json({ error: "Checkout is still being prepared. Please try again." });
      }
      throw error;
    }
    checkoutId = checkout.id;
    const validDropId = chargePlan.dropId ?? undefined;
    stripeStarted = true;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      automatic_tax: {
        enabled: true,
        liability: { type: "account", account: seller.stripeAccountId },
      },
      shipping_address_collection: { allowed_countries: [shippingAddressValue.country] },
      success_url: successUrl, cancel_url: cancelUrl,
      customer_email: email,
      metadata: { csRef: checkout.id, guest: "true", ...(validDropId ? { dropId: validDropId } : {}) },
      payment_intent_data: {
        ...money.paymentIntentData,
        metadata: {
          ...(money.paymentIntentData.metadata as Record<string, string>),
          ...(validDropId ? { dropId: validDropId } : {}),
        },
      },
    }, key ? { idempotencyKey: `guest_cs_${key}` } : {});
    await db.update(checkoutSessions).set({ stripeSessionId: session.id }).where(eq(checkoutSessions.id, checkout.id));
    // This is the sole response containing this token. It is not logged or stored raw.
    return void res.status(201).json({ sessionId: session.id, url: session.url, guestAccessToken: accessToken });
  } catch (error: any) {
    if (!stripeStarted && checkoutId) await db.delete(checkoutSessions).where(eq(checkoutSessions.id, checkoutId));
    if (error.type === "StripeCardError" || error.code === "card_declined") return res.status(402).json({ error: mapStripeError(error) });
    return void res.status(error.status ?? 500).json({ error: error.status ? error.message : "Failed to create checkout session" });
  }
});

router.post(
  "/session/:sessionId/verify",
  validateRequest({ params: guestVerifyParamsSchema, body: guestVerifyBodySchema }),
  async (req, res) => {
  const sessionId = req.params.sessionId as string;
  const supplied = req.body?.guestAccessToken;
  if (typeof supplied !== "string" || supplied.length < 32) return res.status(401).json({ error: "Guest checkout access token required" });
  const [checkout] = await db.select().from(checkoutSessions).where(and(
    eq(checkoutSessions.stripeSessionId, sessionId),
    eq(checkoutSessions.guestAccessTokenHash, tokenHash(supplied)),
  )).limit(1);
  if (!checkout || checkout.buyerId) return res.status(404).json({ error: "Checkout session not found" });
  const session = await requireStripe().checkout.sessions.retrieve(sessionId);
  const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status })
    .from(orders).where(eq(orders.stripeCheckoutSessionId, sessionId)).limit(1);
  return void res.json({
    status: session.status,
    paymentStatus: session.payment_status,
    amountTotal: session.amount_total ?? null,
    orderId: order?.id ?? null,
    orderNumber: order?.orderNumber ?? null,
    orderStatus: order?.status ?? null,
  });
  },
);

export default router;