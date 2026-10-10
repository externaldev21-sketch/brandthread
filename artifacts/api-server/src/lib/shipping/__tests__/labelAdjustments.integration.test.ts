import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, ledgerPostings, ledgerTransactions, orders, shippingLabelAdjustments, shippingLabels } from "@workspace/db";

const notify = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../routes/notifications-feed", () => ({ publishNotification: (...args: unknown[]) => notify(...args) }));
vi.mock("../../stripe", () => ({ stripe: null }));

const { adjustmentInputError, adjustmentPath, recordLabelAdjustment } = await import("../labelAdjustments");

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `adj-seller-${suffix}`;
const orderIds: string[] = [];

async function makeLabel(order: Record<string, unknown>) {
  const n = orderIds.length;
  const [o] = await db.insert(orders).values({
    ownerId: sellerId, orderNumber: `ADJ-${suffix}-${n}`, status: "shipped", totalCents: 5000, subtotalCents: 5000, ...order,
  } as any).returning({ id: orders.id });
  orderIds.push(o.id);
  const [label] = await db.insert(shippingLabels).values({
    orderId: o.id, ownerId: sellerId, idempotencyKey: `adj-${suffix}-${n}`, providerRateId: `rate-${suffix}-${n}`,
    providerTransactionId: `txn-${suffix}-${n}`, trackingNumber: `TRK${suffix}${n}`, priceCents: 700, status: "active",
  }).returning({ id: shippingLabels.id });
  return { orderId: o.id, labelId: label.id, transactionId: `txn-${suffix}-${n}`, trackingNumber: `TRK${suffix}${n}` };
}

async function postingsFor(key: string) {
  const [tx] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.idempotencyKey, key));
  if (!tx) return [];
  return db.select({ account: ledgerPostings.account, amountCents: ledgerPostings.amountCents }).from(ledgerPostings)
    .where(eq(ledgerPostings.transactionId, tx.id));
}

beforeEach(() => notify.mockClear());

afterAll(async () => {
  if (orderIds.length) {
    await db.delete(shippingLabelAdjustments).where(inArray(shippingLabelAdjustments.orderId, orderIds));
    await db.delete(shippingLabels).where(inArray(shippingLabels.orderId, orderIds));
  }
});

describe("adjustment rules", () => {
  it("takes held orders from held funds and reverses paid-out ones", () => {
    expect(adjustmentPath({ chargeModel: "transfer", fundsState: "held", stripeTransferId: null })).toBe("from_held");
    expect(adjustmentPath({ chargeModel: "transfer", fundsState: "released", stripeTransferId: "tr_1" })).toBe("reverse_transfer");
    expect(adjustmentPath({ chargeModel: "destination", fundsState: null, stripeTransferId: "tr_1" })).toBe("reverse_transfer");
    expect(adjustmentPath({ chargeModel: null, fundsState: null, stripeTransferId: null })).toBe("owed");
  });

  it("validates an adjustment row", () => {
    expect(adjustmentInputError({ externalId: "a", amountCents: 250, trackingNumber: "1Z" })).toBeNull();
    expect(adjustmentInputError({ externalId: "a", amountCents: 0, trackingNumber: "1Z" })).toMatch(/amountCents/);
    expect(adjustmentInputError({ externalId: "a", amountCents: 12.5, trackingNumber: "1Z" })).toMatch(/amountCents/);
    expect(adjustmentInputError({ externalId: "a", amountCents: 250 })).toMatch(/transactionId/);
  });
});

describe("recordLabelAdjustment", () => {
  it("charges a held order's funds once and tells the seller", async () => {
    const l = await makeLabel({ chargeModel: "transfer", fundsState: "held" });
    const ext = `adj-held-${suffix}`;
    const first = await recordLabelAdjustment({ externalId: ext, amountCents: 425, reason: "Weight", transactionId: l.transactionId });
    expect(first).toMatchObject({ status: "from_held", orderId: l.orderId, sellerId });
    expect(await postingsFor(`label-adjustment/${ext}`)).toEqual(expect.arrayContaining([
      { account: "seller_held", amountCents: -425 },
      { account: "shipping_carrier", amountCents: 425 },
    ]));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: sellerId, type: "label_adjustment", targetId: l.orderId }));

    const again = await recordLabelAdjustment({ externalId: ext, amountCents: 425, transactionId: l.transactionId });
    expect(again).toEqual({ status: "duplicate" });
    const rows = await db.select().from(shippingLabelAdjustments).where(eq(shippingLabelAdjustments.externalId, ext));
    expect(rows).toHaveLength(1);
  });

  it("reverses the amount from a paid-out seller's transfer", async () => {
    const l = await makeLabel({ chargeModel: "transfer", fundsState: "released", stripeTransferId: `tr_${suffix}` });
    const createReversal = vi.fn().mockResolvedValue({ id: `trr_${suffix}` });
    const ext = `adj-paid-${suffix}`;
    const out = await recordLabelAdjustment(
      { externalId: ext, amountCents: 300, trackingNumber: l.trackingNumber },
      { stripe: { transfers: { createReversal } } as any },
    );
    expect(out).toMatchObject({ status: "recovered" });
    expect(createReversal).toHaveBeenCalledWith(`tr_${suffix}`, expect.objectContaining({ amount: 300 }), { idempotencyKey: `label-adjustment/${ext}/recovery` });
    expect(await postingsFor(`label-adjustment/${ext}/recovery`)).toEqual(expect.arrayContaining([
      { account: "seller_paid_out", amountCents: -300 },
      { account: "platform_funds_advanced", amountCents: 300 },
    ]));
    const [row] = await db.select().from(shippingLabelAdjustments).where(and(eq(shippingLabelAdjustments.externalId, ext)));
    expect(row).toMatchObject({ status: "recovered", stripeReversalId: `trr_${suffix}` });
  });

  it("records it as owed when the reversal fails", async () => {
    const l = await makeLabel({ chargeModel: "destination", fundsState: "released", stripeTransferId: `tr2_${suffix}` });
    const createReversal = vi.fn().mockRejectedValue(new Error("insufficient funds"));
    const out = await recordLabelAdjustment(
      { externalId: `adj-owed-${suffix}`, amountCents: 199, transactionId: l.transactionId },
      { stripe: { transfers: { createReversal } } as any },
    );
    expect(out).toMatchObject({ status: "owed" });
  });

  it("ignores an adjustment for a label it didn't buy", async () => {
    expect(await recordLabelAdjustment({ externalId: `adj-none-${suffix}`, amountCents: 100, trackingNumber: "NOPE" }))
      .toEqual({ status: "label_not_found" });
  });
});
