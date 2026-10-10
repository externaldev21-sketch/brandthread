/**
 * Delivery guarantee + automatic non-delivery refunds + hold-until-delivered
 * payouts, against real Postgres with the in-memory Stripe and a MOCKED CLOCK
 * (only Date is faked, so the database driver still runs normally):
 *
 *  - on-time delivery: no refund, seller paid only after delivery + buffer
 *  - 15-day auto-refund of a regular order (platform never paid the seller)
 *  - 60-day auto-refund of a pre-order (and 15 vs 60 inside one order)
 *  - partial shipment: only the undelivered items are refunded
 *  - no double refund (re-runs, two sweeps at once, Stripe idempotency)
 *  - an open dispute pauses the auto-refund; winning it resumes
 *  - payout release: held until delivery + buffer, blocked by dispute/return
 *  - refund failure: retries with back-off, then an alert
 *  - multi-seller carts, cancelled orders, the last look at the carrier
 *  - seller warnings at 5 days / 2 days / 12 hours
 *  - the seller can't mark delivered or ship an auto-refunded order
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("../../money/__tests__/fakeStripe");
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

vi.mock("../../../middlewares/requireRole", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { db, notificationsFeed, orderItems, orders, products, returns } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { fake } from "../../money/__tests__/fakeStripe";
import {
  buyLabel, call, expectLedgerBalanced, ledgerKinds, pay, reloadOrder, seedBuyer, seedProduct, seedSeller, startApp, uid,
} from "../../money/__tests__/moneyHarness";
import { logger } from "../../logger";
import { sweepTransferOrders } from "../../money/cartTransfers";
import { recoverLabelCost } from "../../money/escrow";
import { applyDisputePause } from "../disputePause";
import { runAutoRefundSweep, runDeadlineWarnings } from "../autoRefund";
import { applyShippoTrack } from "../trackingSync";
import { recordDelivery, shipItems } from "../deliveryState";
import { loadBuyerDelivery } from "../buyerView";
import buyerRouter from "../../../routes/buyer";
import ordersRouter from "../../../routes/orders";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = new Date("2026-03-01T12:00:00Z");
const at = (days: number, hours = 0) => new Date(T0.valueOf() + days * DAY + hours * HOUR);

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  process.env.PAYOUT_MODE = "hold";
  process.env.PAYOUT_RELEASE_BUFFER_DAYS = "3";
  app = await startApp((server) => {
    server.use("/api/buyer", buyerRouter);
    server.use("/api/orders", ordersRouter);
    server.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: String(err?.stack ?? err) });
    });
  });
});
afterAll(async () => {
  await app.close();
  await expectLedgerBalanced();
});
beforeEach(async () => {
  // The sweeps are global, so park every order left over from earlier tests
  // (cancelled orders are skipped by both the refund and payout sweeps).
  await db.update(orders).set({ status: "cancelled" }).where(sql`${orders.ownerId} LIKE 'money-seller-%'`);
  fake.reset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Line = { price: number; qty?: number; preorder?: boolean; shipDate?: Date };

async function place(options: { seller?: string; buyer?: string; lines?: Line[]; shippingCents?: number; paidAt?: Date } = {}) {
  const seller = options.seller ?? await seedSeller("dg");
  const buyer = options.buyer ?? await seedBuyer("dg");
  const lines = options.lines ?? [{ price: 6000 }];
  const items = [];
  for (const line of lines) {
    const product = await seedProduct(seller, { priceCents: line.price });
    if (line.preorder) {
      await db.update(products).set({ isPreOrder: true, preOrderEstShipDate: line.shipDate ?? at(20) })
        .where(eq(products.id, product.productId));
    }
    items.push({ variantId: product.variantId, productName: product.productName, priceCents: line.price, quantity: line.qty ?? 1 });
  }
  vi.setSystemTime(options.paidAt ?? T0);
  const { order } = await pay({ sellerId: seller, buyerId: buyer, items, chargeModel: "transfer", shippingCents: options.shippingCents ?? 0 });
  return { seller, buyer, order, items };
}

/** Whole-order shipment the way the tracking route records it. */
async function ship(orderId: string, trackingNumber = `1Z${uid("trk")}`) {
  await db.update(orders).set({ trackingNumber, carrier: "UPS", status: "shipped", shippedAt: new Date() }).where(eq(orders.id, orderId));
  await db.update(orderItems).set({ trackingNumber, carrier: "UPS", shippedAt: new Date() }).where(eq(orderItems.orderId, orderId));
  return trackingNumber;
}

