import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, checkoutSessions, products, productVariants, users } from "@workspace/db";
import { eq } from "drizzle-orm";

process.env.SESSION_SECRET ||= "guest-checkout-integration-test-secret";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `guest-checkout-seller-${suffix}`;
const guestEmail = `guest-${suffix}@test.local`;
const fakeStripe = vi.hoisted(() => {
  const sessions = new Map<string, any>();
  const creates: any[] = [];
  return {
    creates,
    stripe: {
      checkout: {
        sessions: {
          create: async (params: any, options: any) => {
            creates.push({ params, options });
            const session = {
              id: `cs_guest_test_${creates.length}`,
              url: `https://checkout.stripe.test/guest/${creates.length}`,
              status: "open",
              payment_status: "unpaid",
              amount_total: 2_500,
            };
            sessions.set(session.id, session);
            return session;
          },
          retrieve: async (id: string) => {
            const session = sessions.get(id);
            if (!session) throw new Error("missing fake session");
            return session;
          },
        },
      },
    },
  };
});

vi.mock("../../lib/stripe", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/stripe")>();
  return { ...real, requireStripe: () => fakeStripe.stripe };
});

let server: Server;
let base = "";
let productId = "";
let variantId = "";

async function post(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}

beforeAll(async () => {
  const [seller] = await db.insert(users).values({
    clerkId: sellerId,
    email: `${sellerId}@test.local`,
    name: "Guest Checkout Seller",
    role: "seller",
    accountType: "seller",
    stripeAccountId: `acct_guest_${suffix}`,
    stripeAccountStatus: "active",
  }).returning();
  const [product] = await db.insert(products).values({
    ownerId: seller.clerkId,
    name: "Guest checkout test product",
    category: "apparel",
    status: "active",
  }).returning();
  productId = product.id;
  const [variant] = await db.insert(productVariants).values({
    productId,
    sku: `guest-checkout-${suffix}`,
    priceCents: 2_500,
    stock: 5,
  }).returning();
  variantId = variant.id;

  const { default: guestCheckoutRouter } = await import("../guest-checkout");
  const app = express();
  app.use(express.json());
  app.use("/api/guest/checkout", guestCheckoutRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(checkoutSessions).where(eq(checkoutSessions.guestEmail, guestEmail));
  await db.delete(products).where(eq(products.id, productId));
  await db.delete(users).where(eq(users.clerkId, sellerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("guest checkout", () => {
  it("returns a reusable opaque token while storing only its hash", async () => {
    const body = {
      items: [{ productId, variantId, quantity: 1 }],
      contactEmail: guestEmail,
      shippingAddress: {
        name: "Guest Buyer",
        street: "123 Test Street",
        city: "Portland",
        state: "OR",
        zip: "97205",
        country: "US",
      },
      successUrl: "https://brandthread.test/success",
      cancelUrl: "https://brandthread.test/cancel",
      clientIdempotencyKey: `guest-idempotency-${suffix}`,
    };

    const first = await post("/api/guest/checkout/session", body);
    expect(first.status).toBe(201);
    expect(first.body.guestAccessToken).toHaveLength(43);

    const [stored] = await db.select().from(checkoutSessions)
      .where(eq(checkoutSessions.stripeSessionId, first.body.sessionId)).limit(1);
    expect(stored.buyerId).toBeNull();
    expect(stored.guestEmail).toBe(guestEmail);
    expect(stored.guestAccessTokenHash).not.toBe(first.body.guestAccessToken);
    expect(stored.guestAccessTokenHash).toHaveLength(64);

    const repeated = await post("/api/guest/checkout/session", body);
    expect(repeated.status).toBe(200);
    expect(repeated.body.sessionId).toBe(first.body.sessionId);
    expect(repeated.body.guestAccessToken).toBe(first.body.guestAccessToken);
    expect(fakeStripe.creates).toHaveLength(1);

    const denied = await post(
      `/api/guest/checkout/session/${first.body.sessionId}/verify`,
      { guestAccessToken: "x".repeat(43) },
    );
    expect(denied.status).toBe(404);

    const verified = await post(
      `/api/guest/checkout/session/${first.body.sessionId}/verify`,
      { guestAccessToken: first.body.guestAccessToken },
    );
    expect(verified.status).toBe(200);
    expect(verified.body.paymentStatus).toBe("unpaid");
    expect(verified.body.amountTotal).toBe(2_500);
    expect(fakeStripe.creates[0].params.customer).toBeUndefined();
    expect(fakeStripe.creates[0].params.payment_intent_data.setup_future_usage).toBeUndefined();
  });
});