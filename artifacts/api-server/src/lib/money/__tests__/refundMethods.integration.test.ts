/**
 * Refund methods (items 113/114) against real Postgres with the fake Stripe:
 * 'original' (card, unchanged), 'thread_cash' (seller's share clawed back,
 * buyer credited Thread Cash once) and 'store_credit' (seller-issued gift
 * card, no money movement). Covers ledger postings, idempotency, partial
 * refunds, Stripe failures, and the return / seller-refund routes that pick
 * the method.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ threadCash: true }));
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; idempotencyKey?: string }> }));

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
  sendReturnStatusEmail: async () => true,
  sendBrandthreadEmail: async (input: { to: string; subject: string; idempotencyKey?: string }) => {
    mail.sent.push({ to: input.to, subject: input.subject, idempotencyKey: input.idempotencyKey });
    return true;
  },
}));
vi.mock("../../threadCash/wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../threadCash/wallet")>()),
  isFeatureEnabled: async (key: string) => (key === "threadCashCheckoutDiscount" ? flags.threadCash : false),
}));
vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = req.headers["x-test-user"]; next(); },
}));
vi.mock("../../../middlewares/requireRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../middlewares/requireRole")>()),
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { db, giftCards, giftCardTransactions, orderRefunds, orders, returns, threadCashEntries } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { fake } from "./fakeStripe";
import {
  call, expectLedgerBalanced, expectWalletMatchesLedger, held, ledgerKinds, orderLedger, paidOut, pay, seedBuyer, seedDrop,
  seedProduct, seedSeller, startApp, uid,
} from "./moneyHarness";
import { recordExternalRefunds, refundOrder, RefundError, type RefundMethod } from "../refunds";
import { getBalanceCents } from "../../threadCash/wallet";
import returnsRouter from "../../../routes/returns";
import ordersRouter from "../../../routes/orders";

let app: { base: string; close: () => Promise<void> };
beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/returns", returnsRouter);
    server.use("/api/orders", ordersRouter);
  });
});
afterAll(async () => { await app?.close(); });
beforeEach(() => {
  fake.reset();
  flags.threadCash = true;
  mail.sent.length = 0;
});

/** An in-stock (destination charge) order: $50 item + $5 shipping. */
async function destinationOrder(tag: string) {
  const seller = await seedSeller(tag);
  const buyer = await seedBuyer(tag);
  const product = await seedProduct(seller, { priceCents: 5_000 });
  const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }], shippingCents: 500 });
  return { seller, buyer, order };
}

function refund(orderId: string, method: RefundMethod | undefined, key: string, amountCents?: number) {
  return refundOrder({
    orderId, amountCents, reason: "return_approved", initiatedBy: "test", idempotencyKey: key,
    ...(method ? { method } : {}), stripe: fake.stripe as any,
  });
}

async function refundCreditsFor(buyerId: string) {
  return db.select().from(threadCashEntries)
    .where(and(eq(threadCashEntries.buyerId, buyerId), eq(threadCashEntries.source, "refund_credit")));
}

describe("original (default) — unchanged card refund", () => {
  it("refunds the card with reverse_transfer, returns the 5% fee, credits no Thread Cash", async () => {
    const { seller, buyer, order } = await destinationOrder("orig");
    const before = await paidOut(seller);
    const result = await refund(order.id, undefined, uid("orig"));
    expect(result).toMatchObject({ method: "original", amountCents: 5_500, duplicate: false, threadCashEntryId: null, giftCardId: null });
    expect(fake.state.refunds).toHaveLength(1);
    expect(fake.state.refunds[0]).toMatchObject({ amount: 5_500, reverse_transfer: true, refund_application_fee: false });
    expect(fake.state.feeRefunds).toHaveLength(1);
    expect(fake.state.feeRefunds[0].amount).toBe(result.platformFeeRefundCents);
    expect(fake.state.reversals).toHaveLength(0);
    expect(await refundCreditsFor(buyer)).toHaveLength(0);
    expect(await paidOut(seller)).toBe(before - 5_500 + result.platformFeeRefundCents);
    const [row] = await db.select().from(orderRefunds).where(eq(orderRefunds.id, result.refundId));
    expect(row.method).toBe("original");
    expect((await ledgerKinds(order.id))).toContain("refund_return_approved");
    await expectLedgerBalanced();
  });
});

