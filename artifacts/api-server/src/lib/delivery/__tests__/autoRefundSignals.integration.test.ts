/**
 * Automatic non-delivery refunds need a "not delivered" signal, and pre-order
 * deadlines follow the promised ship date — real Postgres, in-memory Stripe,
 * mocked clock:
 *
 *  - a parcel the carrier scanned in transit, with no delivered scan, is NOT
 *    refunded at the deadline; the buyer's "not received" request (the
 *    existing POST /api/returns) makes the next sweep refund it and closes
 *    the request;
 *  - never shipped, shipped with no carrier scan at all (label data only),
 *    and a carrier failure / return to sender are refunded at the deadline;
 *  - a pre-order is due 15 days after its promised ship date (capped at 180
 *    days from purchase), and too-distant ship dates / drop deadlines are
 *    refused.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("../../money/__tests__/fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../push")>()),
  sendPushToUser: async () => {},
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

import { db, orderItems, orders, products, returns } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { fake } from "../../money/__tests__/fakeStripe";
import { call, expectLedgerBalanced, pay, reloadOrder, seedBuyer, seedProduct, seedSeller, startApp, uid } from "../../money/__tests__/moneyHarness";
import { runAutoRefundSweep } from "../autoRefund";
import { applyShippoTrack } from "../trackingSync";
import { validatePreorderListing } from "../policy";
import { validateFulfillmentDeadline, validatePreorderShipDate } from "../../money/dropLifecycle";
import returnsRouter from "../../../routes/returns";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = new Date("2026-05-01T12:00:00Z");
const at = (days: number, hours = 0) => new Date(T0.valueOf() + days * DAY + hours * HOUR);

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  process.env.PAYOUT_MODE = "hold";
  app = await startApp((server) => server.use("/api/returns", returnsRouter));
});
afterAll(async () => {
  await app.close();
  await expectLedgerBalanced();
});
beforeEach(async () => {
  // The sweep is global: park every order other tests left behind.
  await db.update(orders).set({ status: "cancelled" }).where(sql`${orders.ownerId} LIKE 'money-seller-%'`);
  fake.reset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

async function place(options: { preorderShipDate?: Date } = {}) {
  const seller = await seedSeller("ars");
  const buyer = await seedBuyer("ars");
  const product = await seedProduct(seller, { priceCents: 5000 });
  if (options.preorderShipDate) {
    await db.update(products).set({ isPreOrder: true, preOrderEstShipDate: options.preorderShipDate })
      .where(eq(products.id, product.productId));
  }
  vi.setSystemTime(T0);
  const { order } = await pay({
    sellerId: seller, buyerId: buyer, chargeModel: "transfer",
    items: [{ variantId: product.variantId, productName: product.productName, priceCents: 5000, quantity: 1 }],
  });
  return { seller, buyer, order };
}

async function ship(orderId: string) {
  const trackingNumber = `1Z${uid("trk")}`;
  await db.update(orders).set({ trackingNumber, carrier: "UPS", status: "shipped", shippedAt: new Date(), trackingStatus: "accepted" })
    .where(eq(orders.id, orderId));
  await db.update(orderItems).set({ trackingNumber, carrier: "UPS", shippedAt: new Date(), trackingStatus: "accepted" })
    .where(eq(orderItems.orderId, orderId));
  return trackingNumber;
}

async function carrier(orderId: string, trackingNumber: string, status: string, when: Date, details = "") {
  vi.setSystemTime(when);
  await applyShippoTrack(orderId, trackingNumber, {
    tracking_number: trackingNumber,
    tracking_status: { status, status_details: details, status_date: when.toISOString(), location: { city: "Austin", state: "TX" } },
    tracking_history: [],
  } as any);
}

async function sweep(when: Date) {
  vi.setSystemTime(when);
  return runAutoRefundSweep({ now: when });
}

describe("auto-refund needs a 'not delivered' signal", () => {
  it("does not refund an in-transit parcel at the deadline; the buyer's 'not received' request does", async () => {
    const { order, buyer } = await place();
    const tracking = await ship(order.id);
    await carrier(order.id, tracking, "TRANSIT", at(3), "Departed facility");

    const atDeadline = await sweep(at(16));
    expect(atDeadline.refunded).toBe(0);
    expect(fake.state.refunds).toHaveLength(0);
    expect((await reloadOrder(order.id)).status).toBe("shipped");

    // The buyer reports it never arrived, through the existing return request.
    vi.setSystemTime(at(17));
    const claim = await call(app.base, "POST", "/api/returns", buyer, { orderId: order.id, reason: "Order not received" });
    expect(claim.status).toBe(201);

    const afterClaim = await sweep(at(17, 1));
    expect(afterClaim.refunded).toBe(1);
    expect(fake.state.refunds).toHaveLength(1);
    expect(fake.state.refunds[0].amount).toBe(order.totalCents);
    expect((await reloadOrder(order.id)).status).toBe("cancelled");
    const [closed] = await db.select().from(returns).where(eq(returns.orderId, order.id));
    expect(closed.status).toBe("refunded");
    expect(closed.refundAmountCents).toBe(order.totalCents);
  });

  it("a claim before the deadline still waits for the deadline", async () => {
    const { order, buyer } = await place();
    const tracking = await ship(order.id);
    await carrier(order.id, tracking, "TRANSIT", at(3), "In transit");
    vi.setSystemTime(at(10));
    expect((await call(app.base, "POST", "/api/returns", buyer, { orderId: order.id, reason: "Order not received" })).status).toBe(201);
    expect((await sweep(at(14))).checked).toBe(0);
    expect((await sweep(at(15, 1))).refunded).toBe(1);
  });

  it("refunds a never-shipped order at the deadline", async () => {
    const { order } = await place();
    expect((await sweep(at(14, 23))).checked).toBe(0);
    expect((await sweep(at(15, 1))).refunded).toBe(1);
    expect(fake.state.refunds[0].amount).toBe(order.totalCents);
  });

  it("refunds a 'shipped' order the carrier never scanned (label data only)", async () => {
    const { order } = await place();
    const tracking = await ship(order.id);
    await carrier(order.id, tracking, "PRE_TRANSIT", at(1), "Shipping label created");
    expect((await sweep(at(15, 1))).refunded).toBe(1);
    expect((await reloadOrder(order.id)).status).toBe("cancelled");
  });

  it("refunds when the carrier reports a failure", async () => {
    const { order } = await place();
    const tracking = await ship(order.id);
    await carrier(order.id, tracking, "TRANSIT", at(2), "In transit");
    await carrier(order.id, tracking, "FAILURE", at(8), "Package lost");
    expect((await sweep(at(15, 1))).refunded).toBe(1);
  });

  it("refunds when the carrier is returning it to the sender", async () => {
    const { order } = await place();
    const tracking = await ship(order.id);
    await carrier(order.id, tracking, "TRANSIT", at(2), "In transit");
    await carrier(order.id, tracking, "RETURNED", at(9), "Return to sender");
    expect((await sweep(at(15, 1))).refunded).toBe(1);
  });

  it("a delivery-problem scan before the deadline is not a refund by itself", async () => {
    const { order } = await place();
    const tracking = await ship(order.id);
    await carrier(order.id, tracking, "FAILURE", at(5), "Weather delay");
    expect((await sweep(at(14))).checked).toBe(0);
  });
});

describe("pre-order deadline follows the promised ship date", () => {
  it("is the ship date + 15 days, and refunds only after that", async () => {
    const { order } = await place({ preorderShipDate: at(100) });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(item.isPreorder).toBe(true);
    expect(item.deliverBy!.toISOString()).toBe(at(115).toISOString());
    expect((await reloadOrder(order.id)).deliverBy!.toISOString()).toBe(at(115).toISOString());

    // The old fixed 60-day window would have refunded here.
    expect((await sweep(at(61))).checked).toBe(0);
    expect((await sweep(at(115, 1))).refunded).toBe(1);
  });

  it("never runs past 180 days from purchase", async () => {
    const { order } = await place({ preorderShipDate: at(200) });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(item.deliverBy!.toISOString()).toBe(at(180).toISOString());
  });

  it("refuses ship dates and drop deadlines that can't be delivered within 180 days", () => {
    const now = T0;
    expect(validatePreorderListing({
      effectiveIsPreorder: true, suppliedShipDate: at(166).toISOString(), effectiveShipDate: at(166), now,
    })?.code).toBe("PREORDER_SHIP_DATE_TOO_FAR");
    expect(validatePreorderListing({
      effectiveIsPreorder: true, suppliedShipDate: at(165).toISOString(), effectiveShipDate: at(165), now,
    })).toBeNull();
    expect(validatePreorderShipDate(at(166), now)).toMatch(/at most 165 days/);
    expect(validatePreorderShipDate(at(100), now)).toBeNull();
    expect(validateFulfillmentDeadline(at(170), now)).toMatch(/at most 165 days/);
    expect(validateFulfillmentDeadline(at(160), now)).toBeNull();
  });
});
