/**
 * What a seller owes is collected from their next payouts — real Postgres,
 * in-memory Stripe, the real dispute webhook processor:
 *
 *  - a refund before payout: the Stripe fee the order's held money can't
 *    cover is a seller debt (not an orphan row), shown as owed, and netted
 *    from the seller's next one-page-checkout transfer exactly once;
 *  - a lost chargeback on a paid-out order plus Stripe's $15 dispute fee
 *    become a seller debt when the dispute closes, netted from the next drop
 *    release;
 *  - a won dispute: nothing owed when Stripe returns its fee, the fee owed
 *    when Stripe keeps it.
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
  sendOrderShippingEmail: async () => true,
}));

vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../../middlewares/requireRole", async (importOriginal) => {
  const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    ...(await importOriginal<typeof import("../../../middlewares/requireRole")>()),
    teamContext: pass, requireRole: pass, requirePermission: pass, requirePayoutsRead: pass,
  };
});

import { db, orders } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { call, expectLedgerBalanced, pay, reloadOrder, seedBuyer, seedDrop, seedProduct, seedSeller, startApp, uid } from "./moneyHarness";
import financeRouter from "../../../routes/finance";
import { accountBalanceCents } from "../ledger";
import { refundOrder } from "../refunds";
import { settleTransferOrder } from "../cartTransfers";
import { releaseOrderFunds } from "../escrow";
import { sellerRecoveryOwedCents } from "../sellerRecovery";
import { processDisputeEvent } from "../../disputes/webhook";
import { buildDisputeDeps } from "../../disputes/store";

const DAY = 86_400_000;

let app: Awaited<ReturnType<typeof startApp>>;
beforeAll(async () => {
  process.env.PAYOUT_MODE = "hold";
  app = await startApp((server) => server.use("/api/finance", financeRouter));
});
afterAll(async () => {
  await app.close();
  await expectLedgerBalanced();
});
beforeEach(() => { fake.reset(); });

async function buy(seller: string, priceCents: number, options: { dropId?: string } = {}) {
  const buyer = await seedBuyer("rr");
  const product = await seedProduct(seller, { priceCents, dropId: options.dropId ?? null });
  const { order } = await pay({
    sellerId: seller, buyerId: buyer, chargeModel: options.dropId ? "held" : "transfer", dropId: options.dropId ?? null,
    items: [{ variantId: product.variantId, productName: product.productName, priceCents, quantity: 1 }],
  });
  return order;
}

/** Delivered, buffer passed: the hold-until-delivered gate lets it pay out. */
async function deliver(orderId: string) {
  await db.update(orders).set({
    status: "delivered", trackingNumber: `1Z${uid("trk")}`,
    deliveredAt: new Date(Date.now() - 5 * DAY), payoutReleaseAt: new Date(Date.now() - 2 * DAY),
  }).where(eq(orders.id, orderId));
}

const owed = (seller: string) => sellerRecoveryOwedCents(db, seller);

const disputeDeps = buildDisputeDeps(async () => {});
async function disputeEvent(type: string, dispute: Record<string, unknown>) {
  await processDisputeEvent({ id: `evt_${uid("dp").replace(/-/g, "_")}`, type, created: Math.floor(Date.now() / 1000), data: { object: dispute } }, disputeDeps);
}

describe("refund before payout", () => {
  it("books the uncovered Stripe fee as a seller debt and nets it from the next transfer, once", async () => {
    const seller = await seedSeller("rr-refund");
    const first = await buy(seller, 6000);
    expect(first.fundsState).toBe("held");

    await refundOrder({
      orderId: first.id, reason: "buyer_cancelled", initiatedBy: first.buyerId!, idempotencyKey: `buyer-cancel/${first.id}`,
      cancelOrder: { reason: "buyer_cancelled", notes: null, restock: true },
    });
    // The order held only the seller's net; the buyer got everything back
    // except Brandthread's returned 5%… so the seller owes the processing fee.
    const gross = first.grossChargedCents;
    const expectedDebt = gross - first.platformFeeCents - first.sellerNetCents;
    expect(expectedDebt).toBeGreaterThan(0);
    expect(await owed(seller)).toBe(expectedDebt);
    // No orphan seller-level held row any more.
    expect(await accountBalanceCents(db, { account: "seller_held", partyId: seller, orderId: null })).toBe(0);
    // …and the seller sees it as owed.
    const summary = await call(app.base, "GET", "/api/finance/summary", seller);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ owed: { amount: expectedDebt }, recoveryOwedCents: expectedDebt });

    const second = await buy(seller, 9000);
    await deliver(second.id);
    expect(await settleTransferOrder(second.id, { stripe: fake.stripe as any })).toBe("transferred");
    expect(fake.state.transfers).toHaveLength(1);
    expect(fake.state.transfers[0].amount).toBe(second.sellerNetCents - expectedDebt);
    expect(await owed(seller)).toBe(0);
    expect((await reloadOrder(second.id)).recoveryNettedCents).toBe(expectedDebt);

    // A retry neither transfers nor nets again.
    expect(await settleTransferOrder(second.id, { stripe: fake.stripe as any })).toBe("already");
    expect(fake.state.transfers).toHaveLength(1);
    expect(await accountBalanceCents(db, { account: "seller_held", partyId: seller, orderId: second.id })).toBe(0);
  });
});

