import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, orderItems, shippingLabelQuotes, shippingLabels, orderFundReservations } from "@workspace/db";
import { eq } from "drizzle-orm";

let txnCounter = 0;
const purchaseTransaction = vi.fn(async (..._args: any[]) => {
  txnCounter += 1;
  return {
    object_id: `txn_partial_${txnCounter}`, status: "SUCCESS", tracking_number: `1ZPARTIAL${txnCounter}`,
    label_url: "https://example.test/label.pdf", rate: { provider: "UPS", servicelevel: { name: "Ground" } },
  };
});
const refundTransaction = vi.fn(async () => ({ object_id: "refund_1", status: "SUCCESS" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = req.headers["x-test-user"]; next(); },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/shippo", () => ({
  createShipment: vi.fn(),
  purchaseTransaction: (...args: any[]) => purchaseTransaction(...args),
  findTransaction: vi.fn(async () => null),
  refundTransaction: (...args: any[]) => (refundTransaction as any)(...args),
  shippoCarrierToken: () => null,
  registerTrack: vi.fn(),
  getTrack: vi.fn(),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `partial-label-seller-${suffix}`;
let orderId = "";
let itemA = "";
let itemB = "";
let server: Server;
let base = "";

beforeAll(async () => {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId, orderNumber: `PL-${suffix}`, status: "processing", totalCents: 9000, subtotalCents: 9000,
  }).returning({ id: orders.id });
  orderId = order.id;
  [{ id: itemA }, { id: itemB }] = await db.insert(orderItems).values([
    { orderId, productName: "Tee", quantity: 1, priceCents: 4500 },
    { orderId, productName: "Hat", quantity: 1, priceCents: 4500 },
  ]).returning({ id: orderItems.id });
  for (const n of [1, 2, 3]) {
    await db.insert(shippingLabelQuotes).values({
      orderId, ownerId: sellerId, providerShipmentId: `shp_${n}_${suffix}`, providerRateId: `rate_${n}_${suffix}`,
      carrier: "UPS", service: "Ground", priceCents: 500, expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
  }
  const { default: router } = await import("../shipping-labels");
  const app = express();
  app.use(express.json());
  app.use("/api/shipping-labels", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orderFundReservations).where(eq(orderFundReservations.orderId, orderId));
  await db.delete(shippingLabels).where(eq(shippingLabels.orderId, orderId));
  await db.delete(shippingLabelQuotes).where(eq(shippingLabelQuotes.orderId, orderId));
  await db.delete(orders).where(eq(orders.id, orderId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}/api/shipping-labels/${orderId}${path}`, {
    method: "POST", headers: { "content-type": "application/json", "x-test-user": sellerId }, body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const items = async () => Object.fromEntries((await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))).map((i) => [i.id, i]));

describe("labels for part of an order", () => {
  it("rejects malformed and foreign item ids", async () => {
    expect((await post("/purchase", { rateId: `rate_1_${suffix}`, idempotencyKey: "k0", itemIds: [] })).status).toBe(400);
    const foreign = await post("/purchase", { rateId: `rate_1_${suffix}`, idempotencyKey: "k0", itemIds: [crypto.randomUUID()] });
    expect(foreign.status).toBe(409);
    expect(foreign.body.code).toBe("INVALID_LABEL_ITEMS");
  });

  it("buys a label for one item and ships only that item", async () => {
    const res = await post("/purchase", { rateId: `rate_1_${suffix}`, idempotencyKey: "k1", itemIds: [itemA] });
    expect(res.status).toBe(201);
    expect(res.body.label.itemIds).toEqual([itemA]);
    const rows = await items();
    expect(rows[itemA].trackingNumber).toBe("1ZPARTIAL1");
    expect(rows[itemB].trackingNumber).toBeNull();
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order.status).toBe("shipped");
  });

  it("is idempotent for the same key", async () => {
    const again = await post("/purchase", { rateId: `rate_1_${suffix}`, idempotencyKey: "k1", itemIds: [itemA] });
    expect(again.body.duplicate).toBe(true);
    expect(purchaseTransaction).toHaveBeenCalledTimes(1);
  });

  it("refuses an item that already shipped, then labels the remaining item on the shipped order", async () => {
    const overlap = await post("/purchase", { rateId: `rate_2_${suffix}`, idempotencyKey: "k2", itemIds: [itemA] });
    expect(overlap.status).toBe(409);
    const second = await post("/purchase", { rateId: `rate_2_${suffix}`, idempotencyKey: "k3", itemIds: [itemB] });
    expect(second.status).toBe(201);
    const rows = await items();
    expect(rows[itemB].trackingNumber).toBe("1ZPARTIAL2");
    expect(rows[itemA].trackingNumber).toBe("1ZPARTIAL1");
  });

  it("voiding one parcel's label releases only its items", async () => {
    const [label] = await db.select().from(shippingLabels).where(eq(shippingLabels.trackingNumber, "1ZPARTIAL2"));
    const res = await post(`/${label.id}/void`, {});
    expect(res.status).toBe(200);
    const rows = await items();
    expect(rows[itemB].trackingNumber).toBeNull();
    expect(rows[itemA].trackingNumber).toBe("1ZPARTIAL1");
  });
});
