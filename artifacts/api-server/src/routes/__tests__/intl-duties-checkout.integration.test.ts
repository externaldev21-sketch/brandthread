/**
 * Intl #109: DDP duties on the hosted Stripe Checkout paths.
 *
 * POST /api/buyer/checkout/session (also the in-app fallback for preorders,
 * loyalty and Thread Cash) and POST /api/guest/checkout/session must, for a
 * DDP zone across a border with DUTIES_AT_CHECKOUT_ENABLED:
 *   - add "Duties & import taxes" as its own line and persist duties_cents, or
 *   - answer 409 DUTIES_UNAVAILABLE when no quote can be had;
 * and with the flag off create exactly the same session as before.
 *
 * The real ZonosDutiesProvider runs against a local fake Zonos endpoint
 * (ZONOS_GRAPHQL_URL) answering the recorded fixture.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, checkoutSessions, productVariants, products, shippingZones, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import fixture from "../../lib/intl/__tests__/fixtures/zonos-landed-cost-only.json";

process.env.SESSION_SECRET ||= "intl-duties-integration-test-secret";

const SUFFIX = crypto.randomBytes(6).toString("hex");
const BUYER_ID = `intl-duties-buyer-${SUFFIX}`;
const SELLER_ID = `intl-duties-seller-${SUFFIX}`;
const GUEST_EMAIL = `intl-duties-guest-${SUFFIX}@test.local`;
const FIXTURE_DUTIES = 1440 + 3048 + 250;

const fakeStripe = vi.hoisted(() => {
  const creates: Array<{ params: any }> = [];
  const sessions = new Map<string, any>();
  return {
    creates,
    stripe: {
      checkout: {
        sessions: {
          create: async (params: any) => {
            creates.push({ params });
            const session = { id: `cs_intl_${creates.length}_${Math.random().toString(36).slice(2)}`, url: "https://checkout.stripe.test/x", status: "open", payment_status: "unpaid", payment_intent: null, metadata: params.metadata ?? {} };
            sessions.set(session.id, session);
            return session;
          },
          retrieve: async (id: string) => sessions.get(id),
        },
      },
      customers: {
        create: async () => ({ id: `cus_intl_${creates.length}` }),
        update: async (id: string, params: any) => ({ id, ...params }),
      },
    },
  };
});

vi.mock("../../lib/stripe", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/stripe")>();
  return { ...real, stripe: fakeStripe.stripe, requireStripe: () => fakeStripe.stripe };
});

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
// These fixtures isolate duties; plan publication eligibility is covered
// by the dedicated plan-gate suites, not an unconfigured fixture subscription.
vi.mock("../../lib/planGate", () => ({
  productsBeyondSellerPlan: async () => [],
  SELLER_PLAN_LIMIT_CODE: "SELLER_PLAN_LIMIT",
  SELLER_PLAN_LIMIT_MESSAGE: "Seller plan limit",
}));

let server: Server;
let zonos: Server;
let base = "";
let zonosMode: "ok" | "down" = "ok";
let zonosCalls = 0;
let productId = "";
let variantId = "";
let zoneId = "";

const GB_ADDRESS = { street: "1 Belgrave Road", city: "London", state: "London", country: "GB", phone: "+44 20 7946 0000" };

function buyerBody() {
  return {
    items: [{ variantId, productId, quantity: 1 }],
    successUrl: "https://brandthread.test/success",
    cancelUrl: "https://brandthread.test/cancel",
    contactEmail: "buyer@test.local",
    contactPhone: "+44 20 7946 0000",
    shippingAddress: { recipientName: "Intl Buyer", postalCode: "SW1V 1QX", ...GB_ADDRESS },
  };
}

function guestBody() {
  return {
    items: [{ productId, variantId, quantity: 1 }],
    contactEmail: GUEST_EMAIL,
    contactPhone: "+44 20 7946 0000",
    shippingAddress: { name: "Intl Guest", zip: "SW1V 1QX", ...GB_ADDRESS },
    successUrl: "https://brandthread.test/success",
    cancelUrl: "https://brandthread.test/cancel",
    clientIdempotencyKey: `intl-guest-${crypto.randomUUID()}`,
  };
}

async function post(path: string, body: unknown, user?: string) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) as any };
}

const lastLineNames = () => fakeStripe.creates.at(-1)!.params.line_items.map((l: any) => l.price_data?.product_data?.name);
const dutiesLine = () => fakeStripe.creates.at(-1)!.params.line_items.find((l: any) => l.price_data?.product_data?.name === "Duties & import taxes");

beforeAll(async () => {
  const fakeZonos = express();
  fakeZonos.use(express.json());
  fakeZonos.post("/graphql", (req, res) => {
    zonosCalls++;
    expect(req.headers.credentialtoken).toBe("test_zonos_key");
    if (zonosMode === "down") return void res.status(503).json({});
    res.json(fixture);
  });
  await new Promise<void>((resolve) => { zonos = fakeZonos.listen(0, "127.0.0.1", () => resolve()); });

  const { default: buyerRouter } = await import("../buyer");
  const { default: guestRouter } = await import("../guest-checkout");
  const app = express();
  app.use(express.json());
  app.use("/api/buyer", buyerRouter);
  app.use("/api/guest/checkout", guestRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(users).values([
    { clerkId: BUYER_ID, email: `${BUYER_ID}@test.local`, name: "Intl Buyer", role: "buyer", accountType: "buyer" },
    { clerkId: SELLER_ID, email: `${SELLER_ID}@test.local`, name: "Intl Seller", role: "seller", accountType: "seller", stripeAccountId: `acct_intl_${SUFFIX}`, stripeAccountStatus: "active", sellerShipFromCountry: "US" },
  ]);
  const [product] = await db.insert(products).values({ ownerId: SELLER_ID, name: "Wool jacket", category: "apparel", status: "active" }).returning();
  productId = product.id;
  const [variant] = await db.insert(productVariants).values({ productId, sku: `intl-${SUFFIX}`, priceCents: 12_000, stock: 50 }).returning();
  variantId = variant.id;
  const [zone] = await db.insert(shippingZones).values({
    id: crypto.randomUUID(), sellerId: SELLER_ID, name: "International", zoneType: "rest_of_world", countries: [],
    pricingModel: "flat", flatRateCents: 1_800, processingDays: 3, shipsInternationally: true, dutiesHandling: "ddp", sortOrder: 0,
  }).returning();
  zoneId = zone.id;
});

beforeEach(() => {
  fakeStripe.creates.length = 0;
  zonosMode = "ok";
  zonosCalls = 0;
  process.env.DUTIES_AT_CHECKOUT_ENABLED = "true";
  process.env.ZONOS_API_KEY = "test_zonos_key";
  process.env.ZONOS_GRAPHQL_URL = `http://127.0.0.1:${(zonos.address() as AddressInfo).port}/graphql`;
});

afterEach(async () => {
  delete process.env.DUTIES_AT_CHECKOUT_ENABLED;
  delete process.env.ZONOS_API_KEY;
  delete process.env.ZONOS_GRAPHQL_URL;
  await db.update(shippingZones).set({ dutiesHandling: "ddp" }).where(eq(shippingZones.id, zoneId));
});

afterAll(async () => {
  await db.delete(checkoutSessions).where(eq(checkoutSessions.sellerId, SELLER_ID));
  await db.delete(shippingZones).where(eq(shippingZones.sellerId, SELLER_ID));
  await db.delete(products).where(eq(products.ownerId, SELLER_ID));
  await db.delete(users).where(eq(users.clerkId, SELLER_ID));
  await db.delete(users).where(eq(users.clerkId, BUYER_ID));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => zonos.close(() => resolve()));
});

async function rowFor(sessionId: string) {
  const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripeSessionId, sessionId)).limit(1);
  return row;
}

describe.each([
  ["hosted buyer checkout (and its preorder / loyalty / Thread Cash fallbacks)", "/api/buyer/checkout/session", buyerBody, BUYER_ID],
  ["guest checkout", "/api/guest/checkout/session", guestBody, undefined],
] as const)("%s", (_label, path, body, user) => {
  it("flag on + DDP: charges duties as their own line and stores them on the checkout row", async () => {
    const result = await post(path, body(), user);
    expect([200, 201]).toContain(result.status);
    expect(zonosCalls).toBe(1);
    const line = dutiesLine();
    expect(line).toMatchObject({
      quantity: 1,
      price_data: { currency: "usd", unit_amount: FIXTURE_DUTIES, tax_behavior: "exclusive", product_data: { tax_code: "txcd_00000000" } },
    });
    const row = await rowFor(result.body.sessionId);
    expect(row.dutiesCents).toBe(FIXTURE_DUTIES);
    expect(row.dutiesQuoteId).toBe("landed_cost_0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6");
  });

  it("flag on + DDP + provider down: refuses with 409 DUTIES_UNAVAILABLE and never opens a Stripe session", async () => {
    zonosMode = "down";
    const result = await post(path, body(), user);
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("DUTIES_UNAVAILABLE");
    expect(fakeStripe.creates).toHaveLength(0);
  });

  it("flag on + DAP zone: no quote, no duties line", async () => {
    await db.update(shippingZones).set({ dutiesHandling: "dap" }).where(eq(shippingZones.id, zoneId));
    const result = await post(path, body(), user);
    expect([200, 201]).toContain(result.status);
    expect(zonosCalls).toBe(0);
    expect(dutiesLine()).toBeUndefined();
  });

  it("flag off: same session as before (no quote, no duties line, duties_cents 0)", async () => {
    delete process.env.DUTIES_AT_CHECKOUT_ENABLED;
    const result = await post(path, body(), user);
    expect([200, 201]).toContain(result.status);
    expect(zonosCalls).toBe(0);
    expect(lastLineNames()).not.toContain("Duties & import taxes");
    expect(lastLineNames()).toHaveLength(2); // the jacket + "Shipping (International)"
    expect((await rowFor(result.body.sessionId)).dutiesCents).toBe(0);
  });
});