const BROOKLYN = { street: "1 Main St", city: "Brooklyn", state: "NY", zip: "11201", country: "US" };

/** Carrier "delivered" for seller-typed tracking whose destination matches the order (BT-070). */
async function carrierDelivers(orderId: string, trackingNumber: string, when: Date) {
  vi.setSystemTime(when);
  await db.update(orders).set({ shippingAddress: BROOKLYN }).where(eq(orders.id, orderId));
  await applyShippoTrack(orderId, trackingNumber, {
    tracking_number: trackingNumber,
    tracking_status: { status: "DELIVERED", status_details: "Delivered, left at front door", status_date: when.toISOString(), location: { city: "Brooklyn", state: "NY" } },
    tracking_history: [{ status: "TRANSIT", status_details: "Out for delivery", status_date: new Date(when.valueOf() - 4 * HOUR).toISOString() }],
    address_to: { city: "Brooklyn", state: "NY", zip: "11201", country: "US" },
  });
}

async function sweep(when: Date, extra: Parameters<typeof runAutoRefundSweep>[0] = {}) {
  vi.setSystemTime(when);
  return runAutoRefundSweep({ now: when, ...extra });
}

async function feed(userId: string, type: string) {
  return db.select().from(notificationsFeed).where(and(eq(notificationsFeed.userId, userId), eq(notificationsFeed.type, type)));
}

describe("deadlines are stamped at purchase", () => {
  it("regular = 15 days, pre-order = 60 days, each item on its own clock", async () => {
    const { order } = await place({ lines: [{ price: 3000 }, { price: 2000, preorder: true, shipDate: at(30) }] });
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const byPreorder = (flag: boolean) => items.find((i) => i.isPreorder === flag)!;
    expect(byPreorder(false).deliverBy!.toISOString()).toBe(at(15).toISOString());
    expect(byPreorder(true).deliverBy!.toISOString()).toBe(at(60).toISOString());
    const fresh = await reloadOrder(order.id);
    expect(fresh.deliverBy!.toISOString()).toBe(at(15).toISOString()); // earliest open deadline
    expect(fresh.isPreorder).toBe(true);
    expect(fresh.promisedShipDate!.toISOString()).toBe(at(30).toISOString());
    expect(fresh.chargeModel).toBe("transfer");
    expect(fresh.fundsState).toBe("held"); // nothing paid to the seller at checkout
    expect(fake.state.transfers).toHaveLength(0);
  });
});

describe("on-time delivery", () => {
  it("is never refunded, and the seller is paid only after delivery + the buffer", async () => {
    const { order, seller } = await place();
    const tracking = await ship(order.id);
    await carrierDelivers(order.id, tracking, at(6));

    const delivered = await reloadOrder(order.id);
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveryConfirmedBy).toBe("carrier");
    expect(delivered.payoutReleaseAt!.toISOString()).toBe(at(9).toISOString());

    expect((await sweep(at(16))).refunded).toBe(0);
    expect(fake.state.refunds).toHaveLength(0);

    // Delivered, but inside the buffer: still held.
    expect(await sweepTransferOrders({ now: at(8) })).toBe(0);
    expect(fake.state.transfers).toHaveLength(0);
    // Buffer over: one transfer for the seller's net, exactly once.
    expect(await sweepTransferOrders({ now: at(9, 1) })).toBe(1);
    expect(await sweepTransferOrders({ now: at(10) })).toBe(0);
    expect(fake.state.transfers).toHaveLength(1);
    expect(fake.state.transfers[0]).toMatchObject({ amount: delivered.sellerNetCents });
    expect((await reloadOrder(order.id)).fundsState).toBe("released");
    expect(seller).toBeTruthy();
  });

  it("a buyer's 'I received it' delivers the order too (idempotent)", async () => {
    const { order, buyer } = await place();
    await ship(order.id);
    const first = await call(app.base, "POST", `/api/buyer/orders/${order.id}/confirm-receipt`, buyer);
    expect(first.status).toBe(200);
    expect(first.body.delivery.deliveryConfirmedBy).toBe("buyer");
    expect(first.body.delivery.steps.at(-1)).toMatchObject({ key: "delivered", state: "done" });
    const again = await call(app.base, "POST", `/api/buyer/orders/${order.id}/confirm-receipt`, buyer);
    expect(again.status).toBe(200);
    expect((await sweep(at(20))).refunded).toBe(0);
  });

  it("refuses to confirm receipt before it ships, and for someone else's order", async () => {
    const { order, buyer } = await place();
    expect((await call(app.base, "POST", `/api/buyer/orders/${order.id}/confirm-receipt`, buyer)).body.code).toBe("NOT_SHIPPED");
    await ship(order.id);
    expect((await call(app.base, "POST", `/api/buyer/orders/${order.id}/confirm-receipt`, await seedBuyer("other"))).status).toBe(404);
  });
});

