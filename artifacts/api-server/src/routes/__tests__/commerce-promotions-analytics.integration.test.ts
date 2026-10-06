/**
 * Promotions + analytics, both sides, through the whole app (see
 * docs/flows/commerce.md flows 7–8).
 *
 * Breaks this pins:
 *  - a code's usage limit holds when several buyers check out at once, and
 *    an expired checkout gives its use back
 *  - an ended drop can't be bought, and the cart says so before payment
 *  - Notify me subscribers are pushed when the drop goes live, once
 *  - Overview / Revenue / Products / Customers count what /home counts:
 *    paid, not cancelled, net of refunds; the revenue series isn't capped at
 *    10 days and "last month" ends where this month starts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

vi.hoisted(() => {
  process.env.PAYOUT_MODE = "hold";
  process.env.STRIPE_SECRET_KEY = "sk_test_commerce_e2e";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_commerce_e2e";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||= "http://127.0.0.1:9/openai";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||= "test-not-used";
});
const fake = vi.hoisted(() => ({ stripe: null as any, pushes: [] as Array<{ userId: string; payload: any }> }));

vi.mock("stripe", async () => {
  const { createFakeStripe } = await import("../../testUtils/fakeStripe");
  fake.stripe = createFakeStripe();
  return { default: class { constructor() { return fake.stripe.client; } } };
});
vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: (req: any) => ({ userId: req.headers["x-test-user-id"] ?? null }),
  clerkClient: { users: { getUser: async () => null } },
}));
vi.mock("@clerk/shared/keys", () => ({ publishableKeyFromHost: () => "pk_test_commerce" }));
vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return {
    ...actual,
    sendPushToUser: vi.fn(async (userId: string, payload: any) => { fake.pushes.push({ userId, payload }); }),
  };
});
// /analytics/customers is a Pro report; plan gating isn't what's under test.
vi.mock("../../middlewares/requireAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/requireAuth")>();
  return { ...actual, requirePlan: () => (_req: unknown, _res: unknown, next: () => void) => next() };
});

import { db, discountCodes, dropAlertSubscriptions, drops, notificationsFeed, orders, products } from "@workspace/db";
import { startCommerceApp, TEST_ADDRESS, type CommerceApp } from "../../testUtils/commerceApp";
import { runScheduledDropBroadcasts } from "../../jobs/scheduledDropBroadcasts";

let app: CommerceApp;
const dropIds: string[] = [];
const feedFor = (userId: string) => db.select().from(notificationsFeed).where(eq(notificationsFeed.userId, userId));

beforeAll(async () => {
  app = await startCommerceApp("promo", fake);
});
afterAll(async () => {
  if (app) {
    await db.delete(discountCodes).where(eq(discountCodes.sellerId, app.seller)).catch(() => {});
    await app.stop();
    if (dropIds.length) {
      await db.delete(dropAlertSubscriptions).where(inArray(dropAlertSubscriptions.dropId, dropIds)).catch(() => {});
      await db.execute(`DELETE FROM drop_broadcasts WHERE drop_id IN (${dropIds.map((id) => `'${id}'`).join(",")})` as any).catch(() => {});
      await db.delete(drops).where(inArray(drops.id, dropIds)).catch(() => {});
    }
  }
});

/** The full app wraps error bodies as { error: { code, message } } (middlewares/errorHandling.ts). */
const errorCode = (res: { body: any }) => res.body?.error?.code ?? res.body?.code;

function checkoutBody(as: string, items: Array<{ productId: string; variantId: string; quantity: number }>, discountCode?: string) {
  return {
    items,
    successUrl: "https://app.test/s",
    cancelUrl: "https://app.test/c",
    contactEmail: `${as}@test.local`,
    contactPhone: "+1 503 555 0100",
    shippingAddress: TEST_ADDRESS,
    clientIdempotencyKey: `promo-${crypto.randomUUID()}`,
    ...(discountCode ? { discountCode } : {}),
  };
}

