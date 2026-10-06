/**
 * END-TO-END COMMERCE LIFECYCLE — buyer <-> seller, both sides, one order.
 *
 * Runs the WHOLE Express app (src/app.ts: every router, every middleware)
 * against the real Postgres test database with two real `users` rows: one
 * seller, one buyer. Only the external boundaries are faked:
 *   - Clerk: `getAuth` reads the `x-test-user-id` header.
 *   - Stripe: the SDK is replaced by testUtils/fakeStripe (records calls);
 *     webhooks are posted to the real /api/webhooks/stripe route.
 *   - Push: sendPushToUser is recorded instead of hitting Expo.
 *
 * Each step asserts what the OTHER side sees through its own real route —
 * the same calls the mobile screens make. See docs/flows/commerce.md for
 * the flow map this test walks.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, or, sql } from "drizzle-orm";

const env = vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_commerce_lifecycle";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_commerce_lifecycle";
  // Imported (never called) by AI routers that the full app mounts.
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||= "http://127.0.0.1:9/openai";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||= "test-not-used";
  return {};
});
void env;

const fake = vi.hoisted(() => ({ stripe: null as any, pushes: [] as Array<{ userId: string; payload: any }> }));

vi.mock("stripe", async () => {
  const { createFakeStripe } = await import("../../testUtils/fakeStripe");
  fake.stripe = createFakeStripe();
  return {
    default: class FakeStripeSdk {
      constructor() {
        return fake.stripe.client;
      }
    },
  };
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
    sendPushToUser: vi.fn(async (userId: string, payload: any) => {
      fake.pushes.push({ userId, payload });
    }),
  };
});

import {
  db, users, products, productVariants, orders, orderItems, checkoutSessions, notificationsFeed,
} from "@workspace/db";

const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const SELLER = `e2e-commerce-seller-${suffix}`;
const BUYER = `e2e-commerce-buyer-${suffix}`;
const SELLER_ACCOUNT = `acct_e2e_${suffix.replace(/-/g, "")}`;

let server: Server;
let base = "";

type Res = { status: number; body: any };
async function call(as: string | null, method: string, path: string, body?: unknown): Promise<Res> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(as ? { "x-test-user-id": as } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed };
}
const asSeller = (m: string, p: string, b?: unknown) => call(SELLER, m, p, b);
const asBuyer = (m: string, p: string, b?: unknown) => call(BUYER, m, p, b);

let eventSeq = 0;
async function stripeEvent(type: string, object: any): Promise<Res> {
  eventSeq += 1;
  const event = {
    id: `evt_e2e_${suffix}_${eventSeq}`,
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  };
  const res = await fetch(`${base}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=fake" },
    body: JSON.stringify(event),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// Shared state walked through the lifecycle.
const ctx = {
  productId: "",
  variantM: "",
  variantL: "",
  stripeSessionId: "",
  checkoutRef: "",
  orderId: "",
};

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: SELLER, email: `${SELLER}@test.local`, name: "Lifecycle Seller", displayName: "Lifecycle Studio",
      role: "seller", accountType: "seller", stripeAccountId: SELLER_ACCOUNT, stripeAccountStatus: "active",
    } as any,
    { clerkId: BUYER, email: `${BUYER}@test.local`, name: "Lifecycle Buyer", role: "buyer", accountType: "buyer" } as any,
  ]);
  const { default: app } = await import("../../app");
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  const ids = [SELLER, BUYER];
  const orderRows = await db.select({ id: orders.id }).from(orders)
    .where(or(inArray(orders.ownerId, ids), inArray(orders.buyerId, ids)));
  const orderIds = orderRows.map((o) => o.id);
  if (orderIds.length) {
    await db.execute(sql`DELETE FROM ledger_entries WHERE order_id = ANY(${orderIds}::uuid[])`).catch(() => {});
    await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds)).catch(() => {});
    await db.delete(orders).where(inArray(orders.id, orderIds)).catch(() => {});
  }
  await db.delete(checkoutSessions).where(or(inArray(checkoutSessions.buyerId, ids), inArray(checkoutSessions.sellerId, ids))).catch(() => {});
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, ids)).catch(() => {});
  await db.execute(sql`DELETE FROM stripe_webhook_events WHERE event_id LIKE ${`evt_e2e_${suffix}_%`}`).catch(() => {});
  if (ctx.productId) {
    await db.delete(productVariants).where(eq(productVariants.productId, ctx.productId)).catch(() => {});
    await db.delete(products).where(eq(products.id, ctx.productId)).catch(() => {});
  }
  await db.delete(users).where(inArray(users.clerkId, ids)).catch(() => {});
});

describe("commerce lifecycle: list → buy → seller sees it", () => {
  it("seller lists a product with two sizes; buyer sees it publicly with live stock", async () => {
    const created = await asSeller("POST", "/api/products", {
      name: "Lifecycle Heavyweight Tee",
      description: "Boxy fit",
      status: "active",
      variants: [
        { sku: `LT-M-${suffix}`, size: "M", priceCents: 4_000, stock: 3, lowStockThreshold: 2 },
        { sku: `LT-L-${suffix}`, size: "L", priceCents: 4_000, stock: 1, lowStockThreshold: 0 },
      ],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    ctx.productId = created.body.id;

    const pub = await call(null, "GET", `/api/public/products/${ctx.productId}`);
    expect(pub.status).toBe(200);
    expect(pub.body.variants).toHaveLength(2);
    ctx.variantM = pub.body.variants.find((v: any) => v.size === "M").id;
    ctx.variantL = pub.body.variants.find((v: any) => v.size === "L").id;
    expect(pub.body.claimedUnits).toBe(0);
  });

  it("buyer validates the cart and starts checkout; server prices it, not the client", async () => {
    const validate = await asBuyer("POST", "/api/buyer/cart/validate", {
      items: [{ id: "row-1", productId: ctx.productId, variantId: ctx.variantM, quantity: 2, price: 40 }],
    });
    expect(validate.status, JSON.stringify(validate.body)).toBe(200);
    expect(validate.body.isValid).toBe(true);

    const session = await asBuyer("POST", "/api/buyer/checkout/session", {
      items: [{ productId: ctx.productId, variantId: ctx.variantM, quantity: 2, priceCents: 1 }],
      successUrl: "https://app.test/success",
      cancelUrl: "https://app.test/cancel",
      contactEmail: `${BUYER}@test.local`,
      contactPhone: "+1 503 555 0100",
      shippingAddress: { recipientName: "Lifecycle Buyer", street: "1 Main St", city: "Portland", state: "OR", postalCode: "97209", country: "US" },
      clientIdempotencyKey: `idem-${suffix}`,
    });
    expect(session.status, JSON.stringify(session.body)).toBe(200);
    ctx.stripeSessionId = session.body.sessionId;
    const create = fake.stripe.callsTo("checkout.sessions.create").at(-1);
    expect(create.args[0].line_items[0].price_data.unit_amount).toBe(4_000);
    expect(create.args[0].payment_intent_data.transfer_data.destination).toBe(SELLER_ACCOUNT);
    ctx.checkoutRef = create.args[0].metadata.csRef;
    expect(ctx.checkoutRef).toBeTruthy();
  });

  it("Stripe confirms payment → order exists for both sides, stock decremented, seller alerted", async () => {
    const amount = 8_000;
    const paid = await stripeEvent("checkout.session.completed", {
      id: ctx.stripeSessionId,
      object: "checkout.session",
      payment_status: "paid",
      payment_intent: `pi_e2e_${suffix}`,
      amount_total: amount,
      total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
      metadata: { csRef: ctx.checkoutRef },
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);

    // Buyer side
    const buyerOrders = await asBuyer("GET", "/api/buyer/orders");
    expect(buyerOrders.status).toBe(200);
    expect(buyerOrders.body).toHaveLength(1);
    ctx.orderId = buyerOrders.body[0].id;

    // Seller side: Orders tab
    const sellerOrders = await asSeller("GET", "/api/orders");
    expect(sellerOrders.status).toBe(200);
    const sellerView = sellerOrders.body.find((o: any) => o.id === ctx.orderId);
    expect(sellerView).toBeTruthy();
    expect(sellerView.paidAt).toBeTruthy();
    expect(sellerView.totalCents).toBe(amount);

    // Seller side: order detail
    const detail = await asSeller("GET", `/api/orders/${ctx.orderId}`);
    expect(detail.status).toBe(200);

    // Inventory decremented exactly once, visible to buyer and seller
    const pub = await call(null, "GET", `/api/public/products/${ctx.productId}`);
    expect(pub.body.variants.find((v: any) => v.id === ctx.variantM).stock).toBe(1);
    expect(pub.body.claimedUnits).toBe(2);
    const inv = await asSeller("GET", "/api/inventory");
    expect(inv.status).toBe(200);
    const invRows = Array.isArray(inv.body) ? inv.body : inv.body.items ?? inv.body.variants ?? [];
    const invM = invRows.find((r: any) => (r.variantId ?? r.id) === ctx.variantM);
    expect(invM?.stock).toBe(1);

    // Seller alerted: feed + push; buyer got a confirmation push
    const feed = await db.select().from(notificationsFeed).where(eq(notificationsFeed.userId, SELLER));
    expect(feed.map((n) => n.type)).toContain("new_order_received");
    expect(feed.map((n) => n.type)).toContain("low_stock");
    expect(fake.pushes.some((p) => p.userId === SELLER)).toBe(true);
    expect(fake.pushes.some((p) => p.userId === BUYER)).toBe(true);
  });

  it("seller dashboard numbers include the paid order today", async () => {
    const home = await asSeller("GET", "/api/analytics/home?range=today&tz=0");
    expect(home.status, JSON.stringify(home.body)).toBe(200);
    const text = JSON.stringify(home.body);
    expect(text).toContain("8000");
  });
});
