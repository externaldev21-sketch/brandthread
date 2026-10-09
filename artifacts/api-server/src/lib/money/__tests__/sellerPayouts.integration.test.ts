/**
 * Seller payout status from Stripe Connect webhooks, against real Postgres,
 * real signature verification and a fake Stripe: payout.* events upsert
 * seller_payouts, late events never move a payout backwards, a failed payout
 * alerts the seller and reconciles the cash-out request, and the finance
 * routes read the table (backfilling it from Stripe once).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("./fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../push")>()),
  sendPushToUser: async () => {},
}));
vi.mock("../../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
  sendPayoutEmail: async () => true,
}));
vi.mock("../../../middlewares/requireAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../middlewares/requireAuth")>()),
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../../middlewares/requireRole", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../middlewares/requireRole")>();
  return {
    ...actual,
    teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    requirePayoutsRead: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

import { and, eq } from "drizzle-orm";
import {
  db, notificationsFeed, sellerCashoutAttempts, sellerPayouts, sellerPayoutSyncs, users,
} from "@workspace/db";
import { fake } from "./fakeStripe";
import {
  call, held, pay, seedBuyer, seedDrop, seedProduct, seedSeller, startApp, uid,
} from "./moneyHarness";
import { supersedes } from "../sellerPayouts";
import webhooksRouter from "../../../routes/webhooks";
import financeRouter from "../../../routes/finance";
import analyticsRouter from "../../../routes/analytics";

let app: { base: string; close: () => Promise<void> };
const originalKey = process.env.STRIPE_SECRET_KEY;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_for_money_tests";
  app = await startApp((server) => {
    server.use("/api/webhooks", webhooksRouter);
    server.use("/api/finance", financeRouter);
    server.use("/api/analytics", analyticsRouter);
  });
});
afterAll(async () => {
  process.env.STRIPE_SECRET_KEY = originalKey;
  await app?.close();
});
beforeEach(() => fake.reset());

const stripeId = (prefix: string) => `${prefix}_${uid(prefix).replace(/-/g, "_")}`;
const NOW = Math.floor(Date.now() / 1000);

async function accountOf(sellerId: string): Promise<string> {
  const [row] = await db.select({ account: users.stripeAccountId }).from(users).where(eq(users.clerkId, sellerId));
  return row.account!;
}

function payoutObject(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    object: "payout",
    amount: 12_345,
    currency: "usd",
    status,
    method: "standard",
    automatic: true,
    arrival_date: NOW + 2 * 86_400,
    created: NOW - 60,
    destination: "ba_test_123",
    failure_code: null,
    failure_message: null,
    metadata: {},
    ...overrides,
  };
}

async function deliver(type: string, object: Record<string, unknown>, options: { account?: string | null; created?: number } = {}) {
  const event = {
    id: stripeId("evt"),
    object: "event",
    type,
    livemode: false,
    created: options.created ?? NOW,
    data: { object },
    ...(options.account === null ? {} : { account: options.account }),
  };
  const signed = fake.signedEvent(event);
  const response = await fetch(`${app.base}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signed.header },
    body: signed.payload,
  });
  expect(response.status).toBe(200);
  return event;
}

async function stored(payoutId: string) {
  const [row] = await db.select().from(sellerPayouts).where(eq(sellerPayouts.stripePayoutId, payoutId));
  return row;
}

async function notifications(sellerId: string, type: string) {
  return db.select().from(notificationsFeed)
    .where(and(eq(notificationsFeed.userId, sellerId), eq(notificationsFeed.type, type)));
}

describe("supersedes", () => {
  const at = (s: number) => new Date(s * 1000);
  it("orders by event time, and at the same second a final status wins", () => {
    expect(supersedes({ lastEventCreated: at(100), status: "paid" }, at(99), "in_transit")).toBe(false);
    expect(supersedes({ lastEventCreated: at(100), status: "paid" }, at(101), "failed")).toBe(true);
    expect(supersedes({ lastEventCreated: at(100), status: "paid" }, at(100), "in_transit")).toBe(false);
    expect(supersedes({ lastEventCreated: at(100), status: "pending" }, at(100), "in_transit")).toBe(true);
  });
});

describe("Connect payout webhooks → seller_payouts", () => {
  it("upserts one row per payout through its lifecycle and keeps the paid alert", async () => {
    const seller = await seedSeller("po-life");
    const account = await accountOf(seller);
    const payoutId = stripeId("po");

    await deliver("payout.created", payoutObject(payoutId, "pending"), { account, created: NOW - 30 });
    expect(await stored(payoutId)).toMatchObject({
      status: "pending", sellerId: seller, stripeAccountId: account, amountCents: 12_345, currency: "usd",
    });

    await deliver("payout.updated", payoutObject(payoutId, "in_transit"), { account, created: NOW - 20 });
    expect((await stored(payoutId)).status).toBe("in_transit");

    await deliver("payout.paid", payoutObject(payoutId, "paid"), { account, created: NOW - 10 });
    const row = await stored(payoutId);
    expect(row.status).toBe("paid");
    expect(row.lastEventCreated.valueOf()).toBe((NOW - 10) * 1000);
    expect(await db.select().from(sellerPayouts).where(eq(sellerPayouts.stripePayoutId, payoutId))).toHaveLength(1);
    expect(await notifications(seller, "payout_sent")).toHaveLength(1);
  });

  it("ignores an older event delivered after a newer one", async () => {
    const seller = await seedSeller("po-ooo");
    const account = await accountOf(seller);
    const payoutId = stripeId("po");

    await deliver("payout.paid", payoutObject(payoutId, "paid"), { account, created: NOW });
    await deliver("payout.updated", payoutObject(payoutId, "in_transit"), { account, created: NOW - 100 });
    await deliver("payout.created", payoutObject(payoutId, "pending"), { account, created: NOW - 200 });
    // Same second: an in-flight status never replaces a final one.
    await deliver("payout.updated", payoutObject(payoutId, "in_transit"), { account, created: NOW });

    const row = await stored(payoutId);
    expect(row.status).toBe("paid");
    expect(row.lastEventCreated.valueOf()).toBe(NOW * 1000);
  });

  it("accepts events signed by the Connect endpoint's secret only when it is configured", async () => {
    const seller = await seedSeller("po-connect");
    const account = await accountOf(seller);
    const payoutId = stripeId("po");
    const signed = fake.signedEvent({
      id: stripeId("evt"), object: "event", type: "payout.created", livemode: false, created: NOW, account,
      data: { object: payoutObject(payoutId, "pending") },
    }, "whsec_connect_endpoint_test");
    const post = () => fetch(`${app.base}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signed.header },
      body: signed.payload,
    });

    expect((await post()).status).toBe(400);
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_connect_endpoint_test";
    try {
      expect((await post()).status).toBe(200);
    } finally {
      delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    }
    expect((await stored(payoutId)).status).toBe("pending");
  });

  it("ignores platform payouts (no connected account)", async () => {
    const payoutId = stripeId("po");
    await deliver("payout.paid", payoutObject(payoutId, "paid"), { account: null });
    expect(await stored(payoutId)).toBeUndefined();
  });

  it("a failed payout alerts the seller once and fails the cash-out request", async () => {
    const seller = await seedSeller("po-fail");
    const account = await accountOf(seller);
    const payoutId = stripeId("po");
    const [attempt] = await db.insert(sellerCashoutAttempts).values({
      ownerId: seller,
      idempotencyKey: uid("cashout"),
      amountCents: 12_345,
      currency: "usd",
      stripeAccountId: account,
      bankDestinationId: "ba_test_123",
      status: "succeeded",
      stripePayoutId: payoutId,
      responseStatus: "pending",
      responseArrivalDate: new Date(),
    }).returning();

    const failed = payoutObject(payoutId, "failed", {
      failure_code: "account_closed",
      failure_message: "The bank account has been closed.",
    });
    await deliver("payout.failed", failed, { account, created: NOW });
    // Stripe also sends payout.updated for the same change.
    await deliver("payout.updated", failed, { account, created: NOW });

    expect(await stored(payoutId)).toMatchObject({
      status: "failed", failureCode: "account_closed", failureMessage: "The bank account has been closed.",
    });
    const [after] = await db.select().from(sellerCashoutAttempts).where(eq(sellerCashoutAttempts.id, attempt.id));
    expect(after).toMatchObject({
      status: "failed",
      responseStatus: "failed",
      errorCode: "account_closed",
      errorMessage: "The bank account has been closed.",
    });
    const alerts = await notifications(seller, "payout_failed");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ targetId: payoutId, targetType: "payout", title: "Payout failed" });
    expect(alerts[0].body).toContain("$123.45");
    expect(alerts[0].body).toContain("The bank account has been closed.");

    // A late payout.paid from before the failure neither revives the payout
    // nor tells the seller the money arrived.
    await deliver("payout.paid", payoutObject(payoutId, "paid"), { account, created: NOW - 50 });
    expect((await stored(payoutId)).status).toBe("failed");
    expect(await notifications(seller, "payout_sent")).toHaveLength(0);
  });

  it("finds a cash-out whose Stripe response was lost by the payout's metadata", async () => {
    const seller = await seedSeller("po-meta");
    const account = await accountOf(seller);
    const payoutId = stripeId("po");
    const [attempt] = await db.insert(sellerCashoutAttempts).values({
      ownerId: seller,
      idempotencyKey: uid("cashout"),
      amountCents: 5_000,
      currency: "usd",
      stripeAccountId: account,
      bankDestinationId: "ba_test_123",
      status: "processing",
    }).returning();

    await deliver(
      "payout.created",
      payoutObject(payoutId, "pending", { amount: 5_000, metadata: { brandthread_cashout_attempt: attempt.id } }),
      { account },
    );
    const [after] = await db.select().from(sellerCashoutAttempts).where(eq(sellerCashoutAttempts.id, attempt.id));
    expect(after).toMatchObject({ status: "succeeded", stripePayoutId: payoutId, responseStatus: "pending" });
  });
});

describe("finance routes read seller_payouts", () => {
  it("backfills from Stripe once, then serves webhook-fed status from the table", async () => {
    const seller = await seedSeller("po-fin");
    const account = await accountOf(seller);
    const older = stripeId("po");
    const newer = stripeId("po");
    fake.state.payouts.push(
      payoutObject(newer, "in_transit", { amount: 2_000, created: NOW - 100, destination: { last4: "6789", brand: null, bank_name: "TEST BANK" } }),
      payoutObject(older, "paid", { amount: 1_000, created: NOW - 5_000, destination: { last4: "6789", bank_name: "TEST BANK" } }),
    );

    const first = await call(app.base, "GET", "/api/finance/payouts", seller);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ connected: true, hasMore: false });
    expect(first.body.payouts.map((p: any) => p.id)).toEqual([newer, older]);
    expect(first.body.payouts[0]).toMatchObject({
      amount: 2_000, currency: "usd", formatted: "$20.00", status: "in_transit", method: "standard",
      failureCode: null, failureMessage: null, destination: { last4: "6789", brand: "TEST BANK" },
    });
    expect(typeof first.body.payouts[0].arrivalDate).toBe("string");
    expect(typeof first.body.payouts[0].created).toBe("string");
    expect(await db.select().from(sellerPayoutSyncs).where(eq(sellerPayoutSyncs.stripeAccountId, account))).toHaveLength(1);

    // Stripe's list now disagrees; the webhook is what moves the status.
    fake.state.payouts.length = 0;
    await deliver("payout.paid", payoutObject(newer, "paid", { amount: 2_000, created: NOW - 100 }), { account, created: NOW + 5 });

    const second = await call(app.base, "GET", "/api/finance/payouts", seller);
    expect(second.body.payouts.map((p: any) => [p.id, p.status])).toEqual([[newer, "paid"], [older, "paid"]]);
    // Bank details from the backfill survive the webhook (which only has an id).
    expect(second.body.payouts[0].destination).toEqual({ last4: "6789", brand: "TEST BANK" });

    const limited = await call(app.base, "GET", "/api/finance/payouts?limit=1", seller);
    expect(limited.body.payouts).toHaveLength(1);
    expect(limited.body.hasMore).toBe(true);

    const summary = await call(app.base, "GET", "/api/finance/summary", seller);
    expect(summary.status).toBe(200);
    expect(summary.body.paidOut.toBank).toMatchObject({ amount: 3_000 });
  });

  it("a seller whose first payout event arrived before any read still gets their history backfilled", async () => {
    const seller = await seedSeller("po-hist");
    const account = await accountOf(seller);
    const historic = stripeId("po");
    const live = stripeId("po");
    await deliver("payout.created", payoutObject(live, "pending", { created: NOW }), { account });
    fake.state.payouts.push(
      payoutObject(live, "pending", { created: NOW }),
      payoutObject(historic, "paid", { created: NOW - 50_000 }),
    );

    const list = await call(app.base, "GET", "/api/finance/payouts", seller);
    expect(list.body.payouts.map((p: any) => p.id)).toEqual([live, historic]);
  });
});

describe("analytics dashboard payout figures", () => {
  it("held = ledger-held preorder money; processing = payouts on their way to the bank", async () => {
    const seller = await seedSeller("po-dash");
    const account = await accountOf(seller);
    const drop = await seedDrop(seller);
    const preorder = await seedProduct(seller, { priceCents: 2_000, dropId: drop.id });
    await pay({
      sellerId: seller, buyerId: await seedBuyer("po-dash"), chargeModel: "held", dropId: drop.id,
      items: [{ ...preorder, quantity: 1 }], stripeFeeCents: 88,
    });
    const heldCents = await held(seller, { dropId: drop.id });
    expect(heldCents).toBeGreaterThan(0);

    await deliver("payout.updated", payoutObject(stripeId("po"), "in_transit", { amount: 700 }), { account });
    await deliver("payout.created", payoutObject(stripeId("po"), "pending", { amount: 300 }), { account });
    await deliver("payout.paid", payoutObject(stripeId("po"), "paid", { amount: 9_999 }), { account });

    const dashboard = await call(app.base, "GET", "/api/analytics/dashboard", seller);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.payouts).toEqual({ preOrderHeldCents: heldCents, preMadeAvailableCents: 1_000 });
  });
});
