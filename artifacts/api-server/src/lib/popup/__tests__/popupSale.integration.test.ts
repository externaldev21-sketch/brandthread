/**
 * Pop-up mode (Tap to Pay via Stripe Terminal), against real Postgres with the
 * in-memory Stripe:
 *  - flag off (or no Stripe key): every money route is 503 TERMINAL_NOT_CONFIGURED;
 *  - team permission: a role without "orders" is refused;
 *  - pricing comes from the database (a client price is ignored), another
 *    seller's product is refused, stock is checked and reserved;
 *  - the PaymentIntent is card_present on the platform (separate charges and
 *    transfers, same as the online one-page checkout);
 *  - payment_intent.succeeded, delivered twice through the real signed
 *    webhook route, makes exactly one 'popup' order, decrements stock once,
 *    and the ledger balances; cancel gives the stock back;
 *  - Terminal Location and connection token use the seller's saved location.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const terminal = vi.hoisted(() => ({
  locations: [] as Array<{ params: any; options: any; id: string }>,
  tokens: [] as Array<{ params: any }>,
}));

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("../../money/__tests__/fakeStripe");
  const stripe = fake.stripe as any;
  stripe.terminal = {
    locations: {
      create: async (params: any, options: any = {}) => {
        const id = `tml_${terminal.locations.length + 1}`;
        terminal.locations.push({ params, options, id });
        return { id, object: "terminal.location", ...params };
      },
    },
    connectionTokens: {
      create: async (params: any) => {
        terminal.tokens.push({ params });
        return { object: "terminal.connection_token", secret: `pst_test_${terminal.tokens.length}`, location: params.location };
      },
    },
  };
  return { ...actual, stripe, requireStripe: () => stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", () => ({
  normalizePushEventCategory: () => "orders",
  sendPushToUser: async () => {},
  stableNotificationId: (...parts: string[]) => parts.join(":"),
}));
vi.mock("../../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
}));
vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
// Team roles: the real permission table, with the caller's role from a header.
vi.mock("../../../middlewares/requireRole", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../middlewares/requireRole")>();
  return {
    ...actual,
    teamContext: () => (_req: any, _res: any, next: () => void) => next(),
    requirePermission: (permission: any) => (req: any, res: any, next: () => void) => {
      const role = (req.headers["x-test-role"] as string | undefined) ?? "owner";
      if (role === "owner" || actual.hasPermission(role as any, permission)) return next();
      res.status(403).json({ error: "Insufficient permission", code: "PERMISSION_REQUIRED" });
    },
  };
});

import { db, checkoutSessions, orders, orderItems, productVariants, sellerLocations } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { fake } from "../../money/__tests__/fakeStripe";
import {
  call, expectLedgerBalanced, orderLedger, seedProduct, seedSeller, startApp, uid,
} from "../../money/__tests__/moneyHarness";
import terminalRouter from "../../../routes/seller-terminal";
import webhooksRouter from "../../../routes/webhooks";
import { finalizePopupSale, pricePopupCart, PopupSaleError, terminalEnabled } from "../popupSale";
import { releaseStockReservation } from "../../money/stockReservation";

let app: Awaited<ReturnType<typeof startApp>>;
const originalKey = process.env.STRIPE_SECRET_KEY;
const originalFlag = process.env.STRIPE_TERMINAL_ENABLED;
const BASE = "/api/seller/terminal";

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_for_money_tests";
  process.env.STRIPE_TERMINAL_ENABLED = "1";
  app = await startApp((server) => {
    server.use("/api/webhooks", webhooksRouter);
    server.use(BASE, terminalRouter);
    server.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: String(err?.stack ?? err) });
    });
  });
});
afterAll(async () => {
  process.env.STRIPE_SECRET_KEY = originalKey;
  if (originalFlag === undefined) delete process.env.STRIPE_TERMINAL_ENABLED;
  else process.env.STRIPE_TERMINAL_ENABLED = originalFlag;
  await app?.close();
  await expectLedgerBalanced();
});
beforeEach(() => {
  fake.reset();
  terminal.locations.length = 0;
  terminal.tokens.length = 0;
  process.env.STRIPE_TERMINAL_ENABLED = "1";
});

async function stockOf(variantId: string): Promise<number> {
  const [row] = await db.select({ stock: productVariants.stock }).from(productVariants)
    .where(eq(productVariants.id, variantId)).limit(1);
  return row.stock;
}

async function callAs(method: string, path: string, user: string, body?: unknown, role?: string) {
  const response = await fetch(`${app.base}${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": user, ...(role ? { "x-test-role": role } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function deliverWebhook(type: string, object: Record<string, unknown>, id = `evt_${uid("pop").replace(/-/g, "_")}`) {
  const { payload, header } = fake.signedEvent({
    id, object: "event", type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object },
  });
  const response = await fetch(`${app.base}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body: payload,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Stripe reports the tapped card paid. */
