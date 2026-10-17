import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders, orderTrackingEvents } from "@workspace/db";
import { eq } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `order-tracking-seller-${suffix}`;
let orderId = "";
let server: Server;
let base = "";

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

async function getOrder(id: string) {
  const response = await fetch(`${base}/api/orders/${id}`, {
    headers: { "x-test-user": sellerId },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId,
    buyerId: null,
    guestEmail: `guest-${suffix}@test.local`,
    orderNumber: `TRK-${suffix}`,
    status: "shipped",
    totalCents: 2500,
    subtotalCents: 2500,
    carrier: "UPS",
    trackingNumber: `1Z${suffix}`,
    trackingStatus: "in_transit",
    shippingAddress: { name: "Buyer", street: "1 St", city: "Portland", state: "OR", zip: "97205", country: "US" },
  }).returning({ id: orders.id });
  orderId = order.id;
  await db.insert(orderTrackingEvents).values([
    { orderId, trackingNumber: `1Z${suffix}`, status: "accepted", description: "Picked up", location: "Portland, OR", occurredAt: new Date("2026-01-01T10:00:00Z") },
    { orderId, trackingNumber: `1Z${suffix}`, status: "in_transit", description: "Departed facility", location: "Seattle, WA", occurredAt: new Date("2026-01-02T10:00:00Z") },
  ]);

  const { default: ordersRouter } = await import("../orders");
  const app = express();
  app.use(express.json());
  app.use("/api/orders", ordersRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orders).where(eq(orders.id, orderId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/orders/:id tracking (View Tracking)", () => {
  it("returns carrier scan history newest-first and the carrier tracking URL", async () => {
    const response = await getOrder(orderId);
    expect(response.status).toBe(200);
    expect(response.body.trackingStatus).toBe("in_transit");
    expect(response.body.trackingUrl).toBe(`https://www.ups.com/track?tracknum=1Z${suffix}`);
    expect(response.body.trackingEvents.map((e: any) => e.status)).toEqual(["in_transit", "accepted"]);
    expect(response.body.trackingEvents[0]).toMatchObject({ description: "Departed facility", location: "Seattle, WA", occurredAt: "2026-01-02T10:00:00.000Z" });
  });
});