describe("15-day automatic refund (regular order)", () => {
  it("refunds the full amount the moment the deadline passes, before the seller was ever paid", async () => {
    const { order, seller, buyer } = await place({ shippingCents: 500 });
    await ship(order.id);

    expect((await sweep(at(14, 23))).checked).toBe(0); // still inside the window
    const result = await sweep(at(15, 1));
    expect(result).toMatchObject({ checked: 1, refunded: 1, failed: 0 });

    expect(fake.state.refunds).toHaveLength(1);
    expect(fake.state.refunds[0].amount).toBe(order.totalCents);
    expect(fake.state.transfers).toHaveLength(0); // the platform never paid out
    const refunded = await reloadOrder(order.id);
    expect(refunded.status).toBe("cancelled");
    expect(refunded.cancellationReason).toBe("not_delivered_in_time");
    expect(refunded.fundsState).toBe("refunded");
    expect(refunded.autoRefundedAt).toBeTruthy();

    const toBuyer = await feed(buyer, "order_auto_refunded");
    expect(toBuyer).toHaveLength(1);
    expect(toBuyer[0].title).toBe(`You've been refunded $${(order.totalCents / 100).toFixed(2)}`);
    expect(await feed(seller, "order_auto_refunded_seller")).toHaveLength(1);

    // The buyer sees the refunded state.
    const view = await loadBuyerDelivery(order.id, refunded);
    expect(view.autoRefund).toMatchObject({ partial: false, label: "Refunded, not delivered in time", refundedCents: order.totalCents });
  });

  it("is idempotent: re-running, or two sweeps at once, refunds exactly once", async () => {
    const { order } = await place();
    await ship(order.id);
    const [a, b] = await Promise.all([sweep(at(16)), sweep(at(16))]);
    expect(a.refunded + b.refunded).toBeGreaterThanOrEqual(1);
    await sweep(at(17));
    await sweep(at(30));
    expect(fake.state.refunds).toHaveLength(1);
    expect(fake.state.refundKeys.size).toBe(1);
    expect((await reloadOrder(order.id)).refundedCents).toBe(order.totalCents);
  });

  it("covers lost tracking: a parcel with no scans at all is refunded at the deadline", async () => {
    const { order } = await place();
    await ship(order.id); // label scanned once, then nothing
    await sweep(at(15, 2));
    expect(fake.state.refunds).toHaveLength(1);
  });

  it("an unshipped order is refunded too, and the seller can no longer ship it", async () => {
    const { order, seller } = await place();
    await sweep(at(15, 2));
    expect((await reloadOrder(order.id)).status).toBe("cancelled");
    const shipped = await call(app.base, "PATCH", `/api/orders/${order.id}/tracking`, seller, { trackingNumber: "1ZLATE", carrier: "UPS" });
    expect(shipped.status).toBe(409);
    expect(shipped.body.code).toBe("AUTO_REFUNDED");
    const status = await call(app.base, "PATCH", `/api/orders/${order.id}/status`, seller, { status: "shipped" });
    expect(status.status).toBe(409);
    expect(status.body.code).toBe("AUTO_REFUNDED");
  });

  it("does nothing for a cancelled order", async () => {
    const { order } = await place();
    await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, order.id));
    expect((await sweep(at(20))).checked).toBe(0);
    expect(fake.state.refunds).toHaveLength(0);
  });

  it("takes one last look at the carrier, so a parcel delivered minutes ago is not refunded", async () => {
    const { order } = await place();
    const tracking = await ship(order.id);
    const result = await sweep(at(15, 1), {
      checkCarrier: async (orderId) => carrierDelivers(orderId, tracking, at(15, 0)),
    });
    expect(result.refunded).toBe(0);
    expect(fake.state.refunds).toHaveLength(0);
    expect((await reloadOrder(order.id)).status).toBe("delivered");
  });
});

