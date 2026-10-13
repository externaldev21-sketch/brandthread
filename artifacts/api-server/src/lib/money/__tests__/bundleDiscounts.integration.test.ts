/**
 * Seller bundles ("Buy the set") at checkout, against real Postgres with the
 * in-memory Stripe:
 *  - the one-page quote takes the bundle off first, then a 10% code on what
 *    is left, and taxes the discounted merchandise;
 *  - the paid order records the bundle inside discountAmountCents (and on
 *    its own column), the code's use records only the code's part, and the
 *    platform fee is on the discounted merchandise;
 *  - hosted Checkout puts the bundle on the one combined coupon;
 *  - an incomplete set gets nothing;
 *  - the public product endpoint shows only bundles that save something.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("./fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../push")>()),
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
vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

import { bundleItems, checkoutSessions, db, discountCodeUses, discountCodes, orders, productBundles } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { handleCartPaymentSucceeded } from "../../../routes/webhooks";
import checkoutIntentRouter from "../../../routes/checkout-intent";
import buyerRouter from "../../../routes/buyer";
import bundlesRouter from "../../../routes/bundles";
import { destinationApplicationFeeCents } from "../fees";
import { call, expectLedgerBalanced, seedBuyer, seedProduct, seedSeller, startApp, uid } from "./moneyHarness";

const TEE = 4_000;
const CAP = 2_500;
const SET = 5_500; // saves $10

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/buyer/checkout/payment-intent", checkoutIntentRouter);
    server.use("/api/buyer", buyerRouter);
    server.use("/api/bundles", bundlesRouter);
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

async function seedShop(tag: string) {
  const seller = await seedSeller(tag);
  const buyer = await seedBuyer(tag);
  const tee = await seedProduct(seller, { priceCents: TEE, stock: 10 });
  const cap = await seedProduct(seller, { priceCents: CAP, stock: 10 });
  const [bundle] = await db.insert(productBundles).values({
    ownerId: seller, name: `Set ${uid("b")}`, bundlePriceCents: SET, status: "active",
  }).returning();
  await db.insert(bundleItems).values([
    { bundleId: bundle.id, productId: tee.productId },
    { bundleId: bundle.id, productId: cap.productId },
  ]);
  const code = `TEN${uid("c").replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;
  await db.insert(discountCodes).values({ id: uid("dc"), sellerId: seller, code, type: "percentage", value: "10.00" });
  return { seller, buyer, tee, cap, bundle, code };
}

const address = { recipientName: "Jordan Reyes", street: "148 Mercer Street", city: "New York", state: "NY", postalCode: "10012", country: "US" };

describe("bundle discounts at checkout", () => {
  it("quotes the bundle first, then the code on the rest, and pays out on the discounted amount", async () => {
    const shop = await seedShop("bundle-quote");
    const items = [
      { variantId: shop.tee.variantId, productId: shop.tee.productId, quantity: 1 },
      { variantId: shop.cap.variantId, productId: shop.cap.productId, quantity: 1 },
    ];
    const quote = await call(app.base, "POST", "/api/buyer/checkout/payment-intent/quote", shop.buyer, {
      groups: [{ items, discountCode: shop.code }], shippingAddress: { postalCode: "10012", country: "US" },
    });
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    const bundleCents = TEE + CAP - SET; // 1,000
    const promoCents = Math.round(SET * 0.1); // 550, on what the bundle left
    const merchandise = TEE + CAP - bundleCents - promoCents;
    const tax = Math.round(merchandise * 0.08);
    expect(quote.body.groups[0]).toMatchObject({
      subtotalCents: TEE + CAP,
      bundleDiscountCents: bundleCents,
      discountCents: bundleCents + promoCents,
      taxCents: tax,
      totalCents: merchandise + tax,
    });
    expect(quote.body.groups[0].bundles).toEqual([{ bundleId: shop.bundle.id, name: shop.bundle.name, copies: 1, discountCents: bundleCents }]);

    const created = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", shop.buyer, {
      groups: [{ items, discountCode: shop.code }], contactEmail: "buyer@test.local", contactPhone: "+1 503 555 0100",
      shippingAddress: address, clientIdempotencyKey: uid("pay"),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.amountCents).toBe(merchandise + tax);
    const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripePaymentIntentId, created.body.paymentIntentId));
    expect(row.bundleDiscountCents).toBe(bundleCents);
    expect(row.discountCodeAmountCents).toBe(promoCents);
    expect(row.platformFeeCents).toBe(destinationApplicationFeeCents({
      merchandiseCents: merchandise, preTaxTotalCents: merchandise, platformFeeBps: row.platformFeeBps,
    }).platformFeeCents);

    const intent = fake.state.paymentIntents.get(created.body.paymentIntentId);
    intent.status = "succeeded";
    intent.amount_received = intent.amount;
    intent.latest_charge = `ch_${intent.id}`;
    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date());
    const [order] = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, intent.id));
    expect(order.discountAmountCents).toBe(bundleCents + promoCents);
    expect(order.bundleDiscountCents).toBe(bundleCents);
    expect(order.grossChargedCents).toBe(merchandise + tax);
    const [use] = await db.select().from(discountCodeUses).where(eq(discountCodeUses.orderId, order.id));
    expect(use.appliedAmountCents).toBe(promoCents);
    await expectLedgerBalanced();
  });

  it("gives nothing for an incomplete set", async () => {
    const shop = await seedShop("bundle-partial");
    const quote = await call(app.base, "POST", "/api/buyer/checkout/payment-intent/quote", shop.buyer, {
      groups: [{ items: [{ variantId: shop.tee.variantId, productId: shop.tee.productId, quantity: 2 }] }],
      shippingAddress: { postalCode: "10012", country: "US" },
    });
    expect(quote.status).toBe(200);
    expect(quote.body.groups[0]).toMatchObject({ bundleDiscountCents: 0, discountCents: 0, bundles: [] });
  });

  it("hosted Checkout puts the bundle on the combined coupon", async () => {
    const shop = await seedShop("bundle-hosted");
    const res = await call(app.base, "POST", "/api/buyer/checkout/session", shop.buyer, {
      items: [
        { variantId: shop.tee.variantId, productId: shop.tee.productId, quantity: 1 },
        { variantId: shop.cap.variantId, productId: shop.cap.productId, quantity: 1 },
      ],
      discountCode: shop.code,
      successUrl: "https://brandthread.test/checkout/success",
      cancelUrl: "https://brandthread.test/checkout/cancel",
      contactEmail: "buyer@test.local",
      contactPhone: "+1 503 555 0100",
      shippingAddress: { ...address, phone: "+1 503 555 0100" },
      clientIdempotencyKey: uid("idem"),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(fake.state.coupons).toHaveLength(1);
    expect(fake.state.coupons[0].amount_off).toBe(1_000 + 550);
    expect(fake.state.coupons[0].name).toContain("Bundle");
    const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripeSessionId, res.body.sessionId));
    expect(row.bundleDiscountCents).toBe(1_000);
    expect(row.discountCodeAmountCents).toBe(550);
  });

  it("the product page endpoint lists only bundles that save something", async () => {
    const shop = await seedShop("bundle-public");
    const listed = await call(app.base, "GET", `/api/bundles/public/product/${shop.cap.productId}`, "");
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({ id: shop.bundle.id, bundlePriceCents: SET, itemsTotalCents: TEE + CAP });
    expect(listed.body[0].items[0].productId).toBe(shop.cap.productId); // viewed product first

    await db.update(productBundles).set({ bundlePriceCents: TEE + CAP }).where(eq(productBundles.id, shop.bundle.id));
    const none = await call(app.base, "GET", `/api/bundles/public/product/${shop.cap.productId}`, "");
    expect(none.body).toEqual([]);
  });
});