describe("thread_cash", () => {
  it("claws back only the seller's share, keeps the fee, credits the buyer exactly once", async () => {
    const { seller, buyer, order } = await destinationOrder("tc");
    const sellerBefore = await paidOut(seller);
    const key = uid("tc");
    const result = await refund(order.id, "thread_cash", key);
    const pfr = result.platformFeeRefundCents;
    expect(pfr).toBeGreaterThan(0);
    expect(result).toMatchObject({ method: "thread_cash", amountCents: 5_500, stripeRefundId: null, duplicate: false });

    // No card refund, no fee refund; one reversal of the destination charge's transfer.
    expect(fake.state.refunds).toHaveLength(0);
    expect(fake.state.feeRefunds).toHaveLength(0);
    expect(fake.state.reversals).toHaveLength(1);
    expect(fake.state.reversals[0]).toMatchObject({ transfer: order.stripeTransferId, amount: 5_500 - pfr });

    // Buyer: exactly the refund amount in Thread Cash.
    const credits = await refundCreditsFor(buyer);
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ amountCents: 5_500, referenceId: `refund-method:${result.refundId}`, usedOrderId: order.id });
    expect(await getBalanceCents(db, buyer)).toBe(5_500);

    // Seller lands where a card refund leaves them: −(refund − fee share).
    expect(await paidOut(seller)).toBe(sellerBefore - (5_500 - pfr));
    const ledger = await orderLedger(order.id);
    expect(ledger.thread_cash_refund_credit).toBe(5_500);
    expect(ledger.buyer_payments).toBe(-5_500); // paid in, never paid back out in cash
    expect(await ledgerKinds(order.id)).toContain("refund_return_approved_thread_cash");

    const [row] = await db.select().from(orderRefunds).where(eq(orderRefunds.id, result.refundId));
    expect(row).toMatchObject({ method: "thread_cash", state: "succeeded", threadCashEntryId: credits[0].id, transferReversalCents: 5_500 - pfr });
    const reloaded = (await db.select().from(orders).where(eq(orders.id, order.id)))[0];
    expect(reloaded).toMatchObject({ refundedCents: 5_500, fundsState: "refunded", platformFeeRefundedCents: pfr });

    // A retry is the same refund: nothing moves twice.
    const again = await refund(order.id, "thread_cash", key);
    expect(again).toMatchObject({ duplicate: true, refundId: result.refundId, threadCashEntryId: credits[0].id });
    expect(fake.state.reversals).toHaveLength(1);
    expect(await refundCreditsFor(buyer)).toHaveLength(1);
    expect(await getBalanceCents(db, buyer)).toBe(5_500);
    await expectLedgerBalanced();
  });

  it("matches a card refund for the seller and the platform cent for cent", async () => {
    const card = await destinationOrder("tc-vs-card-a");
    const credit = await destinationOrder("tc-vs-card-b");
    const cardBefore = await paidOut(card.seller);
    const creditBefore = await paidOut(credit.seller);
    const a = await refund(card.order.id, "original", uid("a"), 3_000);
    const b = await refund(credit.order.id, "thread_cash", uid("b"), 3_000);
    expect(a.platformFeeRefundCents).toBe(b.platformFeeRefundCents);
    expect(cardBefore - (await paidOut(card.seller))).toBe(creditBefore - (await paidOut(credit.seller)));
    expect((await orderLedger(card.order.id)).platform_revenue).toBe((await orderLedger(credit.order.id)).platform_revenue);
  });

  it("partial refunds credit each part once and never more than was paid", async () => {
    const { buyer, order } = await destinationOrder("tc-partial");
    const first = await refund(order.id, "thread_cash", uid("p1"), 2_000);
    const second = await refund(order.id, "thread_cash", uid("p2"), 1_500);
    expect(first.refundId).not.toBe(second.refundId);
    expect((await refundCreditsFor(buyer)).map((c) => c.amountCents).sort()).toEqual([1_500, 2_000]);
    expect(await getBalanceCents(db, buyer)).toBe(3_500);
    expect(fake.state.reversals.map((r) => r.amount).reduce((x, y) => x + y, 0))
      .toBe(3_500 - first.platformFeeRefundCents - second.platformFeeRefundCents);
    await expect(refund(order.id, "thread_cash", uid("p3"), 2_001)).rejects.toMatchObject({ code: "REFUND_EXCEEDS_REMAINING" });
    const third = await refund(order.id, "original", uid("p4"));
    expect(third.amountCents).toBe(2_000);
    expect(fake.state.refunds).toHaveLength(1);
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].refundedCents).toBe(5_500);
    await expectLedgerBalanced();
  });

  it("credits nothing when Stripe refuses the claw-back, and retries cleanly after an unconfirmed one", async () => {
    const { buyer, order } = await destinationOrder("tc-fail");
    fake.state.failNextReversal = "definitive";
    const key = uid("fail");
    await expect(refund(order.id, "thread_cash", key)).rejects.toMatchObject({ code: "REFUND_REJECTED" });
    expect(await refundCreditsFor(buyer)).toHaveLength(0);
    const [failed] = await db.select().from(orderRefunds).where(eq(orderRefunds.idempotencyKey, key));
    expect(failed.state).toBe("failed");
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].refundedCents).toBe(0);

    fake.state.failNextReversal = "ambiguous";
    await expect(refund(order.id, "thread_cash", key)).rejects.toMatchObject({ code: "REFUND_UNCONFIRMED" });
    expect(await refundCreditsFor(buyer)).toHaveLength(0);
    const done = await refund(order.id, "thread_cash", key);
    expect(done.duplicate).toBe(false);
    expect(fake.state.reversals).toHaveLength(1);
    expect(await refundCreditsFor(buyer)).toHaveLength(1);
    await expectLedgerBalanced();
  });

  it("is refused while buyers can't spend Thread Cash, and a key can't switch methods", async () => {
    const { order } = await destinationOrder("tc-off");
    flags.threadCash = false;
    const key = uid("off");
    await expect(refund(order.id, "thread_cash", key)).rejects.toMatchObject({ code: "THREAD_CASH_REFUNDS_OFF" });
    expect(await db.select().from(orderRefunds).where(eq(orderRefunds.idempotencyKey, key))).toHaveLength(0);
    await refund(order.id, "original", key, 1_000);
    flags.threadCash = true;
    await expect(refund(order.id, "thread_cash", key, 1_000)).rejects.toBeInstanceOf(RefundError);
  });

  it("held preorder funds: no Stripe call, the seller's held share pays for it", async () => {
    const seller = await seedSeller("tc-held");
    const buyer = await seedBuyer("tc-held");
    const drop = await seedDrop(seller);
    const product = await seedProduct(seller, { priceCents: 4_000, dropId: drop.id });
    const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "held", dropId: drop.id, items: [{ ...product, quantity: 1 }], stripeFeeCents: 146 });
    const heldBefore = await held(seller, { dropId: drop.id });
    const result = await refund(order.id, "thread_cash", uid("held"));
    expect(fake.state.refunds).toHaveLength(0);
    expect(fake.state.reversals).toHaveLength(0);
    expect(await getBalanceCents(db, buyer)).toBe(4_000);
    expect(await held(seller, { dropId: drop.id })).toBe(heldBefore - (4_000 - result.platformFeeRefundCents));
    expect((await orderLedger(order.id)).thread_cash_refund_credit).toBe(4_000);
    await expectWalletMatchesLedger(drop.id, seller);
    await expectLedgerBalanced();
  });

  it("a later Stripe-dashboard refund is still reconciled against card refunds only", async () => {
    const { order } = await destinationOrder("tc-ext");
    await refund(order.id, "thread_cash", uid("ext"), 2_000);
    const recorded = await recordExternalRefunds({
      paymentIntentId: order.stripePaymentIntentId, chargeId: null, cumulativeRefundedCents: 1_000, providerEventId: uid("evt"),
    });
    expect(recorded.recordedCents).toBe(1_000);
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].refundedCents).toBe(3_000);
    await expectLedgerBalanced();
  });
});

