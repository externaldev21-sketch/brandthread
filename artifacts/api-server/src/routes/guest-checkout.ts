/**
 * Guest checkout deliberately has no Clerk middleware.  Its opaque access
 * token is an authorization capability for post-redirect status only; the DB
 * stores a SHA-256 digest, never the capability itself.
 */
import { Router } from "express";
import crypto from "node:crypto";
import {
  db, checkoutSessions, orders, productVariants, products, users, shippingRates,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { computeApplicationFeeCents, mapStripeError, requireStripe } from "../lib/stripe";
import { getSellerVacationStatus } from "../lib/sellerAvailability";

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const guestTokenSecret = process.env.SESSION_SECRET;

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
  };
}

router.post("/session", async (req, res) => {
  let checkoutId: string | null = null;
  let stripeStarted = false;
  try {
    const stripe = requireStripe();
    const { items, successUrl, cancelUrl, contactEmail, shippingAddress, clientIdempotencyKey, dropId } = req.body ?? {};
    const email = typeof contactEmail === "string" ? contactEmail.trim().toLowerCase() : "";
    if (!emailPattern.test(email)) return res.status(400).json({ error: "A valid contactEmail is required" });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items required" });
    if (typeof successUrl !== "string" || typeof cancelUrl !== "string" || !successUrl || !cancelUrl) {
      return res.status(400).json({ error: "successUrl and cancelUrl required" });
    }
    const shippingAddressValue = shipping(shippingAddress);
    const seen = new Set<string>();
    const cartItems: any[] = [];
    const lineItems: any[] = [];
    let sellerId = "";
    for (let i = 0; i < items.length; i++) {
      const item = items[i] ?? {};
      if (typeof item.variantId !== "string" || seen.has(item.variantId)) {
        return res.status(400).json({ error: "Duplicate or invalid variantId" });
      }
      seen.add(item.variantId);
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ error: `Item ${i}: quantity must be >= 1` });
      const [variant] = await db.select({
        variantId: productVariants.id, priceCents: productVariants.priceCents, stock: productVariants.stock,
        size: productVariants.size, color: productVariants.color, productName: products.name,
        images: products.images, sellerId: products.ownerId, status: products.status,
      }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId))
        .where(and(eq(productVariants.id, item.variantId), eq(products.id, item.productId), isNull(products.deletedAt))).limit(1);
      if (!variant) return res.status(404).json({ error: `Variant ${item.variantId} not found` });
      if (variant.status !== "active" || variant.stock < quantity) return res.status(400).json({ error: `${variant.productName} is unavailable or out of stock` });
      if (sellerId && sellerId !== variant.sellerId) return res.status(400).json({ error: "All items must belong to the same seller" });
      sellerId = variant.sellerId;
      const variantLabel = [variant.size, variant.color].filter(Boolean).join(" / ");
      cartItems.push({ variantId: variant.variantId, productName: variant.productName, variantLabel, quantity, priceCents: variant.priceCents });
      lineItems.push({ price_data: { currency: "usd", unit_amount: variant.priceCents, product_data: {
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
    const [rate] = await db.select().from(shippingRates).where(and(eq(shippingRates.sellerId, sellerId), eq(shippingRates.active, true))).limit(1);
    const shippingCents = !rate || (rate.freeAboveCents != null && subtotalCents >= rate.freeAboveCents) ? 0 : rate.flatRateCents;
    if (shippingCents) lineItems.push({ price_data: { currency: "usd", unit_amount: shippingCents, product_data: { name: rate?.name ?? "Shipping" } }, quantity: 1 });
    const checkoutIdValue = crypto.randomUUID();
    const accessToken = guestAccessToken(checkoutIdValue);
    let checkout: { id: string };
    try {
      [checkout] = await db.insert(checkoutSessions).values({
        id: checkoutIdValue,
        buyerId: null, guestEmail: email, guestAccessTokenHash: tokenHash(accessToken), sellerId, items: cartItems,
        shippingAddress: shippingAddressValue, ...(key ? { clientIdempotencyKey: key } : {}),
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
    const validDropId = typeof dropId === "string" && dropId.trim() ? dropId.trim() : undefined;
    stripeStarted = true;
    const session = await stripe.checkout.sessions.create({
      mode: "payment", line_items: lineItems, automatic_tax: { enabled: true }, success_url: successUrl, cancel_url: cancelUrl,
      customer_email: email,
      metadata: { csRef: checkout.id, guest: "true", ...(validDropId ? { dropId: validDropId } : {}) },
      payment_intent_data: {
        metadata: { ...(validDropId ? { dropId: validDropId } : {}) },
        ...(validDropId ? {} : { transfer_data: { destination: seller.stripeAccountId }, application_fee_amount: computeApplicationFeeCents(subtotalCents) }),
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

router.post("/session/:sessionId/verify", async (req, res) => {
  const supplied = req.body?.guestAccessToken;
  if (typeof supplied !== "string" || supplied.length < 32) return res.status(401).json({ error: "Guest checkout access token required" });
  const [checkout] = await db.select().from(checkoutSessions).where(and(
    eq(checkoutSessions.stripeSessionId, req.params.sessionId),
    eq(checkoutSessions.guestAccessTokenHash, tokenHash(supplied)),
  )).limit(1);
  if (!checkout || checkout.buyerId) return res.status(404).json({ error: "Checkout session not found" });
  const session = await requireStripe().checkout.sessions.retrieve(req.params.sessionId);
  const [order] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status })
    .from(orders).where(eq(orders.stripeCheckoutSessionId, req.params.sessionId)).limit(1);
  return void res.json({
    status: session.status,
    paymentStatus: session.payment_status,
    amountTotal: session.amount_total ?? null,
    orderId: order?.id ?? null,
    orderNumber: order?.orderNumber ?? null,
    orderStatus: order?.status ?? null,
  });
});

export default router;