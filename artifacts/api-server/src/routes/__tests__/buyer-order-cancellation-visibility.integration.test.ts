/**
 * Regression coverage for the buyer order cancellation privacy boundary.
 *
 * The buyer detail endpoint may expose cancellation details only when the
 * cancellation has a customer-visible reason. Internal notes must not be
 * returned by themselves.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders } from "@workspace/db";
import { eq } from "drizzle-orm";

const buyerId = `buyer-cancellation-visibility-${crypto.randomBytes(6).toString("hex")}`;
let visibleOrderId = "";
let privateOrderId = "";
let server: Server;
let base = "";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

async function getOrder(id: string) {
  const response = await fetch(`${base}/api/buyer/orders/${id}`, {
    headers: { "x-test-user": buyerId },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const [visibleOrder, privateOrder] = await db.insert(orders).values([
    {
      ownerId: "cancellation-test-seller",
      buyerId,
      orderNumber: `VISIBLE-${buyerId}`,
      status: "cancelled",
      totalCents: 4200,
      subtotalCents: 4200,
      cancellationReason: "out_of_stock",
      cancellationNotes: "The supplier could not replenish this item.",
    },
    {
      ownerId: "cancellation-test-seller",
      buyerId,
      orderNumber: `PRIVATE-${buyerId}`,
      status: "cancelled",
      totalCents: 4200,
      subtotalCents: 4200,
      cancellationNotes: "Internal risk review — do not show the buyer.",
    },
  ]).returning({ id: orders.id });
  visibleOrderId = visibleOrder.id;
  privateOrderId = privateOrder.id;

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
  await db.delete(orders).where(eq(orders.id, visibleOrderId));
  await db.delete(orders).where(eq(orders.id, privateOrderId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/buyer/orders/:id cancellation visibility", () => {
  it("returns the reason and notes when cancellation details are customer-visible", async () => {
    const response = await getOrder(visibleOrderId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "cancelled",
      cancellationReason: "out_of_stock",
      cancellationNotes: "The supplier could not replenish this item.",
      isCustomerVisible: true,
    });
  });

  it("does not return private cancellation details when no visible reason exists", async () => {
    const response = await getOrder(privateOrderId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "cancelled",
      cancellationReason: null,
      cancellationNotes: null,
      isCustomerVisible: false,
    });
    expect(JSON.stringify(response.body)).not.toContain("Internal risk review");
  });
});