describe("chargebacks", () => {
  it("a lost chargeback on a paid-out order + the $15 fee are recovered from the next release", async () => {
    const seller = await seedSeller("rr-lost");
    const order = await buy(seller, 3000);
    await deliver(order.id);
    expect(await settleTransferOrder(order.id, { stripe: fake.stripe as any })).toBe("transferred");

    const dispute = {
      id: `dp_${uid("lost").replace(/-/g, "_")}`, amount: order.grossChargedCents, currency: "usd",
      payment_intent: order.stripePaymentIntentId, reason: "product_not_received",
    };
    await disputeEvent("charge.dispute.created", { ...dispute, status: "needs_response" });
    await disputeEvent("charge.dispute.funds_withdrawn", {
      ...dispute, status: "needs_response", balance_transactions: [{ amount: -order.grossChargedCents, fee: 1500 }],
    });
    // While the dispute is open nothing is collected.
    expect(await owed(seller)).toBe(0);

    const closed = { ...dispute, status: "lost", balance_transactions: [{ amount: -order.grossChargedCents, fee: 1500 }] };
    await disputeEvent("charge.dispute.closed", closed);
    expect(await owed(seller)).toBe(order.grossChargedCents + 1500);
    expect(await accountBalanceCents(db, { account: "platform_funds_advanced", partyId: seller })).toBe(0);
    expect(await accountBalanceCents(db, { account: "stripe_dispute_fees" , orderId: order.id })).toBe(1500);
    // A replayed close changes nothing.
    await disputeEvent("charge.dispute.closed", closed);
    expect(await owed(seller)).toBe(order.grossChargedCents + 1500);

    // The seller's next payout is a drop release; the debt comes out first.
    const drop = await seedDrop(seller);
    const next = await buy(seller, 20000, { dropId: drop.id });
    await deliver(next.id);
    const released = await releaseOrderFunds(next.id, "manual", { stripe: fake.stripe as any });
    expect(released).toMatchObject({ status: "requested" });
    expect(released.execution?.state).toBe("paid");
    expect(released.execution?.recoveryNettedCents).toBe(order.grossChargedCents + 1500);
    const transfer = fake.state.transfers[fake.state.transfers.length - 1];
    expect(transfer.amount).toBe(released.execution!.amountCents - (order.grossChargedCents + 1500));
    expect(await owed(seller)).toBe(0);
  });

  it("a won dispute: nothing owed when Stripe returns its fee, the fee owed when it keeps it", async () => {
    const seller = await seedSeller("rr-won");
    const run = async (feeReturned: boolean) => {
      const order = await buy(seller, 4000);
      await deliver(order.id);
      await settleTransferOrder(order.id, { stripe: fake.stripe as any });
      const dispute = {
        id: `dp_${uid("won").replace(/-/g, "_")}`, amount: order.grossChargedCents, currency: "usd",
        payment_intent: order.stripePaymentIntentId, reason: "fraudulent",
      };
      const withdrawn = { amount: -order.grossChargedCents, fee: 1500 };
      const reinstated = { amount: order.grossChargedCents, fee: feeReturned ? -1500 : 0 };
      await disputeEvent("charge.dispute.created", { ...dispute, status: "needs_response" });
      await disputeEvent("charge.dispute.funds_withdrawn", { ...dispute, status: "needs_response", balance_transactions: [withdrawn] });
      await disputeEvent("charge.dispute.funds_reinstated", { ...dispute, status: "won", balance_transactions: [withdrawn, reinstated] });
      await disputeEvent("charge.dispute.closed", { ...dispute, status: "won", balance_transactions: [withdrawn, reinstated] });
    };
    await run(true);
    expect(await owed(seller)).toBe(0);
    await run(false);
    expect(await owed(seller)).toBe(1500);
    expect(await accountBalanceCents(db, { account: "platform_funds_advanced", partyId: seller })).toBe(0);
  });
});