describe("60-day automatic refund (pre-order)", () => {
  it("waits 60 days, then refunds", async () => {
    const { order } = await place({ lines: [{ price: 8000, preorder: true, shipDate: at(40) }] });
    await ship(order.id);
    expect((await sweep(at(16))).checked).toBe(0);
    expect((await sweep(at(59, 23))).checked).toBe(0);
    expect(fake.state.refunds).toHaveLength(0);
    expect((await sweep(at(60, 1))).refunded).toBe(1);
    expect(fake.state.refunds[0].amount).toBe(order.totalCents);
    expect(fake.state.transfers).toHaveLength(0);
  });

  it("one order with both kinds refunds the regular item at 15 days and the pre-order item at 60", async () => {
    const { order } = await place({ lines: [{ price: 3000 }, { price: 2000, preorder: true }], shippingCents: 500 });
    await ship(order.id);
    const day15 = await sweep(at(15, 1));
    expect(day15.partial).toBe(1);
    expect(fake.state.refunds[0].amount).toBe(Math.floor((order.totalCents * 3000) / 5000));
    const mid = await reloadOrder(order.id);
    expect(mid.status).toBe("shipped"); // the pre-order item is still in its window
    expect(mid.deliverBy!.toISOString()).toBe(at(60).toISOString());

    const day60 = await sweep(at(60, 1));
    expect(day60.refunded).toBe(1);
    expect(fake.state.refunds).toHaveLength(2);
    expect(fake.state.refunds[0].amount + fake.state.refunds[1].amount).toBe(order.totalCents); // not a cent stranded
    expect((await reloadOrder(order.id)).status).toBe("cancelled");
  });
});

