import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, shippingLabelQuotes, shippingLabels, orderFundReservations } from "@workspace/db";
import { eq } from "drizzle-orm";

const purchaseTransaction = vi.fn(async (..._args: any[]) => ({
  object_id: "txn_test_1",
  status: "SUCCESS",
  tracking_number: "1Z999AA10123456784",
  label_url: "https://shippo-delivery.s3.amazonaws.com/test-label.pdf",
  rate: { provider: "UPS", servicelevel: { name: "Ground" } },
}));
const findTransaction = vi.fn(async (..._args: any[]) => null);

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../lib/shippo", () => ({
  createShipment: vi.fn(),
  purchaseTransaction: (...args: any[]) => purchaseTransaction(...args),
  findTransaction: (...args: any[]) => findTransaction(...args),
  refundTransaction: vi.fn(),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `label-purchase-seller-${suffix}`;
let orderId = "";
let server: Server;
let base = "";
const rateId = `rate_test_${suffix}`;

beforeAll(async () => {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId,
    orderNumber: `LBL-${suffix}`,
    status: "processing",
    totalCents: 5000,
    subtotalCents: 5000,
  }).returning({ id: orders.id });
  orderId = order.id;

  await db.insert(shippingLabelQuotes).values({
    orderId,
    ownerId: sellerId,
    providerShipmentId: `shp_test_${suffix}`,
    providerRateId: rateId,
    carrier: "UPS",
    service: "Ground",
    priceCents: 899,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  const { default: shippingLabelsRouter } = await import("../shipping-labels");
  const app = express();
  app.use(express.json());
  app.use("/api/shipping-labels", shippingLabelsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orderFundReservations).where(eq(orderFundReservations.orderId, orderId));
  await db.delete(shippingLabels).where(eq(shippingLabels.orderId, orderId));
  await db.delete(shippingLabelQuotes).where(eq(shippingLabelQuotes.orderId, orderId));
  await db.delete(orders).where(eq(orders.id, orderId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function purchase(idempotencyKey: string) {
  const response = await fetch(`${base}/api/shipping-labels/${orderId}/purchase`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": sellerId },
    body: JSON.stringify({ rateId, priceCents: 899, idempotencyKey }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describe("POST /api/shipping-labels/:orderId/purchase idempotency", () => {
  it("returns the same label on a repeated purchase call with the same idempotency key", async () => {
    const key = `fulfill-${orderId}`;
    const first = await purchase(key);
    expect(first.status).toBe(201);
    expect(first.body.label.status).toBe("active");
    expect(purchaseTransaction).toHaveBeenCalledTimes(1);

    const second = await purchase(key);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.label.id).toBe(first.body.label.id);
    // No second carrier purchase call — the carrier is never charged twice.
    expect(purchaseTransaction).toHaveBeenCalledTimes(1);

    const rows = await db.select().from(shippingLabels).where(eq(shippingLabels.orderId, orderId));
    expect(rows).toHaveLength(1);
  });
});
