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
const BUYER_EMAIL = `${BUYER_ID}@test.local`;
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
  const customerCreates: Array<{ params: any }> = [];
  const customerUpdates: Array<{ id: string; params: any }> = [];

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
    customers: {
      create: async (params: any) => {
        customerCreates.push({ params });
        return { id: `cus_checkout_test_${customerCreates.length}` };
      },
      update: async (id: string, params: any) => {
        customerUpdates.push({ id, params });
        return { id, ...params };
      },
    },
  };

  return {
    stripe: fake,
    sessionCreates,
    customerCreates,
    customerUpdates,
    reset: () => {
      sessions.clear();
      sessionCreates.length = 0;
      customerCreates.length = 0;
      customerUpdates.length = 0;
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
    clerkId: BUYER_ID,
    email: BUYER_EMAIL,
    name: "Checkout Integration Buyer",
    role: "buyer",
    accountType: "buyer",
  });
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
  await db.delete(users).where(eq(users.clerkId, BUYER_ID));
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
    const result = await postCheckout(checkoutBody({
      shippingAddress: {
        recipientName: "Checkout Buyer",
        street: "123 Tax Street",
        line2: "Unit 4",
        city: "Portland",
        state: "OR",
        postalCode: "97205",
        country: "US",
      },
    }));

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      sessionId: "cs_checkout_test_1",
      url: "https://checkout.stripe.test/pay/1",
    });
    expect(fakeStripe.sessionCreates).toHaveLength(1);
    expect(fakeStripe.customerCreates).toHaveLength(1);
    expect(fakeStripe.customerCreates[0].params).toMatchObject({
      email: "buyer@test.local",
      name: "Checkout Integration Buyer",
      shipping: {
        name: "Checkout Buyer",
        address: {
          line1: "123 Tax Street",
          line2: "Unit 4",
          city: "Portland",
          state: "OR",
          postal_code: "97205",
          country: "US",
        },
      },
    });
    expect(fakeStripe.sessionCreates[0].params.customer).toBe("cus_checkout_test_1");
    expect(fakeStripe.sessionCreates[0].params.payment_intent_data.setup_future_usage).toBe("off_session");
    expect(fakeStripe.sessionCreates[0].params.automatic_tax).toMatchObject({
      enabled: true,
      liability: { type: "account", account: SELLER_ACCOUNT_ID },
    });
    expect(fakeStripe.sessionCreates[0].params.shipping_address_collection).toEqual({
      allowed_countries: ["US"],
    });
    expect(fakeStripe.sessionCreates[0].params.line_items[0].price_data.tax_behavior).toBe("exclusive");

    const [savedCheckout] = await db
      .select()
      .from(checkoutSessions)
      .where(eq(checkoutSessions.stripeSessionId, result.body.sessionId))
      .limit(1);

    expect(savedCheckout?.buyerId).toBe(BUYER_ID);
    expect(savedCheckout?.sellerId).toBe(SELLER_ID);
    expect(savedCheckout?.shippingAddress).toMatchObject({
      name: "Checkout Buyer",
      street: "123 Tax Street",
      zip: "97205",
      country: "US",
    });
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

  it("rejects a soft-deleted product before creating a Stripe session", async () => {
    await db.update(products).set({ deletedAt: new Date(), removalKind: "seller_deleted" })
      .where(eq(products.id, productId));
    const result = await postCheckout(checkoutBody());
    expect(result.status).toBe(404);
    expect(fakeStripe.sessionCreates).toHaveLength(0);
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

  it("reuses the buyer customer across separate checkout sessions", async () => {
    const first = await postCheckout(checkoutBody());
    const second = await postCheckout(checkoutBody());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fakeStripe.customerCreates).toHaveLength(1);
    expect(fakeStripe.sessionCreates).toHaveLength(2);
    expect(fakeStripe.sessionCreates[0].params.customer).toBe("cus_checkout_test_1");
    expect(fakeStripe.sessionCreates[1].params.customer).toBe("cus_checkout_test_1");
  });

  it("keeps the checkout contact email on an existing Stripe customer", async () => {
    await db
      .update(users)
      .set({ stripeCustomerId: `cus_existing_${TEST_SUFFIX}` })
      .where(eq(users.clerkId, BUYER_ID));

    const result = await postCheckout(checkoutBody({
      contactEmail: "orders+delivery@test.local",
    }));

    expect(result.status).toBe(200);
    expect(fakeStripe.customerCreates).toHaveLength(0);
    expect(fakeStripe.customerUpdates).toEqual([
      {
        id: `cus_existing_${TEST_SUFFIX}`,
        params: { email: "orders+delivery@test.local" },
      },
    ]);
    expect(fakeStripe.sessionCreates[0].params.customer).toBe(
      `cus_existing_${TEST_SUFFIX}`,
    );
  });
});