describe("partial shipment", () => {
  it("refunds only the undelivered items; the delivered ones still pay the seller", async () => {
    const { order, seller } = await place({ lines: [{ price: 3000 }, { price: 2000 }], shippingCents: 500 });
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const a = items.find((i) => i.priceCents === 3000)!;
    const b = items.find((i) => i.priceCents === 2000)!;

    vi.setSystemTime(at(2));
    const shipped = await shipItems({ orderId: order.id, ownerId: seller, itemIds: [a.id], trackingNumber: "1ZPART-A", carrier: "UPS" });
    expect(shipped.ok).toBe(true);
    await carrierDelivers(order.id, "1ZPART-A", at(6));
    let mid = await reloadOrder(order.id);
    expect(mid.status).toBe("shipped"); // B hasn't arrived, so the order isn't delivered
    expect(mid.deliveredAt).toBeNull();

    const result = await sweep(at(15, 1));
    expect(result).toMatchObject({ partial: 1, refunded: 0 });
    expect(fake.state.refunds).toHaveLength(1);
    expect(fake.state.refunds[0].amount).toBe(Math.floor((order.totalCents * 2000) / 5000));

    const after = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(after.find((i) => i.id === b.id)!.refundedAt).toBeTruthy();
    expect(after.find((i) => i.id === a.id)!.refundedAt).toBeNull();

    // Only A is left and it was delivered: the order completes and the payout clock starts.
    mid = await reloadOrder(order.id);
    expect(mid.status).toBe("delivered");
    expect(mid.autoRefundedAt).toBeTruthy();
    // A arrived on day 6, so its buffer is long over: its share is paid at the next payout sweep.
    expect(await sweepTransferOrders({ now: at(16) })).toBe(1);
  });

  it("the payout for what was delivered equals the seller's share net of the refunded item", async () => {
    const { order, seller } = await place({ lines: [{ price: 3000 }, { price: 2000 }] });
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const a = items.find((i) => i.priceCents === 3000)!;
    vi.setSystemTime(at(1));
    await shipItems({ orderId: order.id, ownerId: seller, itemIds: [a.id], trackingNumber: "1ZPART-PAY", carrier: "UPS" });
    await carrierDelivers(order.id, "1ZPART-PAY", at(2));
    await sweep(at(15, 1)); // B refunded
    const before = await reloadOrder(order.id);
    expect(before.payoutReleaseAt!.toISOString()).toBe(at(5).toISOString());
    // The sweep at day 15 already finds the buffer over and pays A's share.
    await sweepTransferOrders({ now: at(15, 2) });
    expect(fake.state.transfers).toHaveLength(1);
    expect(fake.state.transfers[0].amount).toBeGreaterThan(0);
    expect(fake.state.transfers[0].amount).toBeLessThan(before.sellerNetCents);
  });

  it("the seller cannot ship an item that was already delivered or refunded", async () => {
    const { order, seller } = await place({ lines: [{ price: 3000 }, { price: 2000 }] });
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    await shipItems({ orderId: order.id, ownerId: seller, itemIds: [items[0].id], trackingNumber: "1ZX", carrier: "UPS" });
    await carrierDelivers(order.id, "1ZX", at(3));
    const again = await shipItems({ orderId: order.id, ownerId: seller, itemIds: [items[0].id], trackingNumber: "1ZY", carrier: "UPS" });
    expect(again).toMatchObject({ ok: false, code: "ITEM_NOT_SHIPPABLE" });
    const other = await shipItems({ orderId: order.id, ownerId: "someone-else", itemIds: [items[1].id], trackingNumber: "1ZZ", carrier: "UPS" });
    expect(other).toMatchObject({ ok: false, status: 404 });
  });
});

describe("open dispute pauses the auto-refund", () => {
  it("holds the refund (and the payout) while the chargeback is open, and resumes when it is won", async () => {
    const { order, buyer } = await place();
    await ship(order.id);
    await applyDisputePause(order.id, "needs_response");
    expect((await reloadOrder(order.id)).disputePausedAt).toBeTruthy();
    expect(await feed(buyer, "order_refund_paused")).toHaveLength(1);

    expect((await sweep(at(20))).checked).toBe(0);
    expect(fake.state.refunds).toHaveLength(0);

    await applyDisputePause(order.id, "won");
    expect((await reloadOrder(order.id)).disputePausedAt).toBeNull();
    expect((await sweep(at(20, 1))).refunded).toBe(1);
    expect(fake.state.refunds).toHaveLength(1);
  });

  it("a lost dispute keeps the pause: the bank already took the money back", async () => {
    const { order } = await place();
    await ship(order.id);
    await applyDisputePause(order.id, "needs_response");
    await applyDisputePause(order.id, "lost");
    expect((await sweep(at(30))).checked).toBe(0);
    expect(fake.state.refunds).toHaveLength(0);
  });

  it("a delivered order with an open dispute is not paid out", async () => {
    const { order } = await place();
    const tracking = await ship(order.id);
    await carrierDelivers(order.id, tracking, at(2));
    await applyDisputePause(order.id, "under_review");
    expect(await sweepTransferOrders({ now: at(30) })).toBe(0);
    expect(fake.state.transfers).toHaveLength(0);
    await applyDisputePause(order.id, "won");
    expect(await sweepTransferOrders({ now: at(30) })).toBe(1);
  });
});

