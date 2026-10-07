/**
 * Lost chargebacks after payout, end to end against real Postgres, the real
 * webhook route (signed events) and the real finance / Thread Cash code, with
 * the test-mode Stripe fake:
 *
 *  - lost on an already-paid order → the order's transfer is reversed; if
 *    that covers it, nothing is owed;
 *  - the reversal fails or falls short → an open recovery: the seller's
 *    balance goes negative, POST /api/finance/payout and Thread Cash cash-out
 *    answer 409 PAYOUTS_PAUSED_RECOVERY, the next order release nets the debt
 *    (smaller transfer), the seller is told, and payouts resume;
 *  - lost while Brandthread still held the money → that payout is cancelled
 *    and nothing is owed;
 *  - a retried webhook changes nothing; Stripe reinstating the funds pays the
 *    seller back;
 *  - the ledger balances after every step.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("./fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", () => ({
  normalizePushEventCategory: () => "payout",
  sendPushToUser: async () => {},
  stableNotificationId: (...parts: string[]) => parts.join(":"),
}));
vi.mock("../../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
  sendOrderShippingEmail: async () => true,
}));
vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../../middlewares/requireRole", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../middlewares/requireRole")>();
  const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return { ...actual, teamContext: pass, requireRole: pass, requirePermission: pass, requirePayoutsRead: pass };
});

import { and, eq, sql } from "drizzle-orm";
import { db, notificationsFeed, sellerRecoveries, sellerRecoveryApplications, threadCashEntries } from "@workspace/db";
import { fake } from "./fakeStripe";
import {
  call, expectLedgerBalanced, expectWalletMatchesLedger, held, pay, reloadOrder, seedBuyer, seedDrop, seedProduct,
  seedSeller, setTracking, startApp, uid,
} from "./moneyHarness";
import { accountBalanceCents } from "../ledger";
import { releaseOrderFunds } from "../escrow";
import { cashOutThreadCash } from "../../threadCash/cashOut";
import webhooksRouter from "../../../routes/webhooks";
import financeRouter from "../../../routes/finance";

let app: { base: string; close: () => Promise<void> };
const originalKey = process.env.STRIPE_SECRET_KEY;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_for_money_tests";
  app = await startApp((server) => {
    server.use("/api/webhooks", webhooksRouter);
    server.use("/api/finance", financeRouter);
  });
});
afterAll(async () => {
  process.env.STRIPE_SECRET_KEY = originalKey;
  await expectLedgerBalanced();
  await app?.close();
});
beforeEach(() => fake.reset());

async function deliver(type: string, object: Record<string, unknown>, eventId = `evt_${uid("rec").replace(/-/g, "_")}`) {
  const signed = fake.signedEvent({
    id: eventId, object: "event", type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object },
  });
  const response = await fetch(`${app.base}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signed.header },
    body: signed.payload,
  });
  return { status: response.status, body: await response.json().catch(() => null), eventId };
}

type PaidOrder = Awaited<ReturnType<typeof reloadOrder>>;

function disputeFor(order: PaidOrder, amount: number, status: string, fees: number[] = [1_500]) {
  return {
    id: `dp_${order.id.replace(/-/g, "").slice(0, 16)}`,
    object: "dispute",
    amount,
    currency: "usd",
    payment_intent: order.stripePaymentIntentId,
    charge: order.stripeChargeId,
    reason: "fraudulent",
    status,
    evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86_400 },
    balance_transactions: fees.map((fee, i) => ({ id: `txn_dp_${i}`, amount: i === 0 ? -amount : amount, fee })),
  };
}

/** The buyer's bank opens a chargeback and later rules for the buyer. */
async function loseChargeback(order: PaidOrder, amount: number) {
  expect((await deliver("charge.dispute.created", disputeFor(order, amount, "needs_response"))).status).toBe(200);
  const closed = await deliver("charge.dispute.closed", disputeFor(order, amount, "lost"));
  expect(closed.status).toBe(200);
  return closed;
}

async function payTransferOrder(tag: string, priceCents: number, seller?: string) {
  const sellerId = seller ?? await seedSeller(tag);
  const product = await seedProduct(sellerId, { priceCents });
  const { order } = await pay({
    sellerId, buyerId: await seedBuyer(tag), chargeModel: "transfer", items: [{ ...product, quantity: 1 }], stripeFeeCents: 320,
  });
  return { seller: sellerId, order: await reloadOrder(order.id) };
}

async function recoveriesOf(seller: string) {
  return db.select().from(sellerRecoveries).where(eq(sellerRecoveries.sellerId, seller));
}