function succeeded(intentId: string) {
  const intent = fake.state.paymentIntents.get(intentId);
  intent.status = "succeeded";
  intent.amount_received = intent.amount;
  intent.latest_charge = `ch_${intentId}`;
  return intent;
}

function sale(items: Array<{ productId: string; variantId: string; quantity: number }>, extra: Record<string, unknown> = {}) {
  return { items, clientIdempotencyKey: uid("popkey"), ...extra };
}

describe("feature flag", () => {
  it("is off without STRIPE_TERMINAL_ENABLED=1 or a Stripe key", () => {
    expect(terminalEnabled({ STRIPE_SECRET_KEY: "sk_test" } as any)).toBe(false);
    expect(terminalEnabled({ STRIPE_TERMINAL_ENABLED: "1" } as any)).toBe(false);
    expect(terminalEnabled({ STRIPE_TERMINAL_ENABLED: "1", STRIPE_SECRET_KEY: "sk_test" } as any)).toBe(true);
  });

  it("answers 503 TERMINAL_NOT_CONFIGURED on every money route when off, and status says so", async () => {
    process.env.STRIPE_TERMINAL_ENABLED = "0";
    const seller = await seedSeller("flag");
    const product = await seedProduct(seller, { priceCents: 2_000, stock: 3 });
    const paths: Array<[string, string, unknown?]> = [
      ["GET", "/catalog"],
      ["POST", "/location", {}],
      ["POST", "/connection-token", {}],
      ["POST", "/payment-intents", sale([{ productId: product.productId, variantId: product.variantId, quantity: 1 }])],
      ["GET", "/payment-intents/pi_x"],
      ["POST", "/payment-intents/pi_x/cancel", {}],
    ];
    for (const [method, path, body] of paths) {
      const res = await callAs(method, path, seller, body);
      expect(res.status, `${method} ${path}`).toBe(503);
      expect(res.body.code).toBe("TERMINAL_NOT_CONFIGURED");
    }
    const status = await callAs("GET", "/status", seller);
    expect(status.status).toBe(200);
    expect(status.body.enabled).toBe(false);
    expect(status.body.terminalUnavailable).toBe(true);
    expect(fake.state.paymentIntentCreates).toHaveLength(0);
    expect(await stockOf(product.variantId)).toBe(3);
  });
});

describe("status", () => {
  it("tells a seller without Stripe payouts to set them up instead of failing", async () => {
    const seller = await seedSeller("nostripe", { stripeAccount: false });
    const res = await callAs("GET", "/status", seller);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      enabled: true, paymentsReady: false, needsPayoutSetup: true, terminalUnavailable: false, location: null,
    });
  });

  it("is ready for a seller with active payouts", async () => {
    const seller = await seedSeller("ready");
    const res = await callAs("GET", "/status", seller);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, paymentsReady: true, needsPayoutSetup: false, terminalUnavailable: false });
  });

  // A long-lived database that missed migration 274 has no
  // seller_terminal_locations table; /status used to throw (500).
  it("answers terminalUnavailable, not 500, when the Terminal tables can't be read", async () => {
    const noStripe = await seedSeller("drift-nostripe", { stripeAccount: false });
    const ready = await seedSeller("drift-ready");
    await db.execute(sql`ALTER TABLE seller_terminal_locations RENAME TO seller_terminal_locations_hidden`);
    try {
      const gated = await callAs("GET", "/status", noStripe);
      expect(gated.status, JSON.stringify(gated.body)).toBe(200);
      expect(gated.body).toMatchObject({ needsPayoutSetup: true, paymentsReady: false });
      const unavailable = await callAs("GET", "/status", ready);
      expect(unavailable.status, JSON.stringify(unavailable.body)).toBe(200);
      expect(unavailable.body).toMatchObject({ enabled: true, paymentsReady: true, terminalUnavailable: true, location: null });
    } finally {
      await db.execute(sql`ALTER TABLE seller_terminal_locations_hidden RENAME TO seller_terminal_locations`);
    }
  });
});