describe("store_credit", () => {
  it("issues one seller gift card for the refund, moves no money, emails the code", async () => {
    const { seller, buyer, order } = await destinationOrder("sc");
    const sellerBefore = await paidOut(seller);
    const key = uid("sc");
    const result = await refund(order.id, "store_credit", key, 2_500);
    expect(result).toMatchObject({ method: "store_credit", amountCents: 2_500, platformFeeRefundCents: 0, stripeRefundId: null });
    expect(fake.state.refunds).toHaveLength(0);
    expect(fake.state.reversals).toHaveLength(0);
    expect(fake.state.feeRefunds).toHaveLength(0);
    expect(await paidOut(seller)).toBe(sellerBefore);
    expect((await ledgerKinds(order.id)).some((kind) => kind.startsWith("refund_"))).toBe(false);

    const cards = await db.select().from(giftCards).where(eq(giftCards.refundId, result.refundId));
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: result.giftCardId, sellerId: seller, ownerId: buyer, source: "seller_issued", status: "active",
      initialCents: 2_500, balanceCents: 2_500, expiresAt: null,
    });
    const issue = await db.select().from(giftCardTransactions).where(eq(giftCardTransactions.giftCardId, cards[0].id));
    expect(issue).toHaveLength(1);
    expect(issue[0]).toMatchObject({ type: "issue", amountCents: 2_500 });
    expect(mail.sent.filter((m) => m.idempotencyKey === `gift-card-email/${cards[0].id}`)).toHaveLength(1);
    expect(await refundCreditsFor(buyer)).toHaveLength(0);

    // Retry: same refund, still one card, no second email.
    const again = await refund(order.id, "store_credit", key, 2_500);
    expect(again).toMatchObject({ duplicate: true, giftCardId: cards[0].id });
    expect(await db.select().from(giftCards).where(eq(giftCards.refundId, result.refundId))).toHaveLength(1);
    // Existing refund receipts remain; the store-credit delivery must not repeat.
    expect(mail.sent.filter((m) => m.idempotencyKey === `gift-card-email/${cards[0].id}`)).toHaveLength(1);

    // Under $5 is fine for store credit (it is the refund amount, not a card for sale).
    const small = await refund(order.id, "store_credit", uid("sc-small"), 300);
    expect((await db.select().from(giftCards).where(eq(giftCards.id, small.giftCardId!)))[0].balanceCents).toBe(300);

    const reloaded = (await db.select().from(orders).where(eq(orders.id, order.id)))[0];
    expect(reloaded.refundedCents).toBe(2_800);
    expect(reloaded.fundsState).toBe("settled_direct"); // the seller keeps the money
    await expectLedgerBalanced();
  });
});

