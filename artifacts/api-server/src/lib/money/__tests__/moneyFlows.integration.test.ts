/**
 * End-to-end money flows against real Postgres with a fake (test-mode) Stripe:
 * checkout → ledger, per-order release, labels and bulk from held funds,
 * refunds (partial/full/duplicate), failed drops, multi-seller carts, and the
 * ledger's own guarantees. Every scenario ends by proving the ledger balances.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { db, drops, orderRefunds, orderReleases, orders, productVariants, sampleOrders } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { fake } from "./fakeStripe";
import {
  buyLabel, call, expectLedgerBalanced, expectWalletMatchesLedger, held, ledgerKinds, orderLedger, paidOut, pay,
  reloadOrder, seedBulkOrder, seedBuyer, seedDrop, seedManufacturer, seedProduct, seedSeller, setTracking,
  startApp, waitFor, walletFor,
} from "./moneyHarness";
import { executeOrderRelease, releaseOrderFunds, RELEASE_LEASE_MS, sweepOrderReleases } from "../escrow";
import { refundOrder, RefundError } from "../refunds";
import { runMoneySweep } from "../dropLifecycle";
import { CheckoutPlanError, resolveChargePlan } from "../checkoutPlan";
import sampleOrdersRouter from "../../../routes/sample-orders";
import ordersRouter from "../../../routes/orders";
import buyerRouter from "../../../routes/buyer";
import returnsRouter from "../../../routes/returns";
import dropWalletRouter from "../../../routes/drop-wallet";
import dropsRouter from "../../../routes/drops";
import financeRouter from "../../../routes/finance";

let app: { base: string; close: () => Promise<void> };

beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/sample-orders", sampleOrdersRouter);
    server.use("/api/orders", ordersRouter);
    server.use("/api/buyer", buyerRouter);
    server.use("/api/returns", returnsRouter);
    server.use("/api/drop-wallets", dropWalletRouter);
    server.use("/api/drops", dropsRouter);
    server.use("/api/finance", financeRouter);
  });
});
afterAll(async () => {
  await expectLedgerBalanced();
  await app?.close();
});
beforeEach(() => fake.reset());

describe("checkout → order money", () => {
  it("pays an in-stock order straight to the seller, keeping 5% + the processing estimate", async () => {
    const seller = await seedSeller("direct");
    const buyer = await seedBuyer("direct");
    const product = await seedProduct(seller, { priceCents: 5_000 });
    const { order, fee } = await pay({
      sellerId: seller, buyerId: buyer, chargeModel: "destination",
      items: [{ ...product, quantity: 2 }], shippingCents: 500, taxCents: 800, stripeFeeCents: 358,
    });

    expect(fee).toEqual({ platformFeeCents: 500, processingFeeEstimateCents: 335, applicationFeeCents: 835 });
    expect(order).toMatchObject({
      chargeModel: "destination",
      fundsState: "settled_direct",
      grossChargedCents: 11_300,
      platformFeeCents: 500,
      processingFeeChargedCents: 335,
      processingFeeCents: 358,
      sellerNetCents: 10_465,
      stripeChargeId: `ch_${order.stripePaymentIntentId}`,
      stripeTransferId: `tr_dest_${order.stripePaymentIntentId}`,
    });
    expect(await orderLedger(order.id)).toEqual({
      buyer_payments: -11_300,
      seller_paid_out: 10_465,
      platform_revenue: 500,
      stripe_processing_fees: 358,
      processing_fee_variance: -23,
    });
    await expectLedgerBalanced();
  });

  it("holds a preorder on Brandthread, net of 5% and Stripe's exact fee", async () => {
    const seller = await seedSeller("held");
    const buyer = await seedBuyer("held");
    const drop = await seedDrop(seller);
    const product = await seedProduct(seller, { priceCents: 4_000, dropId: drop.id });
    const { order } = await pay({
      sellerId: seller, buyerId: buyer, chargeModel: "held", dropId: drop.id,
      items: [{ ...product, quantity: 1 }], stripeFeeCents: 146,
    });

    expect(order).toMatchObject({
      chargeModel: "held", fundsState: "held", dropId: drop.id,
      platformFeeCents: 200, processingFeeCents: 146, sellerNetCents: 3_654,
    });
    expect(await held(seller, { dropId: drop.id })).toBe(3_654);
    const wallet = await walletFor(drop.id);
    expect(wallet).toMatchObject({ balanceCents: 3_654, releasedCents: 0, sellerId: seller });
    const [updatedDrop] = await db.select().from(drops).where(eq(drops.id, drop.id));
    expect(updatedDrop).toMatchObject({ orderCount: 1, totalCollectedCents: 4_000 });
    // Nothing was transferred: the money stays held.
    expect(fake.state.transfers).toHaveLength(0);
    await expectWalletMatchesLedger(drop.id, seller);
  });

  it("creates exactly one order and one ledger entry when the webhook is replayed", async () => {
    const seller = await seedSeller("replay");
    const buyer = await seedBuyer("replay");
    const product = await seedProduct(seller, { priceCents: 2_500 });
    const { order, session } = await pay({
      sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }],
    });
    const { handleCheckoutPaid } = await import("../../../routes/webhooks");
    await handleCheckoutPaid(session, "evt_replay_again", new Date());
    await handleCheckoutPaid(session, "evt_replay_third", new Date());

    const matching = await db.select({ id: orders.id }).from(orders)
      .where(eq(orders.stripeCheckoutSessionId, session.id));
    expect(matching).toHaveLength(1);
    expect(await ledgerKinds(order.id)).toEqual(["order_paid_direct"]);
  });

  it("refunds an oversold order through the refund service, pulling the seller's share back", async () => {
    const seller = await seedSeller("oversold");
    const buyer = await seedBuyer("oversold");
    const product = await seedProduct(seller, { priceCents: 3_000, stock: 0 });
    const { order } = await pay({
      sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }],
    });
    const current = await reloadOrder(order.id);
    expect(current).toMatchObject({ status: "cancelled", cancellationReason: "out_of_stock", fundsState: "refunded" });
    expect(fake.state.refunds).toHaveLength(1);
    expect(fake.state.refunds[0]).toMatchObject({ amount: 3_000, reverse_transfer: true, refund_application_fee: false });
  });
});

describe("per-order release of held preorder funds", () => {
  it("pays the bulk order from held funds and releases each order only when it has tracking", async () => {
    const seller = await seedSeller("release");
    const drop = await seedDrop(seller);
    const buyers = await Promise.all(["a", "b", "c"].map((tag) => seedBuyer(`release-${tag}`)));
    const [p1, p2, p3] = await Promise.all([5_000, 3_000, 2_000].map((price) =>
      seedProduct(seller, { priceCents: price, dropId: drop.id })));
    const o1 = (await pay({ sellerId: seller, buyerId: buyers[0], chargeModel: "held", dropId: drop.id, items: [{ ...p1, quantity: 1 }], stripeFeeCents: 175 })).order;
    const o2 = (await pay({ sellerId: seller, buyerId: buyers[1], chargeModel: "held", dropId: drop.id, items: [{ ...p2, quantity: 1 }], stripeFeeCents: 117 })).order;
    const o3 = (await pay({ sellerId: seller, buyerId: buyers[2], chargeModel: "held", dropId: drop.id, items: [{ ...p3, quantity: 1 }], stripeFeeCents: 88 })).order;
    expect([o1.sellerNetCents, o2.sellerNetCents, o3.sellerNetCents]).toEqual([4_575, 2_733, 1_812]);
    expect(await held(seller, { dropId: drop.id })).toBe(9_120);

    // The seller pays the manufacturer's bulk card from the held funds.
    const manufacturer = await seedManufacturer();
    const bulk = await seedBulkOrder(seller, manufacturer.id, 6_000);
    const wallet = await walletFor(drop.id);
    const paid = await call(app.base, "POST", `/api/sample-orders/${bulk.id}/pay-from-wallet`, seller, { walletId: wallet.id });
    expect(paid.status).toBe(200);
    expect(fake.state.transfers).toHaveLength(1);
    expect(fake.state.transfers[0]).toMatchObject({ amount: 6_000, destination: manufacturer.stripeAccountId });
    expect(await held(seller, { dropId: drop.id })).toBe(3_120);
    expect((await db.select().from(drops).where(eq(drops.id, drop.id)))[0].escrowState).toBe("production");

    // No tracking yet → nothing moves.
    expect((await releaseOrderFunds(o1.id, "manual")).status).toBe("no_tracking");

    // Order 2 gets an in-app label (paid from ITS held money); its tracking
    // number releases only order 2's remaining share.
    await buyLabel(o2.id, seller, 800);
    const r2 = await releaseOrderFunds(o2.id, "label");
    expect(r2.execution).toMatchObject({ state: "paid", amountCents: 539 });
    const [release2] = await db.select().from(orderReleases).where(eq(orderReleases.orderId, o2.id));
    expect(release2).toMatchObject({ labelCents: 800, bulkShareCents: 1_394, amountCents: 539, state: "paid" });
    const transfer2 = fake.state.transfers[1];
    expect(transfer2).toMatchObject({
      amount: 539,
      source_transaction: o2.stripeChargeId,
      transfer_group: `drop_${drop.id}`,
      idempotencyKey: `order-release/${o2.id}/1`,
    });
    expect((await reloadOrder(o1.id)).fundsState).toBe("held");
    expect((await reloadOrder(o3.id)).fundsState).toBe("held");
    expect((await db.select().from(drops).where(eq(drops.id, drop.id)))[0].escrowState).toBe("fulfilling");

    // Retrying never pays twice.
    expect((await releaseOrderFunds(o2.id, "manual")).status).toBe("exists");
    expect(fake.state.transfers).toHaveLength(2);

    await setTracking(o1.id);
    expect((await releaseOrderFunds(o1.id, "tracking")).execution).toMatchObject({ state: "paid", amountCents: 1_276 });

    // Selling closes; the last order takes the exact remaining bulk cost and
    // the drop completes itself.
    await db.update(drops).set({ status: "closed" }).where(eq(drops.id, drop.id));
    await setTracking(o3.id);
    expect((await releaseOrderFunds(o3.id, "tracking")).execution).toMatchObject({ state: "paid", amountCents: 505 });

    const releases = await db.select().from(orderReleases).where(eq(orderReleases.dropId, drop.id));
    expect(releases.reduce((sum, r) => sum + r.bulkShareCents, 0)).toBe(6_000);
    expect(releases.reduce((sum, r) => sum + r.amountCents, 0)).toBe(9_120 - 6_000 - 800);
    expect(await held(seller, { dropId: drop.id })).toBe(0);
    expect((await db.select().from(drops).where(eq(drops.id, drop.id)))[0].escrowState).toBe("completed");
    await expectWalletMatchesLedger(drop.id, seller);
    await expectLedgerBalanced();
  });

  it("retries a lost transfer response with the same idempotency key (never a second transfer)", async () => {
    const seller = await seedSeller("lost");
    const buyer = await seedBuyer("lost");
    const drop = await seedDrop(seller);
    const product = await seedProduct(seller, { priceCents: 1_500, dropId: drop.id });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "held", dropId: drop.id, items: [{ ...product, quantity: 1 }], stripeFeeCents: 74 });
    await setTracking(order.id);

    fake.state.loseNextTransferResponse = true;
    const first = await releaseOrderFunds(order.id, "tracking");
    expect(first.execution?.state).toBe("transferring");
    expect(fake.state.transfers).toHaveLength(1);
    expect((await reloadOrder(order.id)).fundsState).toBe("release_pending");

    // Not yet stale: a concurrent retry does nothing.
    const early = await executeOrderRelease(first.releaseId!, { reclaimStale: true });
    expect(early.state).toBe("transferring");

    await db.update(orderReleases)
      .set({ updatedAt: new Date(Date.now() - RELEASE_LEASE_MS - 1_000) })
      .where(eq(orderReleases.id, first.releaseId!));
    await sweepOrderReleases();
    expect(fake.state.transfers).toHaveLength(1);
    expect((await reloadOrder(order.id)).fundsState).toBe("released");
    expect(await paidOut(seller)).toBe(1_500 - 75 - 74);
  });

  it("records a definitive rejection as failed and retries with a new attempt key", async () => {
    const seller = await seedSeller("reject");
    const buyer = await seedBuyer("reject");
    const drop = await seedDrop(seller);
    const product = await seedProduct(seller, { priceCents: 2_000, dropId: drop.id });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "held", dropId: drop.id, items: [{ ...product, quantity: 1 }], stripeFeeCents: 88 });
    await setTracking(order.id);

    fake.state.failNextTransfer = "definitive";
    const first = await releaseOrderFunds(order.id, "tracking");
    expect(first.execution?.state).toBe("failed");
    const [failed] = await db.select().from(orderReleases).where(eq(orderReleases.orderId, order.id));
    expect(failed).toMatchObject({ state: "failed", attempt: 2, lastErrorCode: "resource_missing" });
    expect(fake.state.transfers).toHaveLength(0);

    const retry = await executeOrderRelease(first.releaseId!);
    expect(retry.state).toBe("paid");
    expect(fake.state.transfers).toHaveLength(1);
    expect(fake.state.transfers[0].idempotencyKey).toBe(`order-release/${order.id}/2`);
  });

  it("waits for a seller without a Stripe account, then the sweep pays it", async () => {
    const seller = await seedSeller("noacct", { stripeAccount: false });
    const buyer = await seedBuyer("noacct");
    const drop = await seedDrop(seller);
    const product = await seedProduct(seller, { priceCents: 1_000, dropId: drop.id });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "held", dropId: drop.id, items: [{ ...product, quantity: 1 }], stripeFeeCents: 59 });
    await setTracking(order.id);
    const first = await releaseOrderFunds(order.id, "tracking");
    expect(first.execution).toMatchObject({ state: "pending", errorCode: "SELLER_ACCOUNT_NOT_READY" });

    const { users } = await import("@workspace/db");
    const readyAccount = `acct_ready_${order.id.replace(/-/g, "")}`;
    await db.update(users).set({ stripeAccountId: readyAccount }).where(eq(users.clerkId, seller));
    await sweepOrderReleases();
    expect((await reloadOrder(order.id)).fundsState).toBe("released");
    expect(fake.state.transfers[0]).toMatchObject({ destination: readyAccount, amount: 1_000 - 50 - 59 });
  });

  it("releases through PATCH /orders/:id/tracking, and only for that order", async () => {
    const seller = await seedSeller("route-release");
    const drop = await seedDrop(seller);
    const product = await seedProduct(seller, { priceCents: 2_500, dropId: drop.id });
    const a = (await pay({ sellerId: seller, buyerId: await seedBuyer("rr-a"), chargeModel: "held", dropId: drop.id, items: [{ ...product, quantity: 1 }], stripeFeeCents: 103 })).order;
    const b = (await pay({ sellerId: seller, buyerId: await seedBuyer("rr-b"), chargeModel: "held", dropId: drop.id, items: [{ ...product, quantity: 1 }], stripeFeeCents: 103 })).order;

    const shipped = await call(app.base, "PATCH", `/api/orders/${a.id}/tracking`, seller, { trackingNumber: "1ZROUTE", carrier: "UPS" });
    expect(shipped.status).toBe(200);
    await waitFor(async () => (await reloadOrder(a.id)).fundsState === "released");
    expect(fake.state.transfers).toHaveLength(1);
    expect(fake.state.transfers[0].metadata.orderId).toBe(a.id);
    expect((await reloadOrder(b.id)).fundsState).toBe("held");

    // A preorder cannot be marked shipped without tracking.
    const noTracking = await call(app.base, "PATCH", `/api/orders/${b.id}/status`, seller, { status: "shipped" });
    expect(noTracking).toMatchObject({ status: 409, body: { code: "TRACKING_REQUIRED" } });
  });
});

describe("refunds", () => {
  it("handles partial, over-limit, duplicate and full refunds on an in-stock order", async () => {
    const seller = await seedSeller("refund-direct");
    const buyer = await seedBuyer("refund-direct");
    const product = await seedProduct(seller, { priceCents: 5_000 });
    const { order } = await pay({
      sellerId: seller, buyerId: buyer, chargeModel: "destination",
      items: [{ ...product, quantity: 2 }], shippingCents: 500, taxCents: 800,
    });

    const partial = await refundOrder({
      orderId: order.id, amountCents: 3_000, reason: "return_approved", initiatedBy: seller, idempotencyKey: `t-partial/${order.id}`,
    });
    expect(partial).toMatchObject({ amountCents: 3_000, platformFeeRefundCents: 133, duplicate: false });
    expect(fake.state.refunds[0]).toMatchObject({
      payment_intent: order.stripePaymentIntentId, amount: 3_000, reverse_transfer: true, refund_application_fee: false,
    });
    expect(fake.state.feeRefunds[0]).toMatchObject({ fee: order.stripeApplicationFeeId, amount: 133 });

    await expect(refundOrder({
      orderId: order.id, amountCents: 9_000, reason: "return_approved", initiatedBy: seller, idempotencyKey: `t-over/${order.id}`,
    })).rejects.toMatchObject({ code: "REFUND_EXCEEDS_REMAINING", status: 400 });
    expect(fake.state.refunds).toHaveLength(1);

    const duplicate = await refundOrder({
      orderId: order.id, amountCents: 3_000, reason: "return_approved", initiatedBy: seller, idempotencyKey: `t-partial/${order.id}`,
    });
    expect(duplicate.duplicate).toBe(true);
    expect(fake.state.refunds).toHaveLength(1);

    const rest = await refundOrder({
      orderId: order.id, reason: "seller_cancelled", initiatedBy: seller, idempotencyKey: `t-rest/${order.id}`,
    });
    expect(rest).toMatchObject({ amountCents: 8_300, platformFeeRefundCents: 367 });
    const after = await reloadOrder(order.id);
    expect(after).toMatchObject({ refundedCents: 11_300, platformFeeRefundedCents: 500, fundsState: "refunded" });
    // The buyer got everything back; the seller keeps nothing but bears the
    // processing estimate (Stripe does not return its fee).
    expect(await orderLedger(order.id)).toMatchObject({
      buyer_payments: 0,
      platform_revenue: 0,
      seller_paid_out: -335,
    });
    await expect(refundOrder({
      orderId: order.id, amountCents: 1, reason: "seller_cancelled", initiatedBy: seller, idempotencyKey: `t-extra/${order.id}`,
    })).rejects.toMatchObject({ code: "REFUND_EXCEEDS_REMAINING" });
  });

  it("refunds a held order before and after its release, reversing the release transfer", async () => {
    const seller = await seedSeller("refund-held");
    const buyer = await seedBuyer("refund-held");
    const drop = await seedDrop(seller);
    const product = await seedProduct(seller, { priceCents: 4_000, dropId: drop.id });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "held", dropId: drop.id, items: [{ ...product, quantity: 1 }], stripeFeeCents: 146 });

    await refundOrder({ orderId: order.id, amountCents: 1_000, reason: "return_approved", initiatedBy: seller, idempotencyKey: `h-1/${order.id}` });
    expect(fake.state.refunds[0].reverse_transfer).toBeUndefined();
    expect(await held(seller, { orderId: order.id })).toBe(3_654 - 950);

    await setTracking(order.id);
    expect((await releaseOrderFunds(order.id, "tracking")).execution).toMatchObject({ state: "paid", amountCents: 2_704 });

    await refundOrder({ orderId: order.id, reason: "return_approved", initiatedBy: seller, idempotencyKey: `h-2/${order.id}` });
    expect(fake.state.reversals).toHaveLength(1);
    expect(fake.state.reversals[0]).toMatchObject({ amount: 2_704 });
    const [release] = await db.select().from(orderReleases).where(eq(orderReleases.orderId, order.id));
    expect(release).toMatchObject({ state: "reversed", reversedCents: 2_704 });
    expect((await reloadOrder(order.id)).fundsState).toBe("refunded");
    // Stripe kept its 146¢ fee: that is the seller's shortfall on the drop.
    expect(await held(seller, { dropId: drop.id })).toBe(-146);
    await expectWalletMatchesLedger(drop.id, seller);
  });

  it("restores the order when Stripe rejects a cancellation refund", async () => {
    const seller = await seedSeller("refund-reject");
    const buyer = await seedBuyer("refund-reject");
    const product = await seedProduct(seller, { priceCents: 2_000 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] });
    await db.update(orders).set({ status: "processing" }).where(eq(orders.id, order.id));

    fake.state.failNextRefund = "definitive";
    const rejected = await call(app.base, "POST", `/api/buyer/orders/${order.id}/cancel`, buyer);
    expect(rejected.status).toBe(502);
    expect((await reloadOrder(order.id)).status).toBe("processing");
    const [attempt] = await db.select().from(orderRefunds).where(eq(orderRefunds.orderId, order.id));
    expect(attempt.state).toBe("failed");

    const retried = await call(app.base, "POST", `/api/buyer/orders/${order.id}/cancel`, buyer);
    expect(retried).toMatchObject({ status: 200, body: { cancelled: true, refunded: true } });
    const cancelled = await reloadOrder(order.id);
    expect(cancelled).toMatchObject({ status: "cancelled", cancellationReason: "buyer_requested", fundsState: "refunded" });
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, product.variantId));
    expect(variant.stock).toBe(100); // decremented at checkout, restored on cancel
  });

  it("refuses to cancel a preorder once its drop is in production", async () => {
    const seller = await seedSeller("preorder-lock");
    const buyer = await seedBuyer("preorder-lock");
    const drop = await seedDrop(seller);
    const product = await seedProduct(seller, { priceCents: 3_000, dropId: drop.id });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "held", dropId: drop.id, items: [{ ...product, quantity: 1 }] });
    await db.update(drops).set({ escrowState: "production" }).where(eq(drops.id, drop.id));
    const result = await call(app.base, "POST", `/api/buyer/orders/${order.id}/cancel`, buyer);
    expect(result).toMatchObject({ status: 409, body: { code: "PREORDER_IN_PRODUCTION" } });
    expect(fake.state.refunds).toHaveLength(0);
  });

  it("refunds on seller cancellation, and refuses to cancel a shipped order", async () => {
    const seller = await seedSeller("seller-cancel");
    const buyer = await seedBuyer("seller-cancel");
    const product = await seedProduct(seller, { priceCents: 2_200 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] });
    const cancelled = await call(app.base, "PATCH", `/api/orders/${order.id}/status`, seller, { status: "cancelled", reason: "out_of_stock" });
    expect(cancelled).toMatchObject({ status: 200, body: { status: "cancelled", fundsState: "refunded" } });
    expect(fake.state.refunds[0]).toMatchObject({ amount: 2_200, reverse_transfer: true });

    const shippedOrder = (await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] })).order;
    await db.update(orders).set({ status: "shipped" }).where(eq(orders.id, shippedOrder.id));
    const refused = await call(app.base, "PATCH", `/api/orders/${shippedOrder.id}/status`, seller, { status: "cancelled", reason: "other" });
    expect(refused).toMatchObject({ status: 409, body: { code: "ILLEGAL_STATUS_TRANSITION" } });
    const regress = await call(app.base, "PATCH", `/api/orders/${shippedOrder.id}/status`, seller, { status: "pending" });
    expect(regress.status).toBe(409);
  });

  it("refunds an approved return exactly once, capped at what remains", async () => {
    const seller = await seedSeller("returns");
    const buyer = await seedBuyer("returns");
    const product = await seedProduct(seller, { priceCents: 6_000 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] });
    await db.update(orders).set({ status: "delivered" }).where(eq(orders.id, order.id));
    const { returns } = await import("@workspace/db");
    const returnId = `ret-${order.id}`;
    await db.insert(returns).values({ id: returnId, orderId: order.id, buyerId: buyer, sellerId: seller, reason: "too_small" });

    const tooMuch = await call(app.base, "PATCH", `/api/returns/${returnId}/status`, seller, { status: "approved", refundAmountCents: 999_999 });
    expect(tooMuch).toMatchObject({ status: 400, body: { code: "REFUND_EXCEEDS_REMAINING" } });

    const approved = await call(app.base, "PATCH", `/api/returns/${returnId}/status`, seller, { status: "approved", refundAmountCents: 2_000 });
    expect(approved).toMatchObject({ status: 200, body: { status: "refunded", refundAmountCents: 2_000 } });
    const again = await call(app.base, "PATCH", `/api/returns/${returnId}/status`, seller, { status: "approved", refundAmountCents: 2_000 });
    expect(again.status).toBe(200);
    expect(fake.state.refunds).toHaveLength(1);
    // A partial return leaves the order open.
    expect((await reloadOrder(order.id))).toMatchObject({ status: "delivered", refundedCents: 2_000, fundsState: "settled_direct" });
    const deny = await call(app.base, "PATCH", `/api/returns/${returnId}/status`, seller, { status: "denied" });
    expect(deny.status).toBe(409);
  });
});

describe("failed drops", () => {
  it("auto-refunds every unshipped buyer after the deadline, keeps shipped orders, and is idempotent", async () => {
    const seller = await seedSeller("failed-drop");
    const drop = await seedDrop(seller);
    const product = await seedProduct(seller, { priceCents: 3_000, dropId: drop.id });
    const shippedOrder = (await pay({ sellerId: seller, buyerId: await seedBuyer("fd-a"), chargeModel: "held", dropId: drop.id, items: [{ ...product, quantity: 1 }], stripeFeeCents: 117 })).order;
    const waitingB = (await pay({ sellerId: seller, buyerId: await seedBuyer("fd-b"), chargeModel: "held", dropId: drop.id, items: [{ ...product, quantity: 1 }], stripeFeeCents: 117 })).order;
    const waitingC = (await pay({ sellerId: seller, buyerId: await seedBuyer("fd-c"), chargeModel: "held", dropId: drop.id, items: [{ ...product, quantity: 1 }], stripeFeeCents: 117 })).order;

    const manufacturer = await seedManufacturer();
    const bulk = await seedBulkOrder(seller, manufacturer.id, 4_000);
    const wallet = await walletFor(drop.id);
    expect((await call(app.base, "POST", `/api/sample-orders/${bulk.id}/pay-from-wallet`, seller, { walletId: wallet.id })).status).toBe(200);

    await setTracking(shippedOrder.id);
    const shippedRelease = await releaseOrderFunds(shippedOrder.id, "tracking");
    expect(shippedRelease.execution?.state).toBe("paid");

    // The bulk order never arrives: the deadline passes.
    await db.update(drops).set({ fulfillmentDeadlineAt: new Date(Date.now() - 60_000) }).where(eq(drops.id, drop.id));
    const sweep = await runMoneySweep();
    const summary = sweep.failedDrops.find((d) => d.dropId === drop.id);
    expect(summary).toMatchObject({ state: "failed", refunded: 2, errors: 0 });
    for (const order of [waitingB, waitingC]) {
      expect(await reloadOrder(order.id)).toMatchObject({
        status: "cancelled", cancellationReason: "production_issue", fundsState: "refunded", refundedCents: 3_000,
      });
    }
    expect((await reloadOrder(shippedOrder.id)).fundsState).toBe("released");
    expect(fake.state.refunds.map((r) => r.amount)).toEqual([3_000, 3_000]);

    // Running again changes nothing.
    await runMoneySweep();
    expect(fake.state.refunds).toHaveLength(2);

    // The manufacturer was paid from money that went back to buyers: the
    // drop shows what the seller owes Brandthread.
    const dropHeld = await held(seller, { dropId: drop.id });
    expect(dropHeld).toBeLessThan(0);
    const summaryRoute = await call(app.base, "GET", "/api/finance/summary", seller);
    expect(summaryRoute.status).toBe(200);
    expect(summaryRoute.body.owed.amount).toBe(-dropHeld);
    expect(summaryRoute.body.held.drops.find((d: any) => d.dropId === drop.id)).toMatchObject({
      escrowState: "failed", ordersRefunded: 2, ordersReleased: 1, shortfallCents: -dropHeld,
    });
    await expectWalletMatchesLedger(drop.id, seller);

    // A failed drop takes no new preorders.
    await expect(resolveChargePlan({ productIds: [product.productId], sellerId: seller }))
      .rejects.toMatchObject({ code: "DROP_NOT_ACCEPTING_PREORDERS" });
  });

  it("lets the seller cancel a drop, refunding everyone unshipped", async () => {
    const seller = await seedSeller("cancel-drop");
    const drop = await seedDrop(seller);
    const product = await seedProduct(seller, { priceCents: 1_800, dropId: drop.id });
    const order = (await pay({ sellerId: seller, buyerId: await seedBuyer("cd"), chargeModel: "held", dropId: drop.id, items: [{ ...product, quantity: 1 }] })).order;
    const unconfirmed = await call(app.base, "POST", `/api/drops/${drop.id}/cancel-preorders`, seller, {});
    expect(unconfirmed.status).toBe(400);
    const cancelled = await call(app.base, "POST", `/api/drops/${drop.id}/cancel-preorders`, seller, { confirm: true });
    expect(cancelled).toMatchObject({ status: 200, body: { state: "failed", refunded: 1 } });
    expect((await reloadOrder(order.id)).fundsState).toBe("refunded");
    const bulk = await seedBulkOrder(seller, (await seedManufacturer()).id, 100);
    const wallet = await walletFor(drop.id);
    const blocked = await call(app.base, "POST", `/api/sample-orders/${bulk.id}/pay-from-wallet`, seller, { walletId: wallet.id });
    expect(blocked).toMatchObject({ status: 409, body: { code: "DROP_FUNDS_UNAVAILABLE" } });
  });
});

describe("multi-seller cart", () => {
  it("charges each seller separately and keeps their money apart", async () => {
    const buyer = await seedBuyer("multi");
    const sellerA = await seedSeller("multi-a");
    const sellerB = await seedSeller("multi-b");
    const productA = await seedProduct(sellerA, { priceCents: 1_999 });
    const productB = await seedProduct(sellerB, { priceCents: 3_333 });
    // The app splits a multi-seller cart into one checkout per seller.
    const orderA = (await pay({ sellerId: sellerA, buyerId: buyer, chargeModel: "destination", items: [{ ...productA, quantity: 3 }] })).order;
    const orderB = (await pay({ sellerId: sellerB, buyerId: buyer, chargeModel: "destination", items: [{ ...productB, quantity: 1 }] })).order;
    expect(orderA.platformFeeCents).toBe(300);  // 5% of 5 997 = 299.85 → 300
    expect(orderB.platformFeeCents).toBe(167);  // 5% of 3 333 = 166.65 → 167
    const paidB = await paidOut(sellerB);

    await refundOrder({ orderId: orderA.id, reason: "seller_cancelled", initiatedBy: sellerA, idempotencyKey: `multi/${orderA.id}` });
    expect(await paidOut(sellerB)).toBe(paidB);
    expect((await reloadOrder(orderB.id)).fundsState).toBe("settled_direct");
    expect(fake.state.refunds).toHaveLength(1);
    expect(fake.state.refunds[0].payment_intent).toBe(orderA.stripePaymentIntentId);
  });

  it("will not mix preorder and in-stock items, or two drops, in one charge", async () => {
    const seller = await seedSeller("mixed");
    const drop1 = await seedDrop(seller);
    const drop2 = await seedDrop(seller);
    const pre1 = await seedProduct(seller, { priceCents: 1_000, dropId: drop1.id });
    const pre2 = await seedProduct(seller, { priceCents: 1_000, dropId: drop2.id });
    const inStock = await seedProduct(seller, { priceCents: 1_000 });
    await expect(resolveChargePlan({ productIds: [pre1.productId, inStock.productId], sellerId: seller }))
      .rejects.toMatchObject({ code: "MIXED_PREORDER_CART" });
    await expect(resolveChargePlan({ productIds: [pre1.productId, pre2.productId], sellerId: seller }))
      .rejects.toMatchObject({ code: "MULTIPLE_PREORDER_DROPS" });
    await expect(resolveChargePlan({ productIds: [inStock.productId], sellerId: seller, clientDropId: drop1.id }))
      .rejects.toBeInstanceOf(CheckoutPlanError);
    expect(await resolveChargePlan({ productIds: [pre1.productId], sellerId: seller }))
      .toEqual({ chargeModel: "held", dropId: drop1.id });
    expect(await resolveChargePlan({ productIds: [inStock.productId], sellerId: seller }))
      .toEqual({ chargeModel: "destination", dropId: null });
  });
});

describe("drop wallet endpoints", () => {
  it("no longer lets a seller invent a deposit or a label payment", async () => {
    const seller = await seedSeller("no-deposit");
    const drop = await seedDrop(seller);
    const deposit = await call(app.base, "POST", `/api/drop-wallets/${drop.id}/deposit`, seller, { orderId: drop.id, amountCents: 1_000_000 });
    expect(deposit).toMatchObject({ status: 410, body: { code: "DEPOSITS_ARE_AUTOMATIC" } });
    const shipping = await call(app.base, "POST", `/api/drop-wallets/${drop.id}/pay-shipping/${drop.id}`, seller, { labelCents: 500 });
    expect(shipping.status).toBe(410);
    expect(fake.state.transfers).toHaveLength(0);
  });
});

describe("ledger guarantees", () => {
  it("rejects edits, deletes and unbalanced transactions at the database", async () => {
    const rootCause = (error: any) => String(error?.cause?.message ?? error?.message);
    const edit = await db.execute(sql`UPDATE ledger_postings SET amount_cents = amount_cents + 1 WHERE id = (SELECT min(id) FROM ledger_postings)`)
      .catch((error) => error);
    expect(rootCause(edit)).toMatch(/append-only/);
    const removal = await db.execute(sql`DELETE FROM ledger_transactions WHERE id = (SELECT transaction_id FROM ledger_postings LIMIT 1)`)
      .catch((error) => error);
    expect(rootCause(removal)).toMatch(/append-only/);
    const unbalanced = await db.transaction(async (tx) => {
      const created = await tx.execute(sql`
        INSERT INTO ledger_transactions (idempotency_key, kind) VALUES (${`unbalanced-${Date.now()}`}, 'test') RETURNING id
      `);
      const id = (created.rows[0] as { id: string }).id;
      await tx.execute(sql`
        INSERT INTO ledger_postings (transaction_id, account, amount_cents)
        VALUES (${id}::uuid, 'buyer_payments', -100), (${id}::uuid, 'seller_held', 99)
      `);
    }).catch((error) => error);
    expect(rootCause(unbalanced)).toMatch(/unbalanced/);
    await expectLedgerBalanced();
  });

  it("refuses to post a refund larger than the charge even if called directly", async () => {
    const seller = await seedSeller("cap");
    const buyer = await seedBuyer("cap");
    const product = await seedProduct(seller, { priceCents: 700 });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }] });
    await expect(db.update(orders).set({ refundedCents: 701 }).where(eq(orders.id, order.id)))
      .rejects.toThrow();
    const error = await refundOrder({
      orderId: order.id, amountCents: 0, reason: "seller_cancelled", initiatedBy: seller, idempotencyKey: `zero/${order.id}`,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(RefundError);
    expect(error.code).toBe("INVALID_REFUND_AMOUNT");
  });
});

describe("finance summary", () => {
  it("shows held vs releasing vs available vs paid out from real data", async () => {
    const seller = await seedSeller("summary");
    const drop = await seedDrop(seller);
    const preorder = await seedProduct(seller, { priceCents: 2_000, dropId: drop.id });
    const inStock = await seedProduct(seller, { priceCents: 1_000 });
    await pay({ sellerId: seller, buyerId: await seedBuyer("s1"), chargeModel: "held", dropId: drop.id, items: [{ ...preorder, quantity: 1 }], stripeFeeCents: 88 });
    const shipped = (await pay({ sellerId: seller, buyerId: await seedBuyer("s2"), chargeModel: "held", dropId: drop.id, items: [{ ...preorder, quantity: 1 }], stripeFeeCents: 88 })).order;
    const direct = (await pay({ sellerId: seller, buyerId: await seedBuyer("s3"), chargeModel: "destination", items: [{ ...inStock, quantity: 1 }] })).order;
    await setTracking(shipped.id);
    await releaseOrderFunds(shipped.id, "tracking");
    fake.state.balanceAvailable = 4_321;
    fake.state.balancePending = 99;
    fake.state.payouts.push({ status: "paid", currency: "usd", amount: 1_000 });

    const summary = await call(app.base, "GET", "/api/finance/summary", seller);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      connected: true,
      held: { amount: 1_812 },
      releasing: { amount: 0, count: 0 },
      available: { amount: 4_321 },
      pending: { amount: 99 },
      paidOut: { amount: 1_812 + direct.sellerNetCents, toBank: { amount: 1_000 } },
      owed: { amount: 0 },
    });
    expect(summary.body.held.drops[0]).toMatchObject({ dropId: drop.id, ordersHeld: 1, ordersReleased: 1 });
    expect(summary.body.lifetime.platformFees.amount).toBe(100 + 100 + 50);
    expect(summary.body.activity.length).toBeGreaterThanOrEqual(4);
  });
});

void sampleOrders;