describe("hold-until-delivered payout", () => {
  it("blocks the payout while a return is open", async () => {
    const { order, buyer, seller } = await place();
    const tracking = await ship(order.id);
    await carrierDelivers(order.id, tracking, at(2));
    await db.insert(returns).values({
      id: uid("ret"), orderId: order.id, buyerId: buyer, sellerId: seller, reason: "too_small", status: "pending",
    });
    expect(await sweepTransferOrders({ now: at(20) })).toBe(0);
    await db.update(returns).set({ status: "denied" }).where(eq(returns.orderId, order.id));
    expect(await sweepTransferOrders({ now: at(20) })).toBe(1);
  });

  it("never pays a seller for an order that is shipped but undelivered", async () => {
    const { order } = await place();
    await ship(order.id);
    expect(await sweepTransferOrders({ now: at(14) })).toBe(0);
    expect(fake.state.transfers).toHaveLength(0);
  });

  it("PAYOUT_MODE=immediate is the documented opt-out: the seller is paid at checkout", async () => {
    process.env.PAYOUT_MODE = "immediate";
    try {
      const { order } = await place();
      await sweepTransferOrders({ now: at(0, 1) });
      expect((await reloadOrder(order.id)).fundsState).toBe("released");
      expect(fake.state.transfers).toHaveLength(1);
    } finally {
      process.env.PAYOUT_MODE = "hold";
    }
  });

  it("pays a shipping label from the order's held funds: the platform fronts nothing and the transfer is net of it", async () => {
    const { order, seller } = await place();
    const label = await buyLabel(order.id, seller, 800);
    const tracking = await ship(order.id);
    await carrierDelivers(order.id, tracking, at(4));

    expect(await ledgerKinds(order.id)).toContain("label_paid_from_held");
    expect(await ledgerKinds(order.id)).not.toContain("label_advanced");
    expect(await recoverLabelCost(label.id)).toBe("skipped"); // nothing to claw back from the seller

    expect(await sweepTransferOrders({ now: at(7, 1) })).toBe(1);
    expect(fake.state.transfers[0].amount).toBe(order.sellerNetCents - 800);
    expect(fake.state.reversals).toHaveLength(0);
  });

  it("an auto-refund after a release would claw back from the seller — which hold mode prevents", async () => {
    // In hold mode nothing is released before delivery, so there is nothing to claw back.
    const { order } = await place();
    await ship(order.id);
    await sweep(at(16));
    expect(fake.state.reversals).toHaveLength(0);
    expect(fake.state.transfers).toHaveLength(0);
  });
});

describe("multi-seller carts", () => {
  it("each seller's order has its own deadline and outcome", async () => {
    const buyer = await seedBuyer("cart");
    const a = await place({ buyer, paidAt: at(0) });
    const b = await place({ buyer, paidAt: at(5) });
    const trackingB = await ship(b.order.id);
    await ship(a.order.id);
    await carrierDelivers(b.order.id, trackingB, at(10));

    const result = await sweep(at(15, 1));
    expect(result.refunded).toBe(1);
    expect((await reloadOrder(a.order.id)).status).toBe("cancelled");
    expect((await reloadOrder(b.order.id)).status).toBe("delivered");
    expect(fake.state.refunds).toHaveLength(1);
    expect((await reloadOrder(b.order.id)).deliverBy!.toISOString()).toBe(at(20).toISOString());
  });
});

