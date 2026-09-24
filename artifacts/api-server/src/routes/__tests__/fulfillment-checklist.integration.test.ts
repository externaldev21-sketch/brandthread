import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orders } from "@workspace/db";
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

vi.mock("../notifications-feed", () => ({ publishNotification: vi.fn(async () => {}) }));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `checklist-seller-${suffix}`;
let orderId = "";
let server: Server;
let base = "";

beforeAll(async () => {
  const [order] = await db.insert(orders).values({
    ownerId: sellerId,
    orderNumber: `CHK-${suffix}`,
    status: "processing",
    totalCents: 1500,
    subtotalCents: 1500,
  }).returning({ id: orders.id });
  orderId = order.id;

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

async function patchChecklist(body: unknown) {
  const response = await fetch(`${base}/api/orders/${orderId}/fulfillment-checklist`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-test-user": sellerId },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describe("PATCH /api/orders/:id/fulfillment-checklist", () => {
  it("persists isPicked and isPacked independently", async () => {
    const picked = await patchChecklist({ isPicked: true });
    expect(picked.status).toBe(200);
    expect(picked.body.fulfillmentPicked).toBe(true);
    expect(picked.body.fulfillmentPacked).toBe(false);

    const packed = await patchChecklist({ isPacked: true });
    expect(packed.status).toBe(200);
    expect(packed.body.fulfillmentPicked).toBe(true);
    expect(packed.body.fulfillmentPacked).toBe(true);
  });

  it("rejects a request with no fields", async () => {
    const response = await patchChecklist({});
    expect(response.status).toBe(400);
  });

  it("rejects non-boolean values", async () => {
    const response = await patchChecklist({ isPicked: "yes" });
    expect(response.status).toBe(400);
  });
});
