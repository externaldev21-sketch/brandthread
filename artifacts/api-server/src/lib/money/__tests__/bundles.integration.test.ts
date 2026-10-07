/**
 * Bundles end to end, both sides, against real Postgres with the in-memory
 * Stripe:
 *
 *   seller creates a bundle (routes/bundles.ts) → buyer's public endpoints
 *   show it → buyer prices a cart with / without the full bundle through the
 *   one-page PaymentIntent quote + create (routes/checkout-intent.ts), the
 *   hosted Checkout Session and guest Checkout (one Stripe coupon), and
 *   POST /buyer/cart/validate → the paid webhook stores bundle_discount_cents,
 *   bundle_lines and order_items.bundle_id → the seller's order detail,
 *   bundle list and analytics show the sale (net of refunds).
 *
 * Plus: another seller's bundle can't be injected into a cart, an archived
 * bundle is not applied, a fixed variant must belong to its product.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.SESSION_SECRET ??= "bundles-test-session-secret"; });

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("./fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", () => ({
  normalizePushEventCategory: () => "orders",
  sendPushToUser: async () => {},
  stableNotificationId: (...parts: string[]) => parts.join(":"),
}));
vi.mock("../../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
  sendOrderShippingEmail: async () => true,
  sendReturnStatusEmail: async () => true,
}));
vi.mock("../../../middlewares/requireAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../middlewares/requireAuth")>()),
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.headers["x-test-user"];
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));
// teamContext / requirePermission read Clerk directly.
vi.mock("@clerk/express", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clerk/express")>()),
  getAuth: (req: any) => ({ userId: req.headers["x-test-user"] ?? null }),
}));

import { db, checkoutSessions, discountCodes, orderItems, orders, productVariants, shippingRates } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { handleCartPaymentSucceeded, handleCheckoutPaid } from "../../../routes/webhooks";
import bundlesRouter from "../../../routes/bundles";
import checkoutIntentRouter from "../../../routes/checkout-intent";
import buyerRouter from "../../../routes/buyer";
import guestCheckoutRouter from "../../../routes/guest-checkout";
import ordersRouter from "../../../routes/orders";
import analyticsRouter from "../../../routes/analytics";
import { call, expectLedgerBalanced, seedBuyer, seedProduct, seedSeller, startApp, uid } from "./moneyHarness";

const TEE = 4_000;
const PANT = 6_000;
const BUNDLE = 8_000;
const SHIPPING = 1_200;
const TAX = 0.08;

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/bundles", bundlesRouter);
    server.use("/api/buyer/checkout/payment-intent", checkoutIntentRouter);
    server.use("/api/buyer", buyerRouter);
    server.use("/api/guest/checkout", guestCheckoutRouter);
    server.use("/api/orders", ordersRouter);
    server.use("/api/analytics", analyticsRouter);
    server.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: String(err?.stack ?? err) });
    });
  });
});
afterAll(async () => {
  await app.close();
  await expectLedgerBalanced();
});
beforeEach(() => fake.reset());

const address = {
  recipientName: "Jordan Reyes", street: "148 Mercer Street", line2: null,
  city: "New York", state: "NY", postalCode: "10012", country: "US",
};

type Shop = Awaited<ReturnType<typeof seedShop>>;

/** A seller with a tee (M, L) and pants, $12 flat shipping, a $10-off code, and an active "Tee + pant" bundle for $80. */
async function seedShop(tag: string) {
  const seller = await seedSeller(tag);
  const buyer = await seedBuyer(tag);
  const tee = await seedProduct(seller, { priceCents: TEE, stock: 10 });
  const [teeL] = await db.insert(productVariants).values({
    productId: tee.productId, sku: uid("sku"), size: "L", priceCents: TEE, stock: 10,
  }).returning();
  const pant = await seedProduct(seller, { priceCents: PANT, stock: 10 });
  await db.insert(shippingRates).values({ id: uid("rate"), sellerId: seller, name: "Standard", flatRateCents: SHIPPING });
  const code = `TEN${uid("c").replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;
  await db.insert(discountCodes).values({ id: uid("dc"), sellerId: seller, code, type: "fixed", value: "10.00" });

  // ── Seller creates the bundle through the real routes ──
  const created = await call(app.base, "POST", "/api/bundles", seller, { name: "Tee + pant", bundlePriceCents: BUNDLE });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const bundleId = created.body.id as string;
  // Tee: buyer picks the size. Pant: fixed variant.
  expect((await call(app.base, "POST", `/api/bundles/${bundleId}/items`, seller, { productId: tee.productId })).status).toBe(201);
  expect((await call(app.base, "POST", `/api/bundles/${bundleId}/items`, seller, { productId: pant.productId, variantId: pant.variantId })).status).toBe(201);
  expect((await call(app.base, "PATCH", `/api/bundles/${bundleId}`, seller, { status: "active" })).status).toBe(200);
  return { seller, buyer, tee, teeL, pant, code, bundleId };
}

function bundleItems(shop: Shop, opts: { withPant?: boolean; bundleId?: string | null } = {}) {
  const tag = opts.bundleId === undefined ? shop.bundleId : opts.bundleId;
  const items: Array<Record<string, unknown>> = [
    { variantId: shop.tee.variantId, productId: shop.tee.productId, quantity: 1, bundleId: tag },
  ];
  if (opts.withPant !== false) items.push({ variantId: shop.pant.variantId, productId: shop.pant.productId, quantity: 1, bundleId: tag });
  return items;
}

const tax = (cents: number) => Math.round(cents * TAX);

async function quote(shop: Shop, items: Array<Record<string, unknown>>, discountCode?: string) {
  return call(app.base, "POST", "/api/buyer/checkout/payment-intent/quote", shop.buyer, {
    groups: [{ items, ...(discountCode ? { discountCode } : {}) }],
    shippingAddress: { postalCode: "10012", country: "US" },
  });
}

describe("seller bundles", () => {
  it("rejects a fixed variant that belongs to another product, and keeps drafts in the seller's list", async () => {
    const shop = await seedShop("bdl-seller");
    const wrong = await call(app.base, "POST", `/api/bundles/${shop.bundleId}/items`, shop.seller, {
      productId: shop.pant.productId, variantId: shop.tee.variantId,
    });
    expect(wrong.status).toBe(400);

    const draft = await call(app.base, "POST", "/api/bundles", shop.seller, { name: "Draft set", bundlePriceCents: 5_000 });
    const list = await call(app.base, "GET", "/api/bundles", shop.seller);
    expect(list.status).toBe(200);
    expect(list.body.map((b: any) => b.id)).toEqual(expect.arrayContaining([shop.bundleId, draft.body.id]));
    expect(list.body.find((b: any) => b.id === shop.bundleId)).toMatchObject({ itemCount: 2, sales: { setsSold: 0 } });
  });

  it("another seller can't edit or add their products to the bundle", async () => {
    const shop = await seedShop("bdl-owner");
    const other = await seedSeller("bdl-owner-other");
    expect((await call(app.base, "PATCH", `/api/bundles/${shop.bundleId}`, other, { bundlePriceCents: 1 })).status).toBe(404);
    const theirs = await seedProduct(other, { priceCents: 1_000 });
    expect((await call(app.base, "POST", `/api/bundles/${shop.bundleId}/items`, other, { productId: theirs.productId })).status).toBe(404);
  });
});

describe("public bundle endpoints", () => {
  it("show active bundles with server prices on the product page, the storefront and the bundle detail", async () => {
    const shop = await seedShop("bdl-public");
    const byProduct = await call(app.base, "GET", `/api/bundles/public/by-product/${shop.tee.productId}`, "");
    expect(byProduct.status).toBe(200);
    expect(byProduct.body).toHaveLength(1);
    const bundle = byProduct.body[0];
    expect(bundle).toMatchObject({
      id: shop.bundleId, sellerId: shop.seller, bundlePriceCents: BUNDLE,
      itemsTotalCents: TEE + PANT, savingsCents: TEE + PANT - BUNDLE, needsSelection: true,
    });
    const teeItem = bundle.items.find((i: any) => i.productId === shop.tee.productId);
    expect(teeItem.variantId).toBeNull();
    expect(teeItem.variants.map((v: any) => v.size).sort()).toEqual(["L", "M"]);
    const pantItem = bundle.items.find((i: any) => i.productId === shop.pant.productId);
    expect(pantItem).toMatchObject({ variantId: shop.pant.variantId, priceCents: PANT });

    const storefront = await call(app.base, "GET", `/api/bundles/public/${shop.seller}`, "");
    expect(storefront.body.map((b: any) => b.id)).toEqual([shop.bundleId]);
    const detail = await call(app.base, "GET", `/api/bundles/public/bundle/${shop.bundleId}`, "");
    expect(detail.status).toBe(200);
    expect(detail.body.items).toHaveLength(2);
  });

  it("hide archived bundles, bundles with a sold-out item, and nonsense ids", async () => {
    const shop = await seedShop("bdl-hidden");
    await db.update(productVariants).set({ stock: 0 }).where(eq(productVariants.id, shop.pant.variantId));
    expect((await call(app.base, "GET", `/api/bundles/public/by-product/${shop.tee.productId}`, "")).body).toEqual([]);
    await db.update(productVariants).set({ stock: 10 }).where(eq(productVariants.id, shop.pant.variantId));
    expect((await call(app.base, "GET", `/api/bundles/public/by-product/${shop.tee.productId}`, "")).body).toHaveLength(1);

    expect((await call(app.base, "DELETE", `/api/bundles/${shop.bundleId}`, shop.seller)).status).toBe(200);
    expect((await call(app.base, "GET", `/api/bundles/public/by-product/${shop.tee.productId}`, "")).body).toEqual([]);
    expect((await call(app.base, "GET", `/api/bundles/public/bundle/${shop.bundleId}`, "")).status).toBe(404);
    expect((await call(app.base, "GET", "/api/bundles/public/by-product/not-a-uuid", "")).body).toEqual([]);
  });
});

describe("one-page checkout (PaymentIntent) prices the bundle", () => {
  it("quotes the bundle price for a full bundle, and full price without it", async () => {
    const shop = await seedShop("bdl-quote");
    const full = await quote(shop, bundleItems(shop));
    expect(full.status, JSON.stringify(full.body)).toBe(200);
    expect(full.body.groups[0]).toMatchObject({
      subtotalCents: TEE + PANT, bundleDiscountCents: 2_000, discountCents: 0, shippingCents: SHIPPING,
      taxCents: tax(BUNDLE + SHIPPING),
      bundleLines: [{ bundleId: shop.bundleId, name: "Tee + pant", sets: 1, discountCents: 2_000 }],
    });
    expect(full.body.amountCents).toBe(BUNDLE + SHIPPING + tax(BUNDLE + SHIPPING));
    // Tax lines are the discounted amounts, line by line (40% / 60% of the saving).
    expect(fake.state.taxCalculations.at(-1)!.params.line_items.map((l: any) => l.amount)).toEqual([TEE - 800, PANT - 1_200]);

    // The buyer removed the pants: no saving.
    const partial = await quote(shop, bundleItems(shop, { withPant: false }));
    expect(partial.body.groups[0]).toMatchObject({ subtotalCents: TEE, bundleDiscountCents: 0, bundleLines: [] });
    expect(partial.body.amountCents).toBe(TEE + SHIPPING + tax(TEE + SHIPPING));

    // Same items without the bundle tag: full price.
    const untagged = await quote(shop, bundleItems(shop, { bundleId: null }));
    expect(untagged.body.groups[0].bundleDiscountCents).toBe(0);
  });

  it("applies two sets when the quantities allow", async () => {
    const shop = await seedShop("bdl-two");
    const items = bundleItems(shop).map((i) => ({ ...i, quantity: 2 }));
    const res = await quote(shop, items);
    expect(res.body.groups[0]).toMatchObject({ bundleDiscountCents: 4_000, bundleLines: [{ sets: 2, discountCents: 4_000 }] });
  });

  it("takes the bundle off first, then the promo code on the remainder", async () => {
    const shop = await seedShop("bdl-code");
    const res = await quote(shop, bundleItems(shop), shop.code);
    expect(res.body.groups[0]).toMatchObject({ bundleDiscountCents: 2_000, discountCents: 1_000 });
    expect(res.body.amountCents).toBe(BUNDLE - 1_000 + SHIPPING + tax(BUNDLE - 1_000 + SHIPPING));
  });

  it("creates the intent at the server total, and the webhook records the bundle on the order the seller sees", async () => {
    const shop = await seedShop("bdl-paid");
    const created = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", shop.buyer, {
      groups: [{ items: bundleItems(shop), discountCode: shop.code }],
      contactEmail: "buyer@test.local",
      contactPhone: "+1 503 555 0100",
      shippingAddress: address,
      clientIdempotencyKey: uid("pay"),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const expected = BUNDLE - 1_000 + SHIPPING + tax(BUNDLE - 1_000 + SHIPPING);
    expect(created.body.amountCents).toBe(expected);
    expect(fake.state.paymentIntentCreates.at(-1)!.params.amount).toBe(expected);

    const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripePaymentIntentId, created.body.paymentIntentId));
    expect(row.bundleDiscountCents).toBe(2_000);
    expect(row.items.every((i) => i.bundleId === shop.bundleId)).toBe(true);

    const intent = fake.state.paymentIntents.get(created.body.paymentIntentId);
    intent.status = "succeeded";
    intent.amount_received = intent.amount;
    intent.latest_charge = `ch_${intent.id}`;
    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date());
    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date()); // redelivery is a no-op

    const [order] = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, intent.id));
    expect(order.grossChargedCents).toBe(expected);
    expect(order.bundleDiscountCents).toBe(2_000);
    expect(order.discountAmountCents).toBe(3_000); // bundle + promo
    expect(order.bundleLines).toEqual([{
      bundleId: shop.bundleId, name: "Tee + pant", sets: 1, itemsCents: TEE + PANT, bundlePriceCents: BUNDLE, discountCents: 2_000,
    }]);
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(lines.map((l) => l.bundleId)).toEqual([shop.bundleId, shop.bundleId]);

    // ── Seller side ──
    const detail = await call(app.base, "GET", `/api/orders/${order.id}`, shop.seller);
    expect(detail.status).toBe(200);
    expect(detail.body.bundleDiscountCents).toBe(2_000);
    expect(detail.body.bundleLines[0]).toMatchObject({ name: "Tee + pant", discountCents: 2_000 });
    expect(detail.body.items.map((i: any) => i.bundleId)).toEqual([shop.bundleId, shop.bundleId]);

    const analytics = await call(app.base, "GET", "/api/analytics/bundles", shop.seller);
    expect(analytics.status).toBe(200);
    expect(analytics.body).toEqual([{
      bundleId: shop.bundleId, name: "Tee + pant", status: "active",
      setsSold: 1, orderCount: 1, grossRevenueCents: BUNDLE, revenueCents: BUNDLE, discountCents: 2_000,
    }]);
    const list = await call(app.base, "GET", "/api/bundles", shop.seller);
    expect(list.body.find((b: any) => b.id === shop.bundleId).sales).toEqual({
      setsSold: 1, orderCount: 1, revenueCents: BUNDLE, discountCents: 2_000,
    });

    // Net of refunds: half the order refunded → half the bundle revenue.
    await db.update(orders).set({ refundedCents: Math.round(order.totalCents / 2) }).where(eq(orders.id, order.id));
    const afterRefund = await call(app.base, "GET", "/api/analytics/bundles", shop.seller);
    expect(afterRefund.body[0].revenueCents).toBe(Math.round(BUNDLE * (order.totalCents - Math.round(order.totalCents / 2)) / order.totalCents));
    // Cancelled orders don't count.
    await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, order.id));
    expect((await call(app.base, "GET", "/api/analytics/bundles", shop.seller)).body).toEqual([]);
  });

  it("refuses another seller's bundle injected into the cart", async () => {
    const shop = await seedShop("bdl-inject");
    const rival = await seedShop("bdl-inject-rival");
    const res = await quote(shop, bundleItems(shop, { bundleId: rival.bundleId }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BUNDLE_SELLER_MISMATCH");

    const hosted = await call(app.base, "POST", "/api/buyer/checkout/session", shop.buyer, hostedBody(bundleItems(shop, { bundleId: rival.bundleId })));
    expect(hosted.status).toBe(400);
    expect(hosted.body.code).toBe("BUNDLE_SELLER_MISMATCH");
    expect(fake.state.checkoutSessionCreates).toHaveLength(0);
  });

  it("does not apply an archived bundle still tagged in a cart", async () => {
    const shop = await seedShop("bdl-archived");
    await call(app.base, "DELETE", `/api/bundles/${shop.bundleId}`, shop.seller);
    const res = await quote(shop, bundleItems(shop));
    expect(res.status).toBe(200);
    expect(res.body.groups[0].bundleDiscountCents).toBe(0);
    expect(res.body.amountCents).toBe(TEE + PANT + SHIPPING + tax(TEE + PANT + SHIPPING));
  });
});

function hostedBody(items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return {
    items,
    successUrl: "https://brandthread.test/checkout/success",
    cancelUrl: "https://brandthread.test/checkout/cancel",
    contactEmail: "buyer@test.local",
    contactPhone: "+1 503 555 0100",
    shippingAddress: { ...address, line2: undefined, phone: "+1 503 555 0100" },
    clientIdempotencyKey: uid("idem"),
    ...extra,
  };
}

describe("hosted and guest Checkout apply the bundle as a Stripe coupon", () => {
  it("hosted: one coupon for bundle + promo, the order records the bundle", async () => {
    const shop = await seedShop("bdl-hosted");
    const res = await call(app.base, "POST", "/api/buyer/checkout/session", shop.buyer, hostedBody(bundleItems(shop), { discountCode: shop.code }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(fake.state.coupons).toHaveLength(1);
    expect(fake.state.coupons[0].amount_off).toBe(2_000 + 1_000);
    expect(fake.state.coupons[0].name).toContain("Bundle: Tee + pant");
    expect(fake.state.coupons[0].name.length).toBeLessThanOrEqual(40);

    const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripeSessionId, res.body.sessionId));
    expect(row).toMatchObject({ bundleDiscountCents: 2_000, discountCodeAmountCents: 1_000 });

    const session = fake.state.checkoutSessions.get(res.body.sessionId);
    Object.assign(session, {
      status: "complete", payment_status: "paid", payment_intent: `pi_${uid("pi").replace(/-/g, "_")}`,
      amount_total: TEE + PANT + SHIPPING - 3_000,
      total_details: { amount_tax: 0, amount_shipping: SHIPPING, amount_discount: 3_000 },
      metadata: { ...session.metadata, csRef: row.id },
    });
    await handleCheckoutPaid(session, `evt_${uid("paid")}`, new Date());
    const [order] = await db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, res.body.sessionId));
    expect(order).toMatchObject({ bundleDiscountCents: 2_000, discountAmountCents: 3_000, totalCents: TEE + PANT + SHIPPING - 3_000 });
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(lines.every((l) => l.bundleId === shop.bundleId)).toBe(true);
  });

  it("hosted without the full bundle: no coupon", async () => {
    const shop = await seedShop("bdl-hosted-partial");
    const res = await call(app.base, "POST", "/api/buyer/checkout/session", shop.buyer, hostedBody(bundleItems(shop, { withPant: false })));
    expect(res.status).toBe(200);
    expect(fake.state.coupons).toHaveLength(0);
  });

  it("guest: the bundle saving is a coupon on the session", async () => {
    const shop = await seedShop("bdl-guest");
    const res = await call(app.base, "POST", "/api/guest/checkout/session", "", {
      ...hostedBody(bundleItems(shop)),
      shippingAddress: { name: "Jordan Reyes", street: "148 Mercer Street", city: "New York", state: "NY", zip: "10012", country: "US", phone: "+1 503 555 0100" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(fake.state.coupons.map((c) => c.amount_off)).toEqual([2_000]);
    expect(fake.state.checkoutSessionCreates.at(-1)!.params.discounts).toEqual([{ coupon: fake.state.coupons[0].id }]);
  });
});

describe("POST /api/buyer/cart/validate", () => {
  it("reports the bundle saving, and validates the promo against the remainder", async () => {
    const shop = await seedShop("bdl-validate");
    const full = await call(app.base, "POST", "/api/buyer/cart/validate", shop.buyer, { items: bundleItems(shop), discountCodes: [shop.code] });
    expect(full.status).toBe(200);
    expect(full.body).toMatchObject({ isValid: true, bundleDiscountCents: 2_000 });
    expect(full.body.bundles).toEqual([{ sellerId: shop.seller, bundleId: shop.bundleId, name: "Tee + pant", sets: 1, discountCents: 2_000 }]);

    const partial = await call(app.base, "POST", "/api/buyer/cart/validate", shop.buyer, { items: bundleItems(shop, { withPant: false }) });
    expect(partial.body).toMatchObject({ isValid: true, bundleDiscountCents: 0, bundles: [] });
  });
});
