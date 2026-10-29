/**
 * Wave-1 audit (slice s02) — routes/buyer.ts:
 *  - POST /checkout/session: rewards points must leave a balance after the
 *    seller's discount code. Both become one Stripe coupon; before the fix a
 *    code + points could add up to more than the order (the coupon is then
 *    clamped by Stripe, but the checkout still records the full points
 *    discount, which the platform tops the seller up for).
 *  - GET /orders/:id with a malformed id is a 400, not a uuid-cast 500.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, checkoutSessions, loyaltyPoints, productVariants, products, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const SUFFIX = crypto.randomBytes(6).toString("hex");
const BUYER_ID = `w1s02-buyer-${SUFFIX}`;
const SELLER_ID = `w1s02-seller-${SUFFIX}`;
const TOKEN = `W1S02LOYAL${SUFFIX}`.toUpperCase();

const fake = vi.hoisted(() => {
  const sessionCreates: any[] = [];
  const couponCreates: any[] = [];
  const discount = { appliedAmountCents: 0 };
  const stripe = {
    checkout: {
      sessions: {
        create: async (params: any) => {
          sessionCreates.push(params);
          return { id: `cs_w1s02_${sessionCreates.length}`, url: "https://checkout.stripe.test/x", status: "open", payment_status: "unpaid", metadata: params.metadata };
        },
        retrieve: async () => { throw Object.assign(new Error("nope"), { statusCode: 404 }); },
        list: async () => ({ data: [], has_more: false }),
      },
    },
    customers: {
      create: async () => ({ id: "cus_w1s02" }),
      update: async (id: string) => ({ id }),
    },
    coupons: {
      create: async (params: any) => { couponCreates.push(params); return { id: `coupon_${couponCreates.length}` }; },
    },
  };
  return { stripe, sessionCreates, couponCreates, discount };
});

vi.mock("../../lib/stripe", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/stripe")>();
  return { ...real, stripe: fake.stripe, requireStripe: () => fake.stripe };
});

vi.mock("../../lib/discounts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/discounts")>();
  return {
    ...real,
    validateDiscountCode: async () => ({
      discount: { id: crypto.randomUUID(), code: "W1S02" },
      appliedAmountCents: fake.discount.appliedAmountCents,
      description: "test",
      freeShipping: false,
    }),
  };
});

// The seller here has no paid plan; plan gating isn't what this file tests.
vi.mock("../../lib/planGate", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/planGate")>();
  return { ...real, productsBeyondSellerPlan: async () => [] };
});

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = BUYER_ID; next(); },
}));

let server: Server;
let base = "";
let productId = "";
let variantId = "";

async function postCheckout(body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/buyer/checkout/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [{ variantId, productId, quantity: 2 }],
      successUrl: "https://brandthread.test/checkout/success",
      cancelUrl: "https://brandthread.test/checkout/cancel",
      contactEmail: "buyer@test.local",
      contactPhone: "+1 503 555 0100",
      shippingAddress: {
        recipientName: "W1 Buyer", street: "1 Main St", city: "Portland", state: "OR",
        postalCode: "97205", country: "US", phone: "+1 503 555 0100",
      },
      ...body,
    }),
  });
  return { status: res.status, body: await res.json() as any };
}

beforeAll(async () => {
  delete process.env.DEFAULT_SHIPPING_CENTS; // standard $5.99
  await db.insert(users).values([
    { clerkId: BUYER_ID, email: `${BUYER_ID}@test.local`, name: "W1 Buyer", accountType: "buyer" },
    {
      clerkId: SELLER_ID, email: `${SELLER_ID}@test.local`, name: "W1 Seller", accountType: "seller",
      stripeAccountId: `acct_w1s02_${SUFFIX}`, stripeAccountStatus: "active",
    },
  ]);
  const [product] = await db.insert(products).values({
    ownerId: SELLER_ID, name: "W1 S02 tee", category: "apparel", status: "active",
  }).returning({ id: products.id });
  productId = product.id;
  const [variant] = await db.insert(productVariants).values({
    productId, sku: `w1s02-${SUFFIX}`, priceCents: 2_500, stock: 10, size: "M", color: "Black",
  }).returning({ id: productVariants.id });
  variantId = variant.id;

  const { default: buyerRouter } = await import("../buyer");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }; next(); });
  app.use("/api/buyer", buyerRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  fake.sessionCreates.length = 0;
  fake.couponCreates.length = 0;
  // 1,000 points = $10.00 off.
  await db.insert(loyaltyPoints).values({ buyerId: BUYER_ID, points: -1_000, source: "redemption", referenceId: TOKEN });
});

afterEach(async () => {
  await db.delete(loyaltyPoints).where(eq(loyaltyPoints.buyerId, BUYER_ID));
  await db.delete(checkoutSessions).where(eq(checkoutSessions.buyerId, BUYER_ID));
});

afterAll(async () => {
  await db.delete(checkoutSessions).where(eq(checkoutSessions.buyerId, BUYER_ID));
  await db.delete(products).where(eq(products.id, productId));
  await db.delete(users).where(eq(users.clerkId, BUYER_ID));
  await db.delete(users).where(eq(users.clerkId, SELLER_ID));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/buyer/checkout/session — points + discount code", () => {
  it("refuses points that would exceed what is left after the discount code", async () => {
    // $50.00 merchandise + $5.99 shipping; the code takes $50.00, leaving $5.99 < $10.00 of points.
    fake.discount.appliedAmountCents = 5_000;
    const res = await postCheckout({ loyaltyToken: TOKEN, discountCode: "W1S02" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LOYALTY_DISCOUNT_TOO_LARGE");
    expect(fake.sessionCreates).toHaveLength(0);
    expect(fake.couponCreates).toHaveLength(0);
    const [row] = await db.select().from(loyaltyPoints).where(eq(loyaltyPoints.buyerId, BUYER_ID));
    expect(row.checkoutSessionId).toBeNull();
  });

  it("still combines points with a code that leaves room for them", async () => {
    fake.discount.appliedAmountCents = 2_000;
    const res = await postCheckout({ loyaltyToken: TOKEN, discountCode: "W1S02" });
    expect(res.status).toBe(200);
    expect(fake.couponCreates).toHaveLength(1);
    expect(fake.couponCreates[0].amount_off).toBe(3_000);
  });
});

describe("GET /api/buyer/orders/:id", () => {
  it("is a 400 for a malformed id", async () => {
    const res = await fetch(`${base}/api/buyer/orders/not-a-uuid`);
    expect(res.status).toBe(400);
  });
});