describe("auth", () => {
  it("refuses a team role without the orders permission", async () => {
    const seller = await seedSeller("role");
    const product = await seedProduct(seller, { priceCents: 2_000, stock: 3 });
    const denied = await callAs("POST", "/payment-intents",
      seller, sale([{ productId: product.productId, variantId: product.variantId, quantity: 1 }]), "marketing");
    expect(denied.status).toBe(403);
    const staff = await callAs("GET", "/catalog", seller, undefined, "staff");
    expect(staff.status).toBe(200);
  });
});

describe("pricing", () => {
  it("prices from the database and ignores client prices", async () => {
    const seller = await seedSeller("price");
    const product = await seedProduct(seller, { priceCents: 3_500, stock: 5 });
    const res = await callAs("POST", "/payment-intents", seller, sale([
      { productId: product.productId, variantId: product.variantId, quantity: 2, priceCents: 1 } as any,
    ], { amountCents: 100 }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.amountCents).toBe(7_000);

    const [created] = fake.state.paymentIntentCreates;
    expect(created.params).toMatchObject({
      amount: 7_000,
      currency: "usd",
      payment_method_types: ["card_present"],
      capture_method: "automatic",
      metadata: { kind: "popup_sale", source: "popup", sellerId: seller },
    });
    // Same money model as the in-app checkout: platform charge, transfer later.
    expect(created.params.transfer_data).toBeUndefined();
    expect(created.params.application_fee_amount).toBeUndefined();

    const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripePaymentIntentId, res.body.paymentIntentId));
    expect(row).toMatchObject({ source: "popup", chargeModel: "transfer", buyerId: null, amountTotalCents: 7_000 });
    expect(row.platformFeeCents).toBe(350); // 5% of $70
    // Stock is held from the moment the seller taps Charge.
    expect(await stockOf(product.variantId)).toBe(3);
  });

  it("refuses another seller's product, missing stock and tiny totals", async () => {
    const seller = await seedSeller("own");
    const other = await seedSeller("other");
    const theirs = await seedProduct(other, { priceCents: 2_000, stock: 5 });
    const mine = await seedProduct(seller, { priceCents: 2_000, stock: 1 });
    const cheap = await seedProduct(seller, { priceCents: 25, stock: 5 });

    const foreign = await callAs("POST", "/payment-intents", seller, sale([{ productId: theirs.productId, variantId: theirs.variantId, quantity: 1 }]));
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe("ITEM_NOT_FOUND");

    const tooMany = await callAs("POST", "/payment-intents", seller, sale([{ productId: mine.productId, variantId: mine.variantId, quantity: 2 }]));
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.code).toBe("OUT_OF_STOCK");

    await expect(pricePopupCart({ sellerId: seller, items: [{ productId: cheap.productId, variantId: cheap.variantId, quantity: 1 }] }))
      .rejects.toBeInstanceOf(PopupSaleError);
    expect(fake.state.paymentIntentCreates).toHaveLength(0);
    expect(await stockOf(theirs.variantId)).toBe(5);
    expect(await stockOf(mine.variantId)).toBe(1);
  });

  it("needs an active connected account", async () => {
    const seller = await seedSeller("nopay", { stripeAccount: false });
    const product = await seedProduct(seller, { priceCents: 2_000, stock: 2 });
    const res = await callAs("POST", "/payment-intents", seller, sale([{ productId: product.productId, variantId: product.variantId, quantity: 1 }]));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SELLER_PAYMENTS_UNAVAILABLE");
  });

  it("returns the same intent for a retried Charge tap", async () => {
    const seller = await seedSeller("retry");
    const product = await seedProduct(seller, { priceCents: 2_000, stock: 5 });
    const body = sale([{ productId: product.productId, variantId: product.variantId, quantity: 1 }]);
    const first = await callAs("POST", "/payment-intents", seller, body);
    const second = await callAs("POST", "/payment-intents", seller, body);
    expect(second.status).toBe(200);
    expect(second.body.paymentIntentId).toBe(first.body.paymentIntentId);
    expect(await stockOf(product.variantId)).toBe(4);
  });

  it("lists only the seller's active in-stock products in the catalog", async () => {
    const seller = await seedSeller("catalog");
    const inStock = await seedProduct(seller, { priceCents: 4_000, stock: 2 });
    const soldOut = await seedProduct(seller, { priceCents: 4_000, stock: 0 });
    await seedProduct(await seedSeller("catalog-other"), { priceCents: 1_000, stock: 9 });
    const res = await callAs("GET", "/catalog", seller);
    expect(res.status).toBe(200);
    const ids = res.body.products.map((p: any) => p.productId);
    expect(ids).toContain(inStock.productId);
    expect(ids).not.toContain(soldOut.productId);
    expect(res.body.products).toHaveLength(1);
    expect(res.body.products[0].variants[0]).toMatchObject({ variantId: inStock.variantId, priceCents: 4_000, stock: 2 });
  });
});