describe("discount code usage limits", () => {
  it("holds a one-use code for one buyer at a time, and gives it back when that checkout expires", async () => {
    const { productId, variantIds: [variantId] } = await app.listProduct({ name: "Code Tee", variants: [{ priceCents: 5_000, stock: 10 }] });
    const code = `ONCE${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const created = await app.asSeller("POST", "/api/discount-codes", { code, type: "percentage", value: 20, maxUses: 1 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const second = await app.addUser("buyer");
    const items = [{ productId, variantId, quantity: 1 }];
    const [a, b] = await Promise.all([
      app.asBuyer("POST", "/api/buyer/checkout/session", checkoutBody(app.buyer, items, code)),
      app.call(second, "POST", "/api/buyer/checkout/session", checkoutBody(second, items, code)),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
    const loser = a.status === 400 ? a : b;
    expect(errorCode(loser)).toBe("MAX_USES_REACHED");

    // The holder abandons: Stripe expires their session → the use is free again.
    const winner = a.status === 200 ? a : b;
    const loserAs = a.status === 200 ? second : app.buyer;
    const expired = await app.stripeEvent("checkout.session.expired", {
      id: winner.body.sessionId, object: "checkout.session", status: "expired", metadata: {},
    });
    expect(expired.status).toBe(200);
    const retry = await app.call(loserAs, "POST", "/api/buyer/checkout/session", checkoutBody(loserAs, items, code));
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
  });

  it("the seller sees the redemption once the order is paid", async () => {
    const { productId, variantIds: [variantId] } = await app.listProduct({ name: "Redeem Tee", variants: [{ priceCents: 4_000, stock: 10 }] });
    const code = `PAID${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    await app.asSeller("POST", "/api/discount-codes", { code, type: "fixed", value: 5, maxUses: 5 });
    await app.buyViaHostedCheckout([{ productId, variantId, quantity: 1 }], { discountCode: code });
    const list = await app.asSeller("GET", "/api/discount-codes");
    const row = (Array.isArray(list.body) ? list.body : list.body.codes ?? []).find((c: any) => c.code === code);
    expect(row?.usesCount).toBe(1);
  });
});

describe("drops", () => {
  it("an ended drop can't be bought, and cart validation says so first", async () => {
    const [drop] = await db.insert(drops).values({
      ownerId: app.seller, name: "Ended Drop", type: "pre-made", status: "active",
      releaseAt: new Date(Date.now() - 2 * 86_400_000), endsAt: new Date(Date.now() - 60_000),
    }).returning({ id: drops.id });
    dropIds.push(drop.id);
    const { productId, variantIds: [variantId] } = await app.listProduct({ name: "Ended Drop Tee", variants: [{ priceCents: 3_000, stock: 5 }] });
    await db.update(products).set({ dropId: drop.id }).where(eq(products.id, productId));

    const validate = await app.asBuyer("POST", "/api/buyer/cart/validate", {
      items: [{ id: "r1", productId, variantId, quantity: 1, priceCents: 3_000 }],
    });
    expect(validate.body.isValid).toBe(false);
    expect(validate.body.issues[0].message).toBe("This drop has ended.");

    const session = await app.asBuyer("POST", "/api/buyer/checkout/session", checkoutBody(app.buyer, [{ productId, variantId, quantity: 1 }]));
    expect(session.status).toBe(409);
    expect(errorCode(session)).toBe("DROP_ENDED");
  });

  it("pushes Notify me subscribers when the drop goes live, once, even with no follower broadcast", async () => {
    const created = await app.asSeller("POST", "/api/drops", {
      name: "Launch Drop", type: "pre-made", releaseAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    dropIds.push(created.body.id);
    const activated = await app.asSeller("PATCH", `/api/drops/${created.body.id}`, { status: "active" });
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);

    const subscribe = await app.asBuyer("POST", `/api/public/drops/${created.body.id}/notify`, {});
    expect(subscribe.status).toBe(200);

    // Before launch: nothing.
    await runScheduledDropBroadcasts(new Date());
    expect((await feedFor(app.buyer)).filter((n) => n.type === "drop_live")).toHaveLength(0);

    // At launch: the subscriber hears it — exactly once across worker runs.
    const atLaunch = new Date(Date.now() + 61 * 60_000);
    await runScheduledDropBroadcasts(atLaunch);
    await runScheduledDropBroadcasts(atLaunch);
    const live = (await feedFor(app.buyer)).filter((n) => n.type === "drop_live" && n.targetId === created.body.id);
    expect(live).toHaveLength(1);
    expect(fake.pushes.some((p) => p.userId === app.buyer && p.payload?.title === "Drop is live!")).toBe(true);
    const [sub] = await db.select().from(dropAlertSubscriptions)
      .where(and(eq(dropAlertSubscriptions.dropId, created.body.id), eq(dropAlertSubscriptions.userId, app.buyer)));
    expect(sub.notifiedAt).toBeTruthy();
  });
});

describe("analytics agree with the orders both sides see", () => {
  it("Overview, Revenue, Products and Customers count paid orders net of refunds", async () => {
    const seller = await app.addSeller();
    const { productId, variantIds: [variantId] } = await app.listProduct({
      name: "Analytics Tee", variants: [{ priceCents: 2_000, stock: 50 }], as: seller,
    });
    // Paid, kept: $20
    const kept = await app.buyViaHostedCheckout([{ productId, variantId, quantity: 1 }]);
    // Paid, partly refunded by $5: counts $15
    const partial = await app.buyViaHostedCheckout([{ productId, variantId, quantity: 1 }]);
    await db.update(orders).set({ refundedCents: 500 }).where(eq(orders.id, partial));
    // Paid then cancelled: counts $0
    const cancelled = await app.buyViaHostedCheckout([{ productId, variantId, quantity: 1 }]);
    const cancel = await app.asBuyer("POST", `/api/buyer/orders/${cancelled}/cancel`, {});
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    // Seller-created, never paid: counts $0
    const manual = await app.call(seller, "POST", "/api/orders", { items: [{ variantId, productName: "Analytics Tee", quantity: 1 }] });
    expect(manual.status).toBe(201);
    void kept;
    // These orders belong to `seller`, bought by app.buyer.
    expect((await db.select().from(orders).where(eq(orders.ownerId, seller))).length).toBe(4);

    const expectedNet = 2_000 + 1_500;
    const home = await app.call(seller, "GET", "/api/analytics/home?range=all&tz=0");
    expect(home.body.netCents).toBe(expectedNet);

    const dash = await app.call(seller, "GET", "/api/analytics/dashboard?tz=0");
    expect(dash.status).toBe(200);
    expect(dash.body.revenue.totalCents).toBe(expectedNet);
    expect(dash.body.revenue.todayCents).toBe(expectedNet);
    expect(dash.body.orders.total).toBe(2);

    const revenue = await app.call(seller, "GET", "/api/analytics/revenue?period=last30&tz=0");
    expect(revenue.body.totalCents).toBe(expectedNet);
    expect(revenue.body.orderCount).toBe(2);
    expect(revenue.body.daily.reduce((sum: number, d: any) => sum + d.total_cents, 0)).toBe(expectedNet);

    const productsReport = await app.call(seller, "GET", "/api/analytics/products");
    const row = productsReport.body.find((r: any) => r.productId === productId);
    expect(row).toMatchObject({ unitsSold: 2, orderCount: 2, revenueCents: 4_000 });

    const customersReport = await app.call(seller, "GET", "/api/analytics/customers");
    expect(customersReport.status, JSON.stringify(customersReport.body)).toBe(200);
    const top = customersReport.body.topCustomers?.[0] ?? customersReport.body[0];
    expect(top?.totalCents ?? top?.totalSpentCents).toBe(expectedNet);
  });

  it("the revenue series covers every day of the period and last month stops at this month", async () => {
    const seller = await app.addSeller();
    const now = new Date();
    const values = Array.from({ length: 14 }, (_, i) => ({
      ownerId: seller,
      orderNumber: `AN-${crypto.randomBytes(4).toString("hex")}-${i}`,
      status: "delivered",
      totalCents: 1_000,
      subtotalCents: 1_000,
      paidAt: new Date(now.getTime() - i * 86_400_000),
      createdAt: new Date(now.getTime() - i * 86_400_000),
    }));
    await db.insert(orders).values(values as any);
    const revenue = await app.call(seller, "GET", "/api/analytics/revenue?period=last30&tz=0");
    expect(revenue.body.daily).toHaveLength(14);
    expect(revenue.body.totalCents).toBe(14_000);
    for (const day of revenue.body.daily) expect(day.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const lastMonth = await app.call(seller, "GET", "/api/analytics/revenue?period=lastMonth&tz=0");
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const inLastMonth = values.filter((v) => v.createdAt < monthStart && v.createdAt >= new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))).length;
    expect(lastMonth.body.orderCount).toBe(inLastMonth);
  });
});