describe("refund failure", () => {
  it("retries with back-off, alerts from the 3rd failure, and finally succeeds without a double refund", async () => {
    const errors = vi.spyOn(logger, "error");
    const { order } = await place();
    await ship(order.id);

    fake.state.failNextRefund = "definitive";
    let r = await sweep(at(16));
    expect(r).toMatchObject({ failed: 1, refunded: 0 });
    let row = await reloadOrder(order.id);
    expect(row.autoRefundAttempts).toBe(1);
    expect(row.autoRefundLastError).toBeTruthy();
    expect(row.autoRefundNextAttemptAt!.valueOf()).toBe(at(16).valueOf() + 10 * 60_000);
    expect(errors).toHaveBeenCalled();

    expect((await sweep(at(16, 0.05))).checked).toBe(0); // backing off

    fake.state.failNextRefund = "definitive";
    r = await sweep(at(16, 1));
    expect(r.failed).toBe(1);
    expect((await reloadOrder(order.id)).autoRefundAttempts).toBe(2);
    expect(errors.mock.calls.some(([ctx]) => (ctx as any)?.alert === "auto_refund_stuck")).toBe(false);

    fake.state.failNextRefund = "definitive";
    r = await sweep(at(16, 6));
    expect(r.failed).toBe(1);
    expect((await reloadOrder(order.id)).autoRefundAttempts).toBe(3);
    expect(errors.mock.calls.some(([ctx]) => (ctx as any)?.alert === "auto_refund_stuck")).toBe(true);

    r = await sweep(at(17, 12));
    expect(r.refunded).toBe(1);
    expect(fake.state.refunds).toHaveLength(1);
    const done = await reloadOrder(order.id);
    expect(done.status).toBe("cancelled");
    expect(done.autoRefundAttempts).toBe(0);
    expect(done.autoRefundLastError).toBeNull();
  });

  it("an ambiguous Stripe failure retries with the same key and still refunds once", async () => {
    const { order } = await place();
    await ship(order.id);
    fake.state.failNextRefund = "ambiguous";
    expect((await sweep(at(16))).failed).toBe(1);
    const retry = await sweep(at(16, 2));
    expect(retry.refunded).toBe(1);
    expect(fake.state.refunds).toHaveLength(1);
  });
});

describe("seller warnings", () => {
  it("warns at 5 days, 2 days and 12 hours, once each, only while items have no tracking", async () => {
    const { order, seller } = await place();
    vi.setSystemTime(at(9));
    expect(await runDeadlineWarnings(at(9))).toBe(0); // 6 days left
    expect(await runDeadlineWarnings(at(10, 1))).toBe(1); // 4d23h left
    expect(await runDeadlineWarnings(at(10, 2))).toBe(0); // same tier, already sent
    expect(await runDeadlineWarnings(at(13, 1))).toBe(1); // <2 days
    expect(await runDeadlineWarnings(at(14, 1))).toBe(0); // 35h left: still the 2-day tier
    expect(await runDeadlineWarnings(at(14, 13))).toBe(1); // <12h
    const warnings = await feed(seller, "order_refund_warning");
    expect(warnings).toHaveLength(3);
    expect(warnings[0].body).toContain("Ship and add tracking or this order will be auto-refunded");
    expect((await reloadOrder(order.id)).deadlineWarningLevel).toBe(3);
  });

  it("sends one warning (the current tier) if the job was down, and none once shipped", async () => {
    const { seller, order } = await place();
    expect(await runDeadlineWarnings(at(14, 13))).toBe(1);
    expect(await feed(seller, "order_refund_warning")).toHaveLength(1);

    const shipped = await place({ seller });
    await ship(shipped.order.id);
    expect(await runDeadlineWarnings(at(14, 13))).toBe(0);
    expect(order.id).not.toBe(shipped.order.id);
  });
});

