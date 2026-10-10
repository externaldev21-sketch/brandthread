import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, sellerLocations } from "@workspace/db";
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
const createShipment = vi.fn();
vi.mock("../../lib/shippo", () => ({
  createShipment: (...args: unknown[]) => createShipment(...args),
  purchaseTransaction: vi.fn(), findTransaction: vi.fn(), refundTransaction: vi.fn(),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `shipfrom-seller-${suffix}`;
const buyerAddress = { name: "Jordan Kim", line1: "1 Main St", city: "Los Angeles", state: "CA", zip: "90001", country: "US" };
const parcel = { length: 10, width: 8, height: 4, weight: 1 };
let orderId = "";
let server: Server;
let base = "";

function rates(body: Record<string, unknown>) {
  return fetch(`${base}/api/shipping-labels/${orderId}/rates`, {
    method: "POST", headers: { "content-type": "application/json", "x-test-user": sellerId },
    body: JSON.stringify({ ...parcel, ...body }),
  });
}

beforeAll(async () => {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId, orderNumber: `SF-${suffix}`, status: "processing", totalCents: 3000, subtotalCents: 3000,
    shippingAddress: buyerAddress,
  } as any).returning({ id: orders.id });
  orderId = order.id;
  const { default: router } = await import("../shipping-labels");
  const app = express();
  app.use(express.json());
  app.use("/api/shipping-labels", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  createShipment.mockReset();
  createShipment.mockResolvedValue({ object_id: `shp_${suffix}_${crypto.randomBytes(3).toString("hex")}`, rates: [{ object_id: `rate_${crypto.randomBytes(4).toString("hex")}`, amount: "7.25", currency: "USD", provider: "USPS", servicelevel: { name: "Ground Advantage" } }] });
});

afterAll(async () => {
  await db.delete(sellerLocations).where(eq(sellerLocations.ownerId, sellerId));
  await db.delete(orders).where(eq(orders.id, orderId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/shipping-labels/:orderId/rates ship-from", () => {
  it("refuses to quote from the buyer's own address when the seller has no location", async () => {
    const res = await rates({ fromAddress: buyerAddress });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "SHIP_FROM_REQUIRED" });
    expect(createShipment).not.toHaveBeenCalled();
  });

  it("uses the seller's primary location instead of the buyer", async () => {
    await db.insert(sellerLocations).values({
      ownerId: sellerId, name: "Studio", address: "500 Market St", city: "San Francisco", state: "CA", zip: "94105", isPrimary: true,
    });
    const res = await rates({ fromAddress: buyerAddress });
    expect(res.status).toBe(200);
    const sent = createShipment.mock.calls[0][0];
    expect(sent.address_from).toMatchObject({ street1: "500 Market St", city: "San Francisco", zip: "94105" });
    expect(sent.address_to).toMatchObject({ street1: "1 Main St", zip: "90001" });
  });

  it("uses the primary location when no address is sent", async () => {
    const res = await rates({});
    expect(res.status).toBe(200);
    expect(createShipment.mock.calls[0][0].address_from).toMatchObject({ street1: "500 Market St" });
  });
});