async function recoverableLedger(seller: string) {
  return accountBalanceCents(db, { account: "seller_recoverable", partyId: seller });
}

async function notificationTypes(seller: string) {
  const rows = await db.select({ type: notificationsFeed.type }).from(notificationsFeed).where(eq(notificationsFeed.userId, seller));
  return rows.map((r) => r.type);
}

describe("lost chargeback on an order that was already paid out", () => {
  it("reverses the order's transfer; when that covers the seller's share + fee, nothing is owed", async () => {
    const { seller, order } = await payTransferOrder("rev-ok", 10_000);
    expect(order).toMatchObject({ fundsState: "released", stripeTransferId: expect.any(String) });
    const share = Math.floor((4_000 * order.sellerNetCents) / order.grossChargedCents);

    const closed = await loseChargeback(order, 4_000);

    expect(fake.state.reversals).toHaveLength(1);
    expect(fake.state.reversals[0]).toMatchObject({ transfer: order.stripeTransferId, amount: share + 1_500 });
    const [recovery] = await recoveriesOf(seller);
    expect(recovery).toMatchObject({ status: "recovered", amountCents: share, feeCents: 1_500, recoveredCents: share + 1_500 });
    expect(await recoverableLedger(seller)).toBe(0);
    expect(await accountBalanceCents(db, { account: "seller_paid_out", partyId: seller, orderId: order.id }))
      .toBe(order.sellerNetCents - share - 1_500);

    const list = await call(app.base, "GET", "/api/finance/recoveries", seller);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ recoveryOwedCents: 0, payoutsPaused: false });
    expect(list.body.recoveries[0]).toMatchObject({
      status: "recovered", outstandingCents: 0, orderNumber: order.orderNumber, disputeReason: "fraudulent",
      applications: [{ source: "transfer_reversal", amountCents: share + 1_500 }],
    });
    expect(await notificationTypes(seller)).not.toContain("chargeback_recovery_opened");
    await expectLedgerBalanced();

    // Stripe retries the same event, and sends a second event for the same
    // dispute: nothing moves twice.
    expect((await deliver("charge.dispute.closed", disputeFor(order, 4_000, "lost"), closed.eventId)).body).toMatchObject({ duplicate: true });
    expect((await deliver("charge.dispute.closed", disputeFor(order, 4_000, "lost"))).status).toBe(200);
    expect(fake.state.reversals).toHaveLength(1);
    expect(await recoveriesOf(seller)).toHaveLength(1);
    const lossTxns = await db.execute(sql`
      SELECT count(*)::int AS n FROM ledger_transactions WHERE kind = 'chargeback_lost' AND order_id = ${order.id}::uuid
    `);
    expect((lossTxns.rows[0] as { n: number }).n).toBe(1);
    await expectLedgerBalanced();
  });

  it("when the reversal fails: the debt stays open, payouts pause, the next release nets it, and payouts resume", async () => {
    const { seller, order } = await payTransferOrder("rev-fail", 10_000);
    fake.state.failNextReversal = "definitive";
    await loseChargeback(order, order.grossChargedCents);
    const owed = order.sellerNetCents + 1_500;

    const [recovery] = await recoveriesOf(seller);
    expect(recovery).toMatchObject({ status: "open", amountCents: order.sellerNetCents, feeCents: 1_500, recoveredCents: 0 });
    expect(await recoverableLedger(seller)).toBe(-owed);
    expect(await notificationTypes(seller)).toContain("chargeback_recovery_opened");
    await expectLedgerBalanced();

    // Seller Finance: the balance is net of the debt and may be negative.
    fake.state.balanceAvailable = 500;
    const balance = await call(app.base, "GET", "/api/finance/balance", seller);
    expect(balance.status).toBe(200);
    expect(balance.body).toMatchObject({
      payoutsPaused: true,
      recoveryOwedCents: owed,
      available: { amount: 500 },
      balanceAfterRecovery: { amount: 500 - owed, formatted: `−$${((owed - 500) / 100).toFixed(2)}` },
    });
    const summary = await call(app.base, "GET", "/api/finance/summary", seller);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ payoutsPaused: true, recoveryOwedCents: owed });

    // Bank payout and Thread Cash cash-out are both paused.
    const payout = await call(app.base, "POST", "/api/finance/payout", seller, {
      amount: 500, currency: "usd", idempotencyKey: `payout-${uid("k").replace(/-/g, "_")}`,
    });
    expect(payout.status).toBe(409);
    expect(payout.body).toMatchObject({ code: "PAYOUTS_PAUSED_RECOVERY", recoveryOwedCents: owed });
    await db.insert(threadCashEntries).values({ buyerId: seller, amountCents: 1_000, source: "live_gift", referenceId: uid("gift"), funding: "paid" });
    const transfersBefore = fake.state.transfers.length;
    await expect(cashOutThreadCash(fake.stripe as any, seller, 500, uid("cashout")))
      .rejects.toMatchObject({ code: "PAYOUTS_PAUSED_RECOVERY", status: 409 });
    expect(fake.state.transfers).toHaveLength(transfersBefore);

    // The next sale: its transfer is reduced by what is owed.
    const next = (await payTransferOrder("rev-fail-next", 20_000, seller)).order;
    const nextTransfer = fake.state.transfers.find((t) => t.metadata?.orderId === next.id);
    expect(nextTransfer.amount).toBe(next.sellerNetCents - owed);
    expect(next).toMatchObject({ fundsState: "released", recoveryNettedCents: owed });
    const [after] = await recoveriesOf(seller);
    expect(after).toMatchObject({ status: "recovered", recoveredCents: owed, recoveredAt: expect.any(Date) });
    const apps = await db.select().from(sellerRecoveryApplications).where(eq(sellerRecoveryApplications.recoveryId, after.id));
    expect(apps).toEqual([expect.objectContaining({ source: "release_netting", amountCents: owed, orderId: next.id })]);
    expect(await recoverableLedger(seller)).toBe(0);
    expect(await held(seller, { orderId: next.id })).toBe(0);
    expect(await notificationTypes(seller)).toContain("chargeback_recovered");
    await expectLedgerBalanced();

    // Payouts resume on their own.
    fake.state.balanceAvailable = 2_000;
    const resumed = await call(app.base, "GET", "/api/finance/balance", seller);
    expect(resumed.body).toMatchObject({ payoutsPaused: false, recoveryOwedCents: 0, balanceAfterRecovery: { amount: 2_000 } });
    const paidOut = await call(app.base, "POST", "/api/finance/payout", seller, {
      amount: 2_000, currency: "usd", idempotencyKey: `payout-${uid("k2").replace(/-/g, "_")}`,
    });
    expect(paidOut.status).toBe(201);
    await expect(cashOutThreadCash(fake.stripe as any, seller, 500, uid("cashout2"))).resolves.toMatchObject({ payoutCents: 500 });
    await expectLedgerBalanced();
  });

  it("when the reversal falls short (the fee is left), held preorder releases net the rest, oldest first", async () => {
    const { seller, order } = await payTransferOrder("rev-short", 5_000);
    await loseChargeback(order, order.grossChargedCents);
    // The order's transfer covered the seller's share; Stripe's fee is left.
    expect(fake.state.reversals[0]).toMatchObject({ amount: order.sellerNetCents });
    const [open] = await recoveriesOf(seller);
    expect(open).toMatchObject({ status: "open", recoveredCents: order.sellerNetCents });
    expect(await recoverableLedger(seller)).toBe(-1_500);

    // A small preorder release is kept entirely; no transfer is sent.
    const drop = await seedDrop(seller);
    const preorder = await seedProduct(seller, { priceCents: 1_000, dropId: drop.id });
    const small = (await pay({ sellerId: seller, buyerId: await seedBuyer("short1"), chargeModel: "held", dropId: drop.id, items: [{ ...preorder, quantity: 1 }], stripeFeeCents: 59 })).order;
    await setTracking(small.id);
    const transfersBefore = fake.state.transfers.length;
    const first = await releaseOrderFunds(small.id, "tracking");
    expect(first.execution).toMatchObject({ state: "paid", amountCents: small.sellerNetCents, recoveryNettedCents: small.sellerNetCents, stripeTransferId: null });
    expect(fake.state.transfers).toHaveLength(transfersBefore);
    expect(await recoverableLedger(seller)).toBe(-(1_500 - small.sellerNetCents));
    await expectWalletMatchesLedger(drop.id, seller);

    // The next release clears the rest; the transfer is the remainder.
    const preorder2 = await seedProduct(seller, { priceCents: 3_000, dropId: drop.id });
    const big = (await pay({ sellerId: seller, buyerId: await seedBuyer("short2"), chargeModel: "held", dropId: drop.id, items: [{ ...preorder2, quantity: 1 }], stripeFeeCents: 117 })).order;
    await setTracking(big.id);
    const left = 1_500 - small.sellerNetCents;
    const second = await releaseOrderFunds(big.id, "tracking");
    expect(second.execution).toMatchObject({ state: "paid", recoveryNettedCents: left });
    expect(fake.state.transfers.at(-1)).toMatchObject({ amount: big.sellerNetCents - left });
    const [done] = await recoveriesOf(seller);
    expect(done).toMatchObject({ status: "recovered", recoveredCents: order.sellerNetCents + 1_500 });
    expect(await recoverableLedger(seller)).toBe(0);
    await expectWalletMatchesLedger(drop.id, seller);
    await expectLedgerBalanced();

    // A retried release never nets (or transfers) twice.
    const again = await releaseOrderFunds(big.id, "tracking");
    expect(again.execution?.state).toBe("paid");
    expect(await recoverableLedger(seller)).toBe(0);
  });
});