describe("the seller cannot declare delivery", () => {
  it("refuses delivered via the status and tracking endpoints", async () => {
    const { order, seller } = await place();
    await ship(order.id);
    const status = await call(app.base, "PATCH", `/api/orders/${order.id}/status`, seller, { status: "delivered" });
    expect(status.status).toBe(409);
    expect(status.body.code).toBe("DELIVERY_NOT_SELLER_CONFIRMED");
    const tracking = await call(app.base, "PATCH", `/api/orders/${order.id}/tracking`, seller, { trackingStatus: "delivered" });
    expect(tracking.status).toBe(409);
    expect(tracking.body.code).toBe("DELIVERY_NOT_SELLER_CONFIRMED");
    expect((await reloadOrder(order.id)).deliveredAt).toBeNull();
  });

  it("a guaranteed order can't be marked shipped without tracking", async () => {
    const { order, seller } = await place();
    const res = await call(app.base, "PATCH", `/api/orders/${order.id}/status`, seller, { status: "shipped" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TRACKING_REQUIRED");
  });
});

describe("buyer tracking view", () => {
  it("shows the timeline, carrier events, estimate and guarantee deadline", async () => {
    const { order, buyer } = await place();
    const tracking = await ship(order.id);
    vi.setSystemTime(at(3));
    await applyShippoTrack(order.id, tracking, {
      tracking_number: tracking,
      eta: at(6).toISOString(),
      tracking_status: { status: "TRANSIT", status_details: "Out for delivery", status_date: at(3).toISOString(), location: { city: "Newark", state: "NJ" } },
      tracking_history: [{ status: "PRE_TRANSIT", status_details: "Label created", status_date: at(1).toISOString() }],
    });
    const detail = await call(app.base, "GET", `/api/buyer/orders/${order.id}`, buyer);
    expect(detail.status).toBe(200);
    const d = detail.body.delivery;
    expect(d.deliverBy).toBe(at(15).toISOString());
    expect(d.estimatedDelivery).toBe(at(6).toISOString().slice(0, 10));
    expect(d.steps.map((s: any) => `${s.key}:${s.state}`)).toEqual([
      "ordered:done", "preparing:done", "shipped:done", "out_for_delivery:current", "delivered:upcoming",
    ]);
    expect(d.events[0]).toMatchObject({ status: "out_for_delivery", location: "Newark, NJ" });
    expect(d.trackingUrl).toContain("ups.com");
    expect(d.canConfirmReceipt).toBe(true);
    expect(d.autoRefund).toBeNull();
    const list = await call(app.base, "GET", "/api/buyer/orders", buyer);
    expect(list.body.find((o: any) => o.id === order.id).delivery.deliverBy).toBe(at(15).toISOString());
    // The buyer was told it is out for delivery.
    expect(await feed(buyer, "order_out_for_delivery")).toHaveLength(1);
  });
});

describe("recordDelivery", () => {
  it("is a no-op on a refunded order and never resurrects it", async () => {
    const { order } = await place();
    await ship(order.id);
    await sweep(at(16));
    const res = await recordDelivery({ orderId: order.id, source: "carrier", at: at(17) });
    expect(res).toMatchObject({ changed: false, blocked: "cancelled" });
    expect((await reloadOrder(order.id)).status).toBe("cancelled");
  });
});

describe("seller-typed tracking must match the order's destination (BT-070)", () => {
  async function deliveredScan(orderId: string, tracking: string, addressTo: Record<string, string> | null) {
    await db.update(orders).set({ shippingAddress: BROOKLYN }).where(eq(orders.id, orderId));
    vi.setSystemTime(at(5));
    await applyShippoTrack(orderId, tracking, {
      tracking_number: tracking,
      tracking_status: { status: "DELIVERED", status_details: "Delivered", status_date: at(5).toISOString() },
      ...(addressTo ? { address_to: addressTo } : {}),
    });
  }

  it("a delivered scan to another ZIP does not deliver the order and flags it", async () => {
    const { order } = await place();
    const tracking = await ship(order.id);
    await deliveredScan(order.id, tracking, { city: "Austin", state: "TX", zip: "73301" });
    const after = await reloadOrder(order.id);
    expect(after.deliveredAt).toBeNull();
    expect(after.payoutReleaseAt).toBeNull();
    expect((after.riskFlags ?? []).map((f: any) => f.code)).toContain("tracking_destination_mismatch");
  });

  it("a delivered scan with no destination data waits for the buyer", async () => {
    const { order, buyer } = await place();
    const tracking = await ship(order.id);
    await deliveredScan(order.id, tracking, null);
    expect((await reloadOrder(order.id)).deliveredAt).toBeNull();
    const confirmed = await call(app.base, "POST", `/api/buyer/orders/${order.id}/confirm-receipt`, buyer, {});
    expect(confirmed.status).toBe(200);
    const after = await reloadOrder(order.id);
    expect(after.deliveredAt).not.toBeNull();
    expect(after.deliveryConfirmedBy).toBe("buyer");
  });

  it("a matching ZIP+4 is accepted", async () => {
    const { order } = await place();
    const tracking = await ship(order.id);
    await deliveredScan(order.id, tracking, { city: "BROOKLYN", state: "NY", zip: "11201-4410" });
    expect((await reloadOrder(order.id)).deliveredAt).not.toBeNull();
  });
});
