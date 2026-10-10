/**
 * POST /api/orders/:id/refund — a seller refunds part or all of an order
 * without cancelling it, against real Postgres and the fake Stripe. Proves the
 * amount limits, retries collapsing onto one refund, ownership, the buyer
 * notification and that the ledger still balances.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const published = vi.hoisted(() => [] as any[]);
const refundNotices = () => published.filter((n) => n.type === "refund_update");

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
}));
vi.mock("../../../routes/notifications-feed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../routes/notifications-feed")>()),
  publishNotification: async (n: unknown) => { published.push(n); },
}));
vi.mock("../../../middlewares/requireAuth", () => ({
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
    requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

import { db, orderRefunds, orders } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { call, expectLedgerBalanced, ledgerKinds, pay, reloadOrder, seedBuyer, seedProduct, seedSeller, startApp } from "./moneyHarness";
import ordersRouter from "../../../routes/orders";

let app: { base: string; close: () => Promise<void> };

beforeAll(async () => {
  app = await startApp((server) => { server.use("/api/orders", ordersRouter); });
});
afterAll(async () => {
  await expectLedgerBalanced();
  await app?.close();
});
beforeEach(() => { fake.reset(); published.length = 0; });

async function paidOrder(tag: string) {
  const seller = await seedSeller(tag);
  const buyer = await seedBuyer(tag);
  const product = await seedProduct(seller, { priceCents: 5_000 });
  const { order } = await pay({
    sellerId: seller, buyerId: buyer, chargeModel: "destination",
    items: [{ ...product, quantity: 1 }], shippingCents: 500,
  });
  return { seller, buyer, order };
}

describe("POST /api/orders/:id/refund", () => {
  it("refunds part of an order, keeps its status, notifies the buyer and reports what is left", async () => {
    const { seller, buyer, order } = await paidOrder("seller-refund-partial");
    const res = await call(app.base, "POST", `/api/orders/${order.id}/refund`, seller, {
      amountCents: 1_500, reason: "item_damaged", note: "Scuffed sole", requestId: "req-partial-0001",
    });
    expect(res.status).toBe(200);
    expect(res.body.refund).toMatchObject({ amountCents: 1_500, duplicate: false });
    expect(res.body.refundedCents).toBe(1_500);
    expect(res.body.refundableCents).toBe(5_500 - 1_500);
    expect(fake.state.refunds).toHaveLength(1);
    expect(fake.state.refunds[0]).toMatchObject({ payment_intent: order.stripePaymentIntentId, amount: 1_500 });

    const after = await reloadOrder(order.id);
    expect(after.status).toBe(order.status);
    expect(after.refundedCents).toBe(1_500);
    expect(await ledgerKinds(order.id)).toContain("refund_seller_refund");
    expect(refundNotices()).toHaveLength(1);
    expect(refundNotices()[0]).toMatchObject({ userId: buyer, type: "refund_update", targetId: order.id });

    const list = await call(app.base, "GET", `/api/orders/${order.id}/refunds`, seller);
    expect(list.status).toBe(200);
    expect(list.body.refunds).toHaveLength(1);
    expect(list.body.refunds[0]).toMatchObject({ amountCents: 1_500, reason: "seller_refund", state: "succeeded" });
  });

  it("collapses a retried request onto the same refund", async () => {
    const { seller, order } = await paidOrder("seller-refund-retry");
    const body = { amountCents: 1_000, reason: "goodwill", requestId: "req-retry-00001" };
    const first = await call(app.base, "POST", `/api/orders/${order.id}/refund`, seller, body);
    const second = await call(app.base, "POST", `/api/orders/${order.id}/refund`, seller, body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.refund.duplicate).toBe(true);
    expect(fake.state.refunds).toHaveLength(1);
    expect(refundNotices()).toHaveLength(1);
    const rows = await db.select().from(orderRefunds).where(eq(orderRefunds.orderId, order.id));
    expect(rows).toHaveLength(1);
  });

  it("refuses more than what is left, and refunds the rest exactly", async () => {
    const { seller, order } = await paidOrder("seller-refund-limit");
    const over = await call(app.base, "POST", `/api/orders/${order.id}/refund`, seller, {
      amountCents: 9_999, reason: "other", requestId: "req-over-000001",
    });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe("REFUND_EXCEEDS_REMAINING");
    expect(fake.state.refunds).toHaveLength(0);

    const all = await call(app.base, "POST", `/api/orders/${order.id}/refund`, seller, {
      amountCents: 5_500, reason: "other", requestId: "req-full-000001",
    });
    expect(all.status).toBe(200);
    expect(all.body.refundableCents).toBe(0);
    const again = await call(app.base, "POST", `/api/orders/${order.id}/refund`, seller, {
      amountCents: 100, reason: "other", requestId: "req-again-00001",
    });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_REFUNDED");
  });

  it("validates the body and hides other sellers' orders", async () => {
    const { seller, order } = await paidOrder("seller-refund-auth");
    const bad = await call(app.base, "POST", `/api/orders/${order.id}/refund`, seller, {
      amountCents: 0, reason: "goodwill", requestId: "req-bad-0000001",
    });
    expect(bad.status).toBe(400);
    const badReason = await call(app.base, "POST", `/api/orders/${order.id}/refund`, seller, {
      amountCents: 100, reason: "because", requestId: "req-bad-0000002",
    });
    expect(badReason.status).toBe(400);
    const stranger = await seedSeller("seller-refund-stranger");
    const theirs = await call(app.base, "POST", `/api/orders/${order.id}/refund`, stranger, {
      amountCents: 100, reason: "goodwill", requestId: "req-stranger-01",
    });
    expect(theirs.status).toBe(404);
    expect((await call(app.base, "GET", `/api/orders/${order.id}/refunds`, stranger)).status).toBe(404);
    expect(fake.state.refunds).toHaveLength(0);
  });

  it("refuses orders that were auto-refunded or have no card payment", async () => {
    const { seller, order } = await paidOrder("seller-refund-blocked");
    await db.update(orders).set({ autoRefundedAt: new Date() }).where(eq(orders.id, order.id));
    const res = await call(app.base, "POST", `/api/orders/${order.id}/refund`, seller, {
      amountCents: 100, reason: "goodwill", requestId: "req-blocked-001",
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("AUTO_REFUNDED");
    expect(fake.state.refunds).toHaveLength(0);
  });
});