describe("lost chargeback while Brandthread still held the money", () => {
  it("cancels that order's payout and opens no debt", async () => {
    const seller = await seedSeller("held-lost");
    const drop = await seedDrop(seller);
    const preorder = await seedProduct(seller, { priceCents: 6_000, dropId: drop.id });
    const order = (await pay({ sellerId: seller, buyerId: await seedBuyer("held-lost"), chargeModel: "held", dropId: drop.id, items: [{ ...preorder, quantity: 1 }], stripeFeeCents: 204 })).order;
    expect(await held(seller, { orderId: order.id })).toBe(order.sellerNetCents);

    await loseChargeback(await reloadOrder(order.id), order.grossChargedCents);

    expect(await recoveriesOf(seller)).toHaveLength(0);
    expect(fake.state.reversals).toHaveLength(0);
    expect(await held(seller, { orderId: order.id })).toBe(0);
    expect((await reloadOrder(order.id)).fundsState).toBe("refunded");
    await expectWalletMatchesLedger(drop.id, seller);
    const balance = await call(app.base, "GET", "/api/finance/balance", seller);
    expect(balance.body).toMatchObject({ payoutsPaused: false, recoveryOwedCents: 0 });

    // Shipping it later never pays it out.
    await setTracking(order.id);
    const release = await releaseOrderFunds(order.id, "tracking");
    expect(release.status).toBe("funds_not_held");
    expect(fake.state.transfers).toHaveLength(0);
    await expectLedgerBalanced();
  });
});