describe("webhook finalize", () => {
  it("creates exactly one pop-up order, decrements stock once and pays the seller by transfer", async () => {
    const seller = await seedSeller("final");
    const product = await seedProduct(seller, { priceCents: 2_500, stock: 4 });
    const res = await callAs("POST", "/payment-intents", seller, sale([{ productId: product.productId, variantId: product.variantId, quantity: 2 }]));
    expect(res.status).toBe(200);
    const intent = succeeded(res.body.paymentIntentId);

    const eventId = `evt_${uid("popdup").replace(/-/g, "_")}`;
    const first = await deliverWebhook("payment_intent.succeeded", intent, eventId);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    // Redelivery of the same event, and a distinct duplicate event.
    expect((await deliverWebhook("payment_intent.succeeded", intent, eventId)).status).toBe(200);
    expect((await deliverWebhook("payment_intent.succeeded", intent)).status).toBe(200);
    expect((await finalizePopupSale(intent, new Date())).outcome).toBe("exists");

    const made = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, intent.id));
    expect(made).toHaveLength(1);
    const order = made[0];
    expect(order).toMatchObject({
      ownerId: seller, buyerId: null, source: "popup", status: "delivered",
      totalCents: 5_000, subtotalCents: 5_000, shippingCents: 0, taxCents: 0,
      chargeModel: "transfer", platformFeeCents: 250, deliveryConfirmedBy: "buyer",
    });
    expect(order.deliveredAt).not.toBeNull();
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ variantId: product.variantId, quantity: 2, priceCents: 2_500 });
    // Reserved once at Charge, committed (not decremented again) by the webhook.
    expect(await stockOf(product.variantId)).toBe(2);
    // Real Stripe fee (fake: 320) borne by the seller; seller net is held for the transfer.
    expect(order.processingFeeCents).toBe(320);
    expect(order.sellerNetCents).toBe(5_000 - 250 - 320);
    // PAYOUT_MODE=immediate (test default): paid out once, by a transfer
    // funded from this exact charge, exactly like an online in-app order.
    expect(fake.state.transfers).toHaveLength(1);
    expect(fake.state.transfers[0]).toMatchObject({
      amount: 5_000 - 250 - 320, transfer_group: order.id, source_transaction: `ch_${intent.id}`,
    });
    const ledger = await orderLedger(order.id);
    expect(ledger.seller_held ?? 0).toBe(0);
    expect(ledger.seller_paid_out).toBe(5_000 - 250 - 320);

    const status = await callAs("GET", `/payment-intents/${intent.id}`, seller);
    expect(status.status).toBe(200);
    expect(status.body.order).toMatchObject({ orderId: order.id, orderNumber: order.orderNumber });
    // Another seller can't read it.
    const stranger = await callAs("GET", `/payment-intents/${intent.id}`, await seedSeller("stranger"));
    expect(stranger.status).toBe(404);
  });

  it("gives the stock back when the sale is cancelled", async () => {
    const seller = await seedSeller("cancel");
    const product = await seedProduct(seller, { priceCents: 2_000, stock: 3 });
    const res = await callAs("POST", "/payment-intents", seller, sale([{ productId: product.productId, variantId: product.variantId, quantity: 2 }]));
    expect(await stockOf(product.variantId)).toBe(1);
    const cancel = await callAs("POST", `/payment-intents/${res.body.paymentIntentId}/cancel`, seller, {});
    expect(cancel.status).toBe(200);
    expect(fake.state.paymentIntents.get(res.body.paymentIntentId).status).toBe("canceled");
    expect(await stockOf(product.variantId)).toBe(3);
    // The canceled webhook afterwards is a no-op (already released).
    expect((await deliverWebhook("payment_intent.canceled", fake.state.paymentIntents.get(res.body.paymentIntentId))).status).toBe(200);
    expect(await stockOf(product.variantId)).toBe(3);
  });

  it("under PAYOUT_MODE=hold, holds the seller's net until the post-delivery buffer", async () => {
    const previous = process.env.PAYOUT_MODE;
    process.env.PAYOUT_MODE = "hold";
    try {
      const seller = await seedSeller("hold");
      const product = await seedProduct(seller, { priceCents: 4_000, stock: 2 });
      const res = await callAs("POST", "/payment-intents", seller, sale([{ productId: product.productId, variantId: product.variantId, quantity: 1 }]));
      const intent = succeeded(res.body.paymentIntentId);
      expect((await finalizePopupSale(intent, new Date())).outcome).toBe("created");
      const [order] = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, intent.id));
      expect(order.deliveredAt).not.toBeNull();
      expect(order.payoutReleaseAt!.valueOf()).toBeGreaterThan(Date.now());
      expect(fake.state.transfers).toHaveLength(0);
      expect((await orderLedger(order.id)).seller_held).toBe(4_000 - 200 - 320);
    } finally {
      if (previous === undefined) delete process.env.PAYOUT_MODE;
      else process.env.PAYOUT_MODE = previous;
    }
  });

  it("refunds automatically when the hold expired and the item sold out meanwhile", async () => {
    const seller = await seedSeller("oversold");
    const product = await seedProduct(seller, { priceCents: 3_000, stock: 1 });
    const res = await callAs("POST", "/payment-intents", seller, sale([{ productId: product.productId, variantId: product.variantId, quantity: 1 }]));
    const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripePaymentIntentId, res.body.paymentIntentId));
    // The hold expired (stock back to 1), then someone bought the last unit online.
    await db.transaction((tx) => releaseStockReservation(tx, row.id));
    await db.update(productVariants).set({ stock: 0 }).where(eq(productVariants.id, product.variantId));

    const intent = succeeded(res.body.paymentIntentId);
    expect((await finalizePopupSale(intent, new Date())).outcome).toBe("oversold");
    const [order] = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, intent.id));
    expect(order.status).toBe("cancelled");
    expect(fake.state.refunds).toHaveLength(1);
    expect(await stockOf(product.variantId)).toBe(0);
  });

  it("ignores intents that aren't pop-up sales", async () => {
    const result = await finalizePopupSale({ id: "pi_unknown_popup", metadata: { source: "popup", kind: "popup_sale" } }, new Date());
    expect(result.outcome).toBe("ignored");
  });
});