describe("routes", () => {
  async function deliveredReturn(tag: string, resolution: string) {
    const { seller, buyer, order } = await destinationOrder(tag);
    await db.update(orders).set({ status: "delivered" }).where(eq(orders.id, order.id));
    const created = await call(app.base, "POST", "/api/returns", buyer, { orderId: order.id, reason: "Does not fit", resolutionRequested: resolution });
    return { seller, buyer, order, created };
  }

  it("lists Thread Cash as a refund option only while it can be spent", async () => {
    const on = await call(app.base, "GET", "/api/returns/refund-options", "anyone");
    expect(on.body.methods).toEqual(["original", "thread_cash", "store_credit"]);
    flags.threadCash = false;
    const off = await call(app.base, "GET", "/api/returns/refund-options", "anyone");
    expect(off.body.methods).toEqual(["original", "store_credit"]);
  });

  it("approving a return pays out the way the buyer asked", async () => {
    const tc = await deliveredReturn("rt-tc", "thread_cash");
    expect(tc.created.status).toBe(201);
    expect(tc.created.body.resolutionRequested).toBe("thread_cash");
    const approved = await call(app.base, "PATCH", `/api/returns/${tc.created.body.id}/status`, tc.seller, { status: "approved" });
    expect(approved.body.status).toBe("refunded");
    expect(await getBalanceCents(db, tc.buyer)).toBe(5_500);
    expect(fake.state.refunds).toHaveLength(0);

    const sc = await deliveredReturn("rt-sc", "store_credit");
    await call(app.base, "PATCH", `/api/returns/${sc.created.body.id}/status`, sc.seller, { status: "approved", refundAmountCents: 5_000 });
    const [card] = await db.select().from(giftCards).where(eq(giftCards.ownerId, sc.buyer));
    expect(card).toMatchObject({ sellerId: sc.seller, balanceCents: 5_000, source: "seller_issued" });
    expect(fake.state.refunds).toHaveLength(0);

    const card$ = await deliveredReturn("rt-card", "refund");
    await call(app.base, "PATCH", `/api/returns/${card$.created.body.id}/status`, card$.seller, { status: "approved" });
    expect(fake.state.refunds).toHaveLength(1);
  });

  it("refuses a Thread Cash return request while it's off, and falls back to the card at approval", async () => {
    flags.threadCash = false;
    const refused = await deliveredReturn("rt-off", "thread_cash");
    expect(refused.created.status).toBe(400);
    flags.threadCash = true;
    const asked = await deliveredReturn("rt-later", "thread_cash");
    flags.threadCash = false;
    const approved = await call(app.base, "PATCH", `/api/returns/${asked.created.body.id}/status`, asked.seller, { status: "approved" });
    expect(approved.body.status).toBe("refunded");
    expect(fake.state.refunds).toHaveLength(1);
    expect(await getBalanceCents(db, asked.buyer)).toBe(0);
    const [ret] = await db.select().from(returns).where(eq(returns.id, asked.created.body.id));
    expect(ret.stripeRefundId).toBe(fake.state.refunds[0].id);
  });

  it("the seller's manual refund supports store credit and is idempotent per request", async () => {
    const { seller, buyer, order } = await destinationOrder("manual");
    const requestId = uid("req").replace(/[^A-Za-z0-9_-]/g, "_");
    const body = { amountCents: 2_000, method: "store_credit", clientRequestId: requestId };
    const first = await call(app.base, "POST", `/api/orders/${order.id}/refund`, seller, body);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ method: "store_credit", amountCents: 2_000 });
    const second = await call(app.base, "POST", `/api/orders/${order.id}/refund`, seller, body);
    expect(second.status).toBe(200);
    expect(second.body.giftCardId).toBe(first.body.giftCardId);
    expect(await db.select().from(giftCards).where(eq(giftCards.ownerId, buyer))).toHaveLength(1);

    const stranger = await seedSeller("manual-other");
    const forbidden = await call(app.base, "POST", `/api/orders/${order.id}/refund`, stranger, { ...body, clientRequestId: `${requestId}x` });
    expect(forbidden.status).toBe(404);
    const noThreadCash = await call(app.base, "POST", `/api/orders/${order.id}/refund`, seller, { ...body, method: "thread_cash", clientRequestId: `${requestId}y` });
    expect(noThreadCash.status).toBe(400);
    const card = await call(app.base, "POST", `/api/orders/${order.id}/refund`, seller, { amountCents: 1_000, clientRequestId: `${requestId}z` });
    expect(card.body.method).toBe("original");
    expect(fake.state.refunds).toHaveLength(1);
  });
});
