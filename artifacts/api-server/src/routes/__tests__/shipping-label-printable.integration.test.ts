import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, shippingLabels } from "@workspace/db";
import { eq } from "drizzle-orm";

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
  createShipment: vi.fn(), purchaseTransaction: vi.fn(), findTransaction: vi.fn(), refundTransaction: vi.fn(),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `label-print-seller-${suffix}`;
let orderId = "";
let emptyOrderId = "";
let server: Server;
let base = "";

function label(values: Partial<typeof shippingLabels.$inferInsert>) {
  return {
    orderId, ownerId: sellerId, idempotencyKey: `k-${crypto.randomUUID()}`, providerRateId: "rate",
    priceCents: 899, carrier: "UPS", trackingNumber: "1Z", status: "active", ...values,
  };
}

beforeAll(async () => {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId, orderNumber: `PRT-${suffix}`, status: "fulfilled", totalCents: 5000, subtotalCents: 5000,
  }).returning({ id: orders.id });
  orderId = order.id;
  const [empty] = await db.insert(orders).values({
    ownerId: sellerId, orderNumber: `PRT2-${suffix}`, status: "processing", totalCents: 100, subtotalCents: 100,
  }).returning({ id: orders.id });
  emptyOrderId = empty.id;

  await db.insert(shippingLabels).values([
    label({ labelUrl: "https://x.test/old.pdf", itemIds: [crypto.randomUUID()], createdAt: new Date(Date.now() - 60_000) }),
    label({ labelUrl: "https://x.test/new.pdf", createdAt: new Date() }),
    label({ labelUrl: "https://x.test/voided.pdf", status: "voided", createdAt: new Date(Date.now() + 60_000) }),
    label({ labelUrl: "https://x.test/return.pdf", direction: "return", createdAt: new Date(Date.now() + 60_000) }),
    label({ orderId: emptyOrderId, labelUrl: null }),
  ]);

  const { default: router } = await import("../shipping-labels");
  const app = express();
  app.use(express.json());
  app.use("/api/shipping-labels", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(shippingLabels).where(eq(shippingLabels.ownerId, sellerId));
  await db.delete(orders).where(eq(orders.ownerId, sellerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(id: string, user = sellerId) {
  const response = await fetch(`${base}/api/shipping-labels/${id}/printable`, { headers: { "x-test-user": user } });
  return { status: response.status, body: await response.json() as { label: { labelUrl: string } | null } };
}

describe("GET /api/shipping-labels/:orderId/printable", () => {
  it("returns the newest active outbound label with a file", async () => {
    const { status, body } = await get(orderId);
    expect(status).toBe(200);
    expect(body.label?.labelUrl).toBe("https://x.test/new.pdf");
  });

  it("returns null when no printable label exists", async () => {
    expect((await get(emptyOrderId)).body.label).toBeNull();
  });

  it("never returns another seller's label", async () => {
    expect((await get(orderId, "someone-else")).body.label).toBeNull();
  });
});