describe("Stripe reinstates the funds after a lost chargeback", () => {
  it("pays back what was recovered (and the fee, when Stripe returns it)", async () => {
    const { seller, order } = await payTransferOrder("reinstate", 10_000);
    const share = Math.floor((4_000 * order.sellerNetCents) / order.grossChargedCents);
    await loseChargeback(order, 4_000);
    expect(fake.state.reversals[0].amount).toBe(share + 1_500);

    const reinstated = await deliver("charge.dispute.funds_reinstated", disputeFor(order, 4_000, "won", [1_500, -1_500]));
    expect(reinstated.status).toBe(200);

    const payback = fake.state.transfers.find((t) => t.metadata?.kind === "chargeback_reinstated");
    expect(payback).toMatchObject({ amount: share + 1_500, metadata: { orderId: order.id } });
    const [recovery] = await recoveriesOf(seller);
    expect(recovery.status).toBe("reinstated");
    expect(await accountBalanceCents(db, { account: "seller_paid_out", partyId: seller, orderId: order.id })).toBe(order.sellerNetCents);
    expect(await held(seller, { orderId: order.id })).toBe(0);
    expect(await recoverableLedger(seller)).toBe(0);
    await expectLedgerBalanced();

    // Redelivered: nothing is paid twice.
    await deliver("charge.dispute.funds_reinstated", disputeFor(order, 4_000, "won", [1_500, -1_500]));
    expect(fake.state.transfers.filter((t) => t.metadata?.kind === "chargeback_reinstated")).toHaveLength(1);
  });

  it("forgives an open debt; the seller keeps Stripe's fee only when Stripe kept it", async () => {
    const { seller, order } = await payTransferOrder("reinstate-open", 10_000);
    fake.state.failNextReversal = "definitive";
    await loseChargeback(order, order.grossChargedCents);
    expect(await recoverableLedger(seller)).toBe(-(order.sellerNetCents + 1_500));

    await deliver("charge.dispute.funds_reinstated", disputeFor(order, order.grossChargedCents, "won", [1_500, 0]));

    const [recovery] = await recoveriesOf(seller);
    expect(recovery).toMatchObject({ status: "open", forgivenCents: order.sellerNetCents });
    expect(await recoverableLedger(seller)).toBe(-1_500);
    expect(fake.state.transfers.filter((t) => t.metadata?.kind === "chargeback_reinstated")).toHaveLength(0);
    const rows = await db.select().from(sellerRecoveryApplications)
      .where(and(eq(sellerRecoveryApplications.recoveryId, recovery.id), eq(sellerRecoveryApplications.source, "reinstated")));
    expect(rows).toHaveLength(1);
    await expectLedgerBalanced();
  });
});
