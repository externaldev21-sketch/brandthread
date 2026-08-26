/**
 * Integration tests for POST /api/buyer/checkout/session.
 *
 * These tests use the real development Postgres database for the seller,
 * product, variant, and checkout-session rows. Stripe is replaced with an
 * in-memory fake so no external payment calls are made.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, checkoutSessions, productVariants, products, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const TEST_SUFFIX = crypto.randomBytes(6).toString("hex");
const BUYER_ID = `checkout-session-test-buyer-${TEST_SUFFIX}`;
const SELLER_ID = `checkout-session-test-seller-${TEST_SUFFIX}`;
const SELLER_EMAIL = `${SELLER_ID}@test.local`;
const SELLER_ACCOUNT_ID = `acct_checkout_test_${TEST_SUFFIX}`;

type FakeSession = {
  id: string;
  url: string;
  status: "open";
  payment_status: "unpaid";
  payment_intent: null;
  metadata: Record<string, string>;
};

const fakeStripe = vi.hoisted(() => {
  const sessions = new Map<string, FakeSession>();
  const sessionCreates: Array<{ params: any; options: any }> = [];

  const fake = {
    checkout: {
      sessions: {
        create: async (params: any, options: any = {}) => {
          sessionCreates.push({ params, options });
          const session: FakeSession = {
            id: `cs_checkout_test_${sessionCreates.length}`,
            url: `https://checkout.stripe.test/pay/${sessionCreates.length}`,
            status: "open",
            payment_status: "unpaid",
            payment_intent: null,
            metadata: params.metadata ?? {},
          };
          sessions.set(session.id, session);
          return session;
        },
        retrieve: async (id: string) => {
          const session = sessions.get(id);
          if (!session) {
            throw Object.assign(new Error("No such checkout session"), { statusCode: 404 });
          }
          return session;
        },
      },
    },
  };

  return {
    stripe: fake,
    sessionCreates,
    reset: () => {
      sessions.clear();
      sessionCreates.length = 0;
    },
  };
});

vi.mock("../../lib/stripe", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/stripe")>();
  return {
    ...real,
    stripe: fakeStripe.stripe,
    requireStripe: () => fakeStripe.stripe,
  };
});

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId =
      req.headers["x-test-user"] ?? (globalThis as any).__checkoutSessionTestBuyerId;
    next();
  },
}));

let server: Server;
let base = "";
let productId = "";
let variantId = "";

async function postCheckout(body: unknown, user = BUYER_ID) {
  const response = await fetch(`${base}/api/buyer/checkout/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-user": user,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let responseBody: any;
  try {
    responseBody = JSON.parse(text);
  } catch {
    responseBody = text;
  }
  return { status: response.status, body: responseBody };
}

function checkoutBody(overrides: Record<string, unknown> = {}) {
  return {
    items: [{ variantId, productId, quantity: 2 }],
    successUrl: "https://brandthread.test/checkout/success",
    cancelUrl: "https://brandthread.test/checkout/cancel",
    contactEmail: "buyer@test.local",
    ...overrides,
  };
}

async function seedProduct(options: { priceCents?: number; stock?: number } = {}) {
  const [product] = await db
    .insert(products)
    .values({
      ownerId: SELLER_ID,
      name: "Checkout integration test product",
      category: "apparel",
      status: "active",
    })
    .returning({ id: products.id });
  productId = product.id;

  const [variant] = await db
    .insert(productVariants)
    .values({
      productId,
      sku: `checkout-test-sku-${TEST_SUFFIX}`,
      priceCents: options.priceCents ?? 2_500,
      stock: options.stock ?? 10,
      size: "M",
      color: "Black",
    })
    .returning({ id: productVariants.id });
  variantId = variant.id;
}

beforeAll(async () => {
  (globalThis as any).__checkoutSessionTestBuyerId = BUYER_ID;

  const { default: buyerRouter } = await import("../buyer");
  const app = express();
  app.use(express.json());
  app.use("/api/buyer", buyerRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  fakeStripe.reset();
  await db.insert(users).values({
    clerkId: SELLER_ID,
    email: SELLER_EMAIL,
    name: "Checkout Integration Seller",
    role: "seller",
    accountType: "seller",
    stripeAccountId: SELLER_ACCOUNT_ID,
    stripeAccountStatus: "active",
  });
  await seedProduct();
});

afterEach(async () => {
  // Remove all rows created by this test before the next test seeds its rows.
  await db.delete(checkoutSessions).where(eq(checkoutSessions.buyerId, BUYER_ID));
  if (productId) {
    await db.delete(products).where(eq(products.id, productId));
  }
  productId = "";
  variantId = "";

  await db.delete(users).where(eq(users.clerkId, SELLER_ID));
});

afterAll(async () => {
  await db.delete(checkoutSessions).where(eq(checkoutSessions.buyerId, BUYER_ID));
  await db.delete(products).where(eq(products.ownerId, SELLER_ID));
  await db.delete(users).where(eq(users.clerkId, SELLER_ID));
  delete (globalThis as any).__checkoutSessionTestBuyerId;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/buyer/checkout/session", () => {
  it("creates a session for a valid cart and persists the server-side cart", async () => {
    const result = await postCheckout(checkoutBody());

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      sessionId: "cs_checkout_test_1",
      url: "https://checkout.stripe.test/pay/1",
    });
    expect(fakeStripe.sessionCreates).toHaveLength(1);

    const [savedCheckout] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.stripeSessionId, result.body.sessionId))
      .limit(1);

    expect(savedCheckout?.buyerId).toBe(BUYER_ID);
    expect(savedCheckout?.sellerId).toBe(SELLER_ID);
    expect(savedCheckout?.items).toEqual([
      {
        variantId,
        productName: "Checkout integration test product",
        variantLabel: "M / Black",
        quantity: 2,
        priceCents: 2_500,
      },
    ]);
  });

  it("rejects duplicate variantIds with 400 before contacting Stripe", async () => {
    const result = await postCheckout(
      checkoutBody({
        items: [
          { variantId, productId, quantity: 1 },
          { variantId, productId, quantity: 1 },
        ],
      }),
    );

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/duplicate variantId/i);
    expect(fakeStripe.sessionCreates).toHaveLength(0);
  });

  it("rejects a cart quantity greater than available stock with 400", async () => {
    await db
      .update(productVariants)
      .set({ stock: 1 })
      .where(eq(productVariants.id, variantId));

    const result = await postCheckout(checkoutBody());

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/insufficient stock/i);
    expect(fakeStripe.sessionCreates).toHaveLength(0);
  });

  it("rejects checkout when the seller has no Connect account", async () => {
    await db
      .update(users)
      .set({ stripeAccountId: null, stripeAccountStatus: null })
      .where(eq(users.clerkId, SELLER_ID));

    const result = await postCheckout(checkoutBody());

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/payment account/i);
    expect(fakeStripe.sessionCreates).toHaveLength(0);
  });

  it("sets the application fee to 5% of the server-resolved subtotal", async () => {
    const result = await postCheckout(checkoutBody());

    expect(result.status).toBe(200);
    const createCall = fakeStripe.sessionCreates[0];
    expect(createCall.params.payment_intent_data.application_fee_amount).toBe(250);
    expect(createCall.params.payment_intent_data.transfer_data.destination).toBe(
      SELLER_ACCOUNT_ID,
    );
  });

  it("returns the same Stripe session when the idempotency key is retried", async () => {
    const idempotencyKey = `checkout-attempt-${TEST_SUFFIX}`;
    const first = await postCheckout(checkoutBody({ clientIdempotencyKey: idempotencyKey }));
    const second = await postCheckout(checkoutBody({ clientIdempotencyKey: idempotencyKey }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(fakeStripe.sessionCreates).toHaveLength(1);
    expect(fakeStripe.sessionCreates[0].options).toEqual({
      idempotencyKey: `cs_${idempotencyKey}`,
    });

    const savedCheckouts = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.clientIdempotencyKey, idempotencyKey));
    expect(savedCheckouts).toHaveLength(1);
  });
});