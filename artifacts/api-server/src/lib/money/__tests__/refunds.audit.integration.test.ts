/**
 * Audit regressions for lib/money/refunds.ts (real Postgres, fake Stripe):
 *  - a Thread Cash refund of an order without a drop leaves the same seller
 *    debt as a card refund (seller_recoverable), not an orphan seller_held row;
 *  - two refunds of one released order in flight at once both count toward
 *    the release's reversed total;
 *  - charge.refunded for a cart PaymentIntent shared by several orders is
 *    compared with all of them (a Brandthread refund of one order is not a
 *    dashboard refund of another);
 *  - a refund Stripe failed after accepting is not silently re-run under the
 *    same row (its ledger key is already used).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  sendBrandthreadEmail: async () => true,
}));
vi.mock("../../threadCash/wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../threadCash/wallet")>()),
  isFeatureEnabled: async (key: string) => key === "threadCashCheckoutDiscount",
}));

import { db, orderRefunds, orderReleases, orders } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fake } from "./fakeStripe";
import {
  expectLedgerBalanced, expectWalletMatchesLedger, pay, reloadOrder, seedBuyer, seedDrop, seedProduct, seedSeller, setTracking,
} from "./moneyHarness";
import { accountBalanceCents } from "../ledger";
import { recordExternalRefunds, recordRefundFailedLater, refundOrder } from "../refunds";
import { releaseOrderFunds } from "../escrow";
import { sellerRecoveryOwedCents } from "../sellerRecovery";

const originalPayoutMode = process.env.PAYOUT_MODE;
function restorePayoutMode() {
  if (originalPayoutMode === undefined) delete process.env.PAYOUT_MODE;
  else process.env.PAYOUT_MODE = originalPayoutMode;
}
afterAll(async () => {
  restorePayoutMode();
  await expectLedgerBalanced();
});
beforeEach(() => { fake.reset(); restorePayoutMode(); });

async function threadCashRefundOfTransferOrder(tag: string) {
  const seller = await seedSeller(tag);
  const buyer = await seedBuyer(tag);
  const product = await seedProduct(seller, { priceCents: 6_000 });
  const { order } = await pay({
    sellerId: seller, buyerId: buyer, chargeModel: "transfer", items: [{ ...product, quantity: 1 }], stripeFeeCents: 204,
  });
  expect(order.dropId).toBeNull();
  const fundsStateAtRefund = order.fundsState;
  const result = await refundOrder({
    orderId: order.id, reason: "return_approved", initiatedBy: "test",
    idempotencyKey: `${tag}/${order.id}`, method: "thread_cash", stripe: fake.stripe as any,
  });
  expect(result.method).toBe("thread_cash");
  return { seller, order, result, fundsStateAtRefund };
}

describe("Thread Cash refund of an order without a drop", () => {
  it("held: books what the order's held money can't cover as a seller debt, like a card refund", async () => {
    process.env.PAYOUT_MODE = "hold";
    const { seller, order, result, fundsStateAtRefund } = await threadCashRefundOfTransferOrder("audit-tc-held");
    expect(fundsStateAtRefund).toBe("held");
    // The order held only the seller's net; the rest of the seller's share
    // (Stripe's fee) is owed by the seller and netted from later payouts.
    const expectedDebt = order.grossChargedCents - result.platformFeeRefundCents - order.sellerNetCents;
    expect(expectedDebt).toBeGreaterThan(0);
    expect(await sellerRecoveryOwedCents(db, seller)).toBe(expectedDebt);
    expect(await accountBalanceCents(db, { account: "seller_held", partyId: seller, orderId: null })).toBe(0);
    await expectLedgerBalanced();
  });

  it("released: what the order's transfer can't return is a seller debt, like a card refund", async () => {
    const { seller, order, result, fundsStateAtRefund } = await threadCashRefundOfTransferOrder("audit-tc-released");
    expect(fundsStateAtRefund).toBe("released");
    expect(fake.state.reversals).toHaveLength(1);
    const expectedDebt = order.grossChargedCents - result.platformFeeRefundCents - fake.state.reversals[0].amount;
    expect(expectedDebt).toBeGreaterThan(0);
    expect(await sellerRecoveryOwedCents(db, seller)).toBe(expectedDebt);
    expect(await accountBalanceCents(db, { account: "seller_held", partyId: seller, orderId: null })).toBe(0);
    await expectLedgerBalanced();
  });
});

describe("concurrent refunds of a released preorder", () => {
  it("adds both transfer reversals to the release", async () => {
    const seller = await seedSeller("audit-rev-race");
    const buyer = await seedBuyer("audit-rev-race");
    const drop = await seedDrop(seller);
    const product = await seedProduct(seller, { priceCents: 6_000, dropId: drop.id });
    const { order } = await pay({
      sellerId: seller, buyerId: buyer, chargeModel: "held", dropId: drop.id,
      items: [{ ...product, quantity: 1 }], stripeFeeCents: 204,
    });
    await setTracking(order.id);
    expect((await releaseOrderFunds(order.id, "tracking", { stripe: fake.stripe as any })).execution?.state).toBe("paid");

    // Refund A reaches Stripe and stalls there while refund B runs start to finish.
    let entered!: () => void;
    const enteredStripe = new Promise<void>((resolve) => { entered = resolve; });
    let open!: () => void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const stalled = {
      ...fake.stripe,
      refunds: {
        create: async (...args: any[]) => {
          entered();
          await gate;
          return (fake.stripe.refunds.create as any)(...args);
        },
      },
    };
    const a = refundOrder({
      orderId: order.id, amountCents: 1_000, reason: "return_approved", initiatedBy: "test",
      idempotencyKey: `audit-rev-race-a/${order.id}`, stripe: stalled as any,
    });
    await enteredStripe;
    const b = await refundOrder({
      orderId: order.id, amountCents: 1_500, reason: "return_approved", initiatedBy: "test",
      idempotencyKey: `audit-rev-race-b/${order.id}`, stripe: fake.stripe as any,
    });
    open();
    const first = await a;

    expect(fake.state.reversals).toHaveLength(2);
    const reversed = fake.state.reversals.reduce((sum, r) => sum + r.amount, 0);
    expect(reversed).toBe(1_000 - first.platformFeeRefundCents + 1_500 - b.platformFeeRefundCents);
    const [release] = await db.select().from(orderReleases).where(eq(orderReleases.orderId, order.id));
    expect(release.reversedCents).toBe(reversed);
    expect(release.state).toBe("paid");
    await expectWalletMatchesLedger(drop.id, seller);
    await expectLedgerBalanced();
  });
});

describe("charge.refunded for a cart payment shared by several orders", () => {
  async function cartOfTwo(tag: string) {
    const sellerA = await seedSeller(`${tag}-a`);
    const sellerB = await seedSeller(`${tag}-b`);
    const buyer = await seedBuyer(tag);
    const productA = await seedProduct(sellerA, { priceCents: 4_000 });
    const productB = await seedProduct(sellerB, { priceCents: 3_000 });
    const a = (await pay({ sellerId: sellerA, buyerId: buyer, chargeModel: "transfer", items: [{ ...productA, quantity: 1 }] })).order;
    const b = (await pay({ sellerId: sellerB, buyerId: buyer, chargeModel: "transfer", items: [{ ...productB, quantity: 1 }] })).order;
    // One-page checkout: both orders are paid by the same PaymentIntent and charge.
    await db.update(orders).set({ stripePaymentIntentId: a.stripePaymentIntentId, stripeChargeId: a.stripeChargeId })
      .where(eq(orders.id, b.id));
    return { a, b: await reloadOrder(b.id) };
  }

  it("does not record Brandthread's refund of one order as a dashboard refund of the other", async () => {
    const { a, b } = await cartOfTwo("audit-cart-own");
    await refundOrder({
      orderId: b.id, reason: "seller_cancelled", initiatedBy: "test", idempotencyKey: `audit-cart-own/${b.id}`, stripe: fake.stripe as any,
    });
    const result = await recordExternalRefunds({
      paymentIntentId: a.stripePaymentIntentId, chargeId: a.stripeChargeId,
      cumulativeRefundedCents: b.grossChargedCents, providerEventId: `evt_audit_cart_own_${a.id}`,
    });
    expect(result.recordedCents).toBe(0);
    expect((await reloadOrder(a.id)).refundedCents).toBe(0);
    expect(await db.select().from(orderRefunds).where(eq(orderRefunds.orderId, a.id))).toHaveLength(0);
    await expectLedgerBalanced();
  });

  it("records only the part Brandthread did not refund, once", async () => {
    const { a, b } = await cartOfTwo("audit-cart-ext");
    await refundOrder({
      orderId: b.id, reason: "seller_cancelled", initiatedBy: "test", idempotencyKey: `audit-cart-ext/${b.id}`, stripe: fake.stripe as any,
    });
    const event = {
      paymentIntentId: a.stripePaymentIntentId, chargeId: a.stripeChargeId,
      cumulativeRefundedCents: b.grossChargedCents + 500, providerEventId: `evt_audit_cart_ext_${a.id}`,
    };
    expect((await recordExternalRefunds(event)).recordedCents).toBe(500);
    expect((await recordExternalRefunds(event)).recordedCents).toBe(0);
    expect((await recordExternalRefunds({ ...event, providerEventId: `${event.providerEventId}_again` })).recordedCents).toBe(0);
    expect((await reloadOrder(a.id)).refundedCents).toBe(500);
    expect((await reloadOrder(b.id)).refundedCents).toBe(b.grossChargedCents);
    await expectLedgerBalanced();
  });
});

describe("retrying a refund Stripe failed after accepting it", () => {
  it("is refused instead of refunding the card again without a ledger entry", async () => {
    const seller = await seedSeller("audit-late-fail");
    const product = await seedProduct(seller, { priceCents: 3_000 });
    const { order } = await pay({
      sellerId: seller, buyerId: await seedBuyer("audit-late-fail"), chargeModel: "destination", items: [{ ...product, quantity: 1 }],
    });
    const key = `audit-late-fail/${order.id}`;
    const first = await refundOrder({ orderId: order.id, reason: "seller_refund", initiatedBy: "test", idempotencyKey: key, stripe: fake.stripe as any });
    expect(await recordRefundFailedLater(first.stripeRefundId!)).toBe(true);

    await expect(refundOrder({ orderId: order.id, reason: "seller_refund", initiatedBy: "test", idempotencyKey: key, stripe: fake.stripe as any }))
      .rejects.toMatchObject({ code: "REFUND_FAILED_AFTER_SUCCESS", status: 409 });
    expect(fake.state.refunds).toHaveLength(1);
    expect((await reloadOrder(order.id)).refundedCents).toBe(0);

    // A new refund (new key) still works and is booked.
    const fresh = await refundOrder({
      orderId: order.id, reason: "seller_refund", initiatedBy: "test", idempotencyKey: `${key}/again`, stripe: fake.stripe as any,
    });
    expect(fresh.duplicate).toBe(false);
    expect((await reloadOrder(order.id)).refundedCents).toBe(3_000);
    await expectLedgerBalanced();
  });
});
