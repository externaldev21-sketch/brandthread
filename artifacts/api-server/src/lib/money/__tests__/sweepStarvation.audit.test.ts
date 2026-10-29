/**
 * Audit (B01): money sweeps must make progress past rows they can never act
 * on, and the cart group total must take bundle savings off.
 *  - label-cost recovery: labels on orders with no transfer to reverse are
 *    skipped by recoverLabelCost, so they must not fill the sweep's page;
 *  - loyalty top-ups: cancelled orders (e.g. fully refunded as store credit,
 *    which keeps their funds state) are never due, so they must not fill the
 *    sweep's page either.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("./fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../push")>()),
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

import { db, orders, shippingLabels } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { expectLedgerBalanced, seedSeller, uid } from "./moneyHarness";
import { recordLabelPurchased } from "../escrow";
import { runMoneySweep } from "../dropLifecycle";
import { sweepLoyaltySellerTopups } from "../loyaltyTopup";
import { groupChargeTotalCents } from "../cartCheckout";

const BLOCKERS = 110; // more than one sweep page (100)

beforeEach(() => fake.reset());
afterAll(async () => { await expectLedgerBalanced(); });

async function seedOrders(sellerId: string, count: number, values: Partial<typeof orders.$inferInsert>) {
  return db.insert(orders).values(Array.from({ length: count }, () => ({
    ownerId: sellerId, orderNumber: uid("BT-AUD"), status: "processing", totalCents: 5_000, subtotalCents: 5_000,
    paidAt: new Date(), stripePaymentIntentId: `pi_${uid("aud").replace(/-/g, "_")}`, ...values,
  }))).returning({ id: orders.id, chargeModel: orders.chargeModel });
}

async function labelFor(orderId: string, sellerId: string, chargeModel: string) {
  const [label] = await db.insert(shippingLabels).values({
    orderId, ownerId: sellerId, idempotencyKey: uid("label"), providerRateId: uid("rate"),
    carrier: "USPS", service: "Ground", trackingNumber: `9400${uid("trk")}`, priceCents: 700, status: "active",
  }).returning({ id: shippingLabels.id });
  await db.transaction((tx) => recordLabelPurchased(tx, {
    labelId: label.id, orderId, sellerId, dropId: null, chargeModel, priceCents: 700,
  }));
  return label.id;
}

describe("label-cost recovery sweep", () => {
  it("still recovers a label when many labels have no transfer to reverse", async () => {
    const seller = await seedSeller("aud-label");
    // Transfer orders refunded before their transfer went out: the label was
    // fronted (label_advanced) but there is nothing to reverse it from.
    const stuck = await seedOrders(seller, BLOCKERS, { chargeModel: "transfer", fundsState: "refunded", status: "cancelled" });
    for (const order of stuck) await labelFor(order.id, seller, "transfer");
    const [good] = await seedOrders(seller, 1, {
      chargeModel: "destination", fundsState: "settled_direct", stripeTransferId: `tr_${uid("good").replace(/-/g, "_")}`,
    });
    const goodLabel = await labelFor(good.id, seller, "destination");

    const recovered = async () => (await db.execute(sql`
      SELECT 1 FROM ledger_transactions WHERE idempotency_key = ${`label-recovery/${goodLabel}`}
    `)).rows.length > 0;
    for (let run = 0; run < 3 && !(await recovered()); run++) await runMoneySweep();
    expect(await recovered()).toBe(true);
    expect(fake.state.reversals.some((r: any) => r.metadata?.labelId === goodLabel)).toBe(true);
  }, 120_000);
});

describe("loyalty top-up sweep", () => {
  it("still tops up a due order when many cancelled orders carry unpaid loyalty", async () => {
    const seller = await seedSeller("aud-loyalty");
    // Fully refunded as store credit: cancelled, funds state kept, never due.
    await seedOrders(seller, BLOCKERS, {
      chargeModel: "destination", fundsState: "settled_direct", status: "cancelled", loyaltyAppliedCents: 300,
    });
    const [due] = await seedOrders(seller, 1, {
      chargeModel: "destination", fundsState: "settled_direct", status: "processing", loyaltyAppliedCents: 300,
    });
    const toppedUp = async () => {
      const [row] = await db.select({ id: orders.stripeLoyaltyTransferId }).from(orders).where(eq(orders.id, due.id));
      return Boolean(row?.id);
    };
    for (let run = 0; run < 3 && !(await toppedUp()); run++) await sweepLoyaltySellerTopups({ stripe: fake.stripe as any });
    expect(await toppedUp()).toBe(true);
  }, 120_000);
});

describe("groupChargeTotalCents", () => {
  it("takes bundle savings off the full-price subtotal, like the route's total", () => {
    // PricedGroup.subtotalCents is the full line price; the bundle saves 2,000.
    expect(groupChargeTotalCents({
      subtotalCents: 10_000, bundleDiscountCents: 2_000, shippingCents: 1_200, discountCents: 1_000, taxCents: 656,
    })).toBe(10_000 - 2_000 + 1_200 - 1_000 + 656);
    expect(groupChargeTotalCents({ subtotalCents: 5_000, shippingCents: 500, discountCents: 250, taxCents: 410 }))
      .toBe(5_000 + 500 - 250 + 410);
  });
});
