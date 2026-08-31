import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders } from "@workspace/db";
import { eq } from "drizzle-orm";

const suffix = crypto.randomBytes(6).toString("hex");
const buyerId = `buyer-orders-test-buyer-${suffix}`;
const sellerId = `buyer-orders-test-seller-${suffix}`;
const orderNumber = `BT-BUYER-CANCEL-${suffix}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

let server: Server;
let base = "";

beforeAll(async () => {
  const { default: buyerRouter } = await import("../buyer");
  const app = express();
  app.use(express.json());
  app.use("/api/buyer", buyerRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orders).where(eq(orders.orderNumber, orderNumber));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/buyer/orders", () => {
  it("includes cancellationReason for cancelled buyer orders", async () => {
    const [order] = await db.insert(orders).values({
      ownerId: sellerId,
      buyerId,
      orderNumber,
      status: "cancelled",
      totalCents: 2_400,
      subtotalCents: 2_000,
      shippingCents: 400,
      cancellationReason: "buyer_requested",
      cancellationNotes: "Cancelled by buyer within the cancellation window.",
      shippingAddress: {
        name: "Buyer",
        street: "1 Test Street",
        city: "Austin",
        state: "TX",
        zip: "78701",
        country: "US",
      },
    }).returning({ id: orders.id });

    const response = await fetch(`${base}/api/buyer/orders`, {
      headers: { "x-test-user": buyerId },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: order.id,
        status: "cancelled",
        cancellationReason: "buyer_requested",
      }),
    ]));
  });
});