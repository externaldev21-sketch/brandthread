/**
 * Prepaid return labels against real Postgres with a fake Stripe: the seller
 * buys the label (cost on the same ledger path as an outbound label), approval
 * holds the refund, and the carrier's first scan issues it exactly once.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
  sendReturnStatusEmail: async () => true,
}));
vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = req.headers["x-test-user"]; next(); },
}));
vi.mock("../../../middlewares/requireRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../middlewares/requireRole")>()),
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const shippo = vi.hoisted(() => ({
  createShipment: vi.fn(),
  purchaseTransaction: vi.fn(),
  findTransaction: vi.fn(async () => null),
}));
vi.mock("../../shippo", () => ({ ...shippo, refundTransaction: vi.fn(), getRate: vi.fn() }));

import { db, orders, returns, shippingLabels } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { call, expectLedgerBalanced, ledgerKinds, pay, seedBuyer, seedProduct, seedSeller, startApp, uid } from "./moneyHarness";
import returnLabelsRouter from "../../../routes/return-labels";
import returnsRouter from "../../../routes/returns";
import { handleReturnLabelTracking } from "../../returnLabels";

let app: { base: string; close: () => Promise<void> };
beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/return-labels", returnLabelsRouter);
    server.use("/api/returns", returnsRouter);
  });
});
afterAll(async () => { await app?.close(); });

const address = { name: "Acme Returns", street1: "9 Dock Rd", city: "Austin", state: "TX", zip: "78702", country: "US" };
const parcel = { length: 12, width: 9, height: 3, weight: 1.5 };

async function seedReturn() {
  const seller = await seedSeller("retlabel");
  const buyer = await seedBuyer("retlabel");
  const product = await seedProduct(seller, { priceCents: 5_000 });
  const { order } = await pay({ sellerId: seller, buyerId: buyer, chargeModel: "destination", items: [{ ...product, quantity: 1 }], shippingCents: 500 });
  await db.update(orders).set({
    status: "delivered",
    shippingAddress: { name: "Sam Buyer", street: "1 Main St", city: "Denver", state: "CO", zip: "80202", country: "US" },
  }).where(eq(orders.id, order.id));
  const id = uid("ret");
  await db.insert(returns).values({ id, orderId: order.id, buyerId: buyer, sellerId: seller, reason: "Does not fit", status: "pending" });
  return { seller, buyer, order, returnId: id };
}

function carrierSaysYes() {
  shippo.createShipment.mockResolvedValue({
    object_id: "shp_ret",
    rates: [
      { object_id: "rate_pricey", amount: "9.80", currency: "USD", provider: "UPS", servicelevel: { name: "Ground" } },
      { object_id: "rate_cheap", amount: "6.25", currency: "USD", provider: "USPS", servicelevel: { name: "Ground Advantage" } },
    ],
  });
  shippo.purchaseTransaction.mockResolvedValue({
    object_id: "txn_ret", status: "SUCCESS", tracking_number: "9400RET1", label_url: "https://example.test/return.pdf",
    rate: { provider: "USPS", servicelevel: { name: "Ground Advantage" } },
  });
}

describe("prepaid return labels", () => {
  it("buys the cheapest label, approves the return, and refunds on the first scan only once", async () => {
    const { seller, buyer, order, returnId } = await seedReturn();
    carrierSaysYes();

    const bought = await call(app.base, "POST", `/api/return-labels/${returnId}`, seller, { returnAddress: address, parcel });
    expect(bought.status).toBe(201);
    expect(bought.body.label).toMatchObject({ carrier: "USPS", priceCents: 625, trackingNumber: "9400RET1" });
    expect(shippo.purchaseTransaction).toHaveBeenCalledWith("rate_cheap", expect.stringMatching(/^brandthread-return-label\//));
    // The shipment runs from the buyer's address to the seller's return address.
    expect(shippo.createShipment.mock.calls[0][0].address_from).toMatchObject({ city: "Denver", street1: "1 Main St" });
    expect(shippo.createShipment.mock.calls[0][0].address_to).toMatchObject({ city: "Austin" });

    const [row] = await db.select().from(returns).where(eq(returns.id, returnId));
    expect(row).toMatchObject({ status: "approved", refundOnScan: true, returnTrackingNumber: "9400RET1", returnCarrier: "USPS" });
    expect(await ledgerKinds(order.id)).toContain("label_advanced");

    // The buyer reads the label on their return.
    const view = await call(app.base, "GET", `/api/returns/${returnId}`, buyer);
    expect(view.body).toMatchObject({ returnLabelUrl: "https://example.test/return.pdf", returnTrackingNumber: "9400RET1" });

    // A repeat purchase is a no-op, not a second charge.
    const again = await call(app.base, "POST", `/api/return-labels/${returnId}`, seller, { returnAddress: address, parcel });
    expect(again.body.duplicate).toBe(true);
    expect(shippo.purchaseTransaction).toHaveBeenCalledTimes(1);

    const [label] = await db.select().from(shippingLabels).where(eq(shippingLabels.returnId, returnId));
    // Label creation alone (PRE_TRANSIT) is not a scan: no refund yet.
    expect(await handleReturnLabelTracking(label.id, "accepted")).toEqual({ refunded: false });
    expect(fake.state.refunds).toHaveLength(0);

    expect(await handleReturnLabelTracking(label.id, "in_transit")).toEqual({ refunded: true });
    const [after] = await db.select().from(returns).where(eq(returns.id, returnId));
    expect(after.status).toBe("refunded");
    expect(after.refundAmountCents).toBeGreaterThan(0);
    expect(fake.state.refunds).toHaveLength(1);

    // Later scans never refund again.
    expect(await handleReturnLabelTracking(label.id, "delivered")).toEqual({ refunded: false });
    expect(fake.state.refunds).toHaveLength(1);
    await expectLedgerBalanced();
  });

  it("refuses another seller's return and invalid input", async () => {
    const { returnId } = await seedReturn();
    const stranger = await seedSeller("retlabel-other");
    expect((await call(app.base, "POST", `/api/return-labels/${returnId}`, stranger, { returnAddress: address, parcel })).status).toBe(404);
    const seller = (await db.select().from(returns).where(eq(returns.id, returnId)))[0].sellerId;
    expect((await call(app.base, "POST", `/api/return-labels/${returnId}`, seller, { returnAddress: { name: "x" }, parcel })).status).toBe(400);
    expect((await call(app.base, "POST", `/api/return-labels/${returnId}`, seller, { returnAddress: address, parcel: { ...parcel, weight: 0 } })).status).toBe(400);
  });

  it("charges nothing and keeps the return open when the carrier rejects the label", async () => {
    const { seller, returnId, order } = await seedReturn();
    carrierSaysYes();
    shippo.purchaseTransaction.mockResolvedValueOnce({ object_id: "txn_bad", status: "ERROR" });
    const res = await call(app.base, "POST", `/api/return-labels/${returnId}`, seller, { returnAddress: address, parcel });
    expect(res.status).toBe(409);
    expect((await db.select().from(returns).where(eq(returns.id, returnId)))[0].status).toBe("pending");
    expect(await ledgerKinds(order.id)).not.toContain("label_advanced");
  });

  it("approve with refundOnScan approves without refunding", async () => {
    const { seller, returnId } = await seedReturn();
    const res = await call(app.base, "PATCH", `/api/returns/${returnId}/status`, seller, { status: "approved", refundOnScan: true });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(returns).where(eq(returns.id, returnId));
    expect(row).toMatchObject({ status: "approved", refundOnScan: true });
    expect(fake.state.refunds.filter((r: any) => r.metadata?.returnId === returnId)).toHaveLength(0);
  });
});
