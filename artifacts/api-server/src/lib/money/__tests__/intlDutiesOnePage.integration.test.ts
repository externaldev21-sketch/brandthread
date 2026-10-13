/**
 * Intl #109 on the one-page (PaymentIntent) checkout: a DDP zone across a
 * border adds Zonos duties to the group total and the intent amount, the
 * webhook stores them on the order, and the seller's transfer includes them
 * (pass-through). Flag off: identical to before. Provider down: 409.
 */
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { db, checkoutSessions, orders, shippingZones } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { handleCartPaymentSucceeded } from "../../../routes/webhooks";
import checkoutIntentRouter from "../../../routes/checkout-intent";
import { call, expectLedgerBalanced, seedBuyer, seedProduct, seedSeller, startApp, uid } from "./moneyHarness";
import fixture from "../../intl/__tests__/fixtures/zonos-landed-cost-only.json";

const FIXTURE_DUTIES = 1440 + 3048 + 250;
let app: Awaited<ReturnType<typeof startApp>>;
let zonos: Server;
let zonosMode: "ok" | "down" = "ok";
let zonosCalls = 0;

beforeAll(async () => {
  const fakeZonos = express();
  fakeZonos.use(express.json());
  fakeZonos.post("/graphql", (_req, res) => {
    zonosCalls++;
    if (zonosMode === "down") return void res.status(503).json({});
    res.json(fixture);
  });
  await new Promise<void>((resolve) => { zonos = fakeZonos.listen(0, "127.0.0.1", () => resolve()); });
  app = await startApp((server) => {
    server.use("/api/buyer/checkout/payment-intent", checkoutIntentRouter);
    server.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: String(err?.stack ?? err) }));
  });
});
afterAll(async () => {
  await app.close();
  await new Promise<void>((resolve) => zonos.close(() => resolve()));
  await expectLedgerBalanced();
});
beforeEach(() => {
  fake.reset();
  zonosMode = "ok";
  zonosCalls = 0;
  process.env.DUTIES_AT_CHECKOUT_ENABLED = "true";
  process.env.ZONOS_API_KEY = "test_zonos_key";
  process.env.ZONOS_GRAPHQL_URL = `http://127.0.0.1:${(zonos.address() as AddressInfo).port}/graphql`;
});
afterEach(() => {
  delete process.env.DUTIES_AT_CHECKOUT_ENABLED;
  delete process.env.ZONOS_API_KEY;
  delete process.env.ZONOS_GRAPHQL_URL;
});

const LONDON = { recipientName: "Intl Buyer", street: "1 Belgrave Road", city: "London", state: "London", postalCode: "SW1V 1QX", country: "GB" };

async function seedDdpCart(tag: string, dutiesHandling: "ddp" | "dap" = "ddp") {
  const seller = await seedSeller(tag);
  const buyer = await seedBuyer(tag);
  const product = await seedProduct(seller, { priceCents: 12_000, stock: 5 });
  await db.insert(shippingZones).values({
    id: crypto.randomUUID(), sellerId: seller, name: "International", zoneType: "rest_of_world", countries: [],
    pricingModel: "flat", flatRateCents: 1_800, processingDays: 3, shipsInternationally: true, dutiesHandling, sortOrder: 0,
  });
  const groups = [{ items: [{ variantId: product.variantId, productId: product.productId, quantity: 1 }] }];
  return { seller, buyer, groups };
}

const payBody = (groups: unknown) => ({
  groups, contactEmail: "buyer@test.local", contactPhone: "+44 20 7946 0000", shippingAddress: LONDON, clientIdempotencyKey: uid("pay"),
});

describe("one-page checkout: DDP duties", () => {
  it("flag on + DDP: duties go into the group, the intent amount, the order and the seller's transfer", async () => {
    const cart = await seedDdpCart("ddp-on");
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, payBody(cart.groups));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(zonosCalls).toBe(1);
    const [group] = res.body.groups;
    expect(group.dutiesCents).toBe(FIXTURE_DUTIES);
    // subtotal + shipping − discount + tax + duties
    expect(group.totalCents).toBe(12_000 + 1_800 - 0 + group.taxCents + FIXTURE_DUTIES);
    expect(fake.state.paymentIntentCreates[0].params.amount).toBe(group.totalCents);

    const intent = fake.state.paymentIntents.get(res.body.paymentIntentId);
    intent.status = "succeeded";
    intent.amount_received = intent.amount;
    intent.latest_charge = `ch_${intent.id}`;
    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date());
    const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripePaymentIntentId, intent.id));
    expect(row.dutiesCents).toBe(FIXTURE_DUTIES);
    const [order] = await db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, row.stripeSessionId!));
    expect(order.dutiesCents).toBe(FIXTURE_DUTIES);
    expect(order.totalCents).toBe(group.totalCents);
    expect(order.discountAmountCents).toBe(0); // duties are not mistaken for a negative discount
    // Pass-through: the seller's transfer is gross − platform fee − processing, duties included.
    const transfer = fake.state.transfers.find((t: any) => t.transfer_group === order.id);
    expect(transfer.amount).toBe(order.sellerNetCents);
    expect(order.sellerNetCents).toBeGreaterThan(order.totalCents - FIXTURE_DUTIES - order.platformFeeCents - 1_000);
    await expectLedgerBalanced();
  });

  it("flag on + DDP + provider down: 409 DUTIES_UNAVAILABLE, no intent", async () => {
    zonosMode = "down";
    const cart = await seedDdpCart("ddp-down");
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, payBody(cart.groups));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DUTIES_UNAVAILABLE");
    expect(fake.state.paymentIntentCreates).toHaveLength(0);
  });

  it("flag on + DAP: no quote, no duties", async () => {
    const cart = await seedDdpCart("dap", "dap");
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, payBody(cart.groups));
    expect(res.status).toBe(200);
    expect(zonosCalls).toBe(0);
    expect(res.body.groups[0]).not.toHaveProperty("dutiesCents");
  });

  it("flag off: unchanged (no quote, no dutiesCents field, total without duties)", async () => {
    delete process.env.DUTIES_AT_CHECKOUT_ENABLED;
    const cart = await seedDdpCart("ddp-off");
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, payBody(cart.groups));
    expect(res.status).toBe(200);
    expect(zonosCalls).toBe(0);
    const [group] = res.body.groups;
    expect(group).not.toHaveProperty("dutiesCents");
    expect(group.totalCents).toBe(12_000 + 1_800 + group.taxCents);
    const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripePaymentIntentId, res.body.paymentIntentId));
    expect(row.dutiesCents).toBe(0);
  });
});