describe("terminal location and connection token", () => {
  it("needs a saved location, then creates one Terminal Location and reuses it", async () => {
    const seller = await seedSeller("loc");
    const noToken = await callAs("POST", "/connection-token", seller, {});
    expect(noToken.status).toBe(409);
    expect(noToken.body.code).toBe("TERMINAL_LOCATION_REQUIRED");
    const none = await callAs("POST", "/location", seller, {});
    expect(none.status).toBe(409);
    expect(none.body.code).toBe("LOCATION_REQUIRED");

    await db.insert(sellerLocations).values({
      ownerId: seller, name: "Saturday Market", address: "148 Mercer Street", city: "New York",
      state: "NY", zip: "10012", country: "US", isPrimary: true,
    });
    const created = await callAs("POST", "/location", seller, {});
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.location).toMatchObject({ id: "tml_1", displayName: "Saturday Market" });
    expect(terminal.locations[0].params.address).toMatchObject({ line1: "148 Mercer Street", postal_code: "10012", country: "US" });
    const again = await callAs("POST", "/location", seller, {});
    expect(again.body.location.id).toBe("tml_1");
    expect(terminal.locations).toHaveLength(1);

    const token = await callAs("POST", "/connection-token", seller, {});
    expect(token.status).toBe(200);
    expect(token.body).toMatchObject({ secret: "pst_test_1", locationId: "tml_1" });
    expect(terminal.tokens[0].params.location).toBe("tml_1");

    const status = await callAs("GET", "/status", seller);
    expect(status.body).toMatchObject({ enabled: true, paymentsReady: true, hasSellerLocation: true, location: { id: "tml_1" } });
  });
});
