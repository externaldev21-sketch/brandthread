/**
 * Wave 1 audit (slice s08): seller order routes must answer malformed ids and
 * oversized totals with 4xx, never a 500 from Postgres.
 */
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

const published = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock("../notifications-feed", () => ({
  publishNotification: async (n: any) => { published.calls.push(n); },
}));
vi.mock("../../lib/brandthreadEmail", async (orig) => ({
  ...(await orig<typeof import("../../lib/brandthreadEmail")>()),
  sendOrderShippingEmail: async () => true,
}));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `w1s08-orders-${suffix}`;
let server: Server;
let base = "";

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": sellerId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const { default: ordersRouter } = await import("../orders");
  const app = express();
  app.use(express.json());
  app.use("/api/orders", ordersRouter);
  // Mirror the app: an unhandled error becomes a 500.
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "internal" });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orders).where(eq(orders.ownerId, sellerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("malformed order ids", () => {
  const bad = "not-a-uuid";
  it.each([
    ["GET", `/api/orders/${bad}`, undefined],
    ["GET", `/api/orders/${bad}/refunds`, undefined],
    ["PATCH", `/api/orders/${bad}/status`, { status: "processing" }],
    ["PATCH", `/api/orders/${bad}/tracking`, { trackingNumber: "1Z999AA10123456784", carrier: "UPS" }],
    ["POST", `/api/orders/${bad}/ship`, { carrier: "USPS", trackingNumber: "9400111899223197428490" }],
    ["POST", `/api/orders/${bad}/mark-delivered`, {}],
    ["PATCH", `/api/orders/${bad}/items-tracking`, { itemIds: [crypto.randomUUID()], trackingNumber: "1Z" }],
    ["PATCH", `/api/orders/${bad}/fulfillment-checklist`, { isPicked: true }],
    ["POST", `/api/orders/${bad}/refund`, { amountCents: 100, reason: "goodwill", requestId: "req-12345678" }],
  ])("%s %s → 404", async (method, path, body) => {
    const res = await call(method as string, path as string, body);
    expect(res.status).toBe(404);
  });

  it("still rejects an oversized id with a validation 400", async () => {
    const res = await call("PATCH", `/api/orders/${"a".repeat(201)}/status`, { status: "shipped" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/orders (manual order)", () => {
  it("answers 404 for a non-uuid customerId / dropId / variantId", async () => {
    const item = { productName: "Custom", quantity: 1, priceCents: 1000 };
    expect((await call("POST", "/api/orders", { customerId: "nope", items: [item] })).status).toBe(404);
    expect((await call("POST", "/api/orders", { dropId: "nope", items: [item] })).status).toBe(404);
    expect((await call("POST", "/api/orders", { items: [{ ...item, variantId: "nope" }] })).status).toBe(404);
  });

  it("refuses a total that overflows the int4 money columns with 400", async () => {
    const res = await call("POST", "/api/orders", {
      items: Array.from({ length: 3 }, () => ({ productName: "Big", quantity: 10_000, priceCents: 100_000 })),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/i);
  });

  it("still creates a normal custom-item order", async () => {
    const res = await call("POST", "/api/orders", {
      items: [{ productName: "Custom", quantity: 2, priceCents: 1500 }],
      shippingCents: 500,
    });
    expect(res.status).toBe(201);
    expect(res.body.totalCents).toBe(3500);
    const fetched = await call("GET", `/api/orders/${res.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.id).toBe(res.body.id);
  });
});

describe("buyer notifications from PATCH /api/orders/:id/status", () => {
  const buyerId = `w1s08-orders-buyer-${suffix}`;
  async function seed(status = "pending") {
    const [row] = await db.insert(orders).values({
      ownerId: sellerId, buyerId, orderNumber: `W1S08-${crypto.randomBytes(4).toString("hex")}`,
      status, totalCents: 2000, subtotalCents: 2000,
    }).returning({ id: orders.id });
    return row.id;
  }
  const settle = () => new Promise((r) => setTimeout(r, 300));

  it("marking shipped tells the buyer in-app + push, opening the buyer order screen", async () => {
    const id = await seed();
    published.calls.length = 0;
    const res = await call("PATCH", `/api/orders/${id}/status`, { status: "shipped" });
    expect(res.status).toBe(200);
    await settle();
    const shipped = published.calls.filter((n) => n.type === "order_shipped" && n.targetId === id);
    expect(shipped).toHaveLength(1);
    expect(shipped[0]).toMatchObject({
      userId: buyerId, pushCategory: "order", targetType: "buyer_order", title: "Your order has shipped",
    });
  });

  it("notifyCustomer:false ships quietly", async () => {
    const id = await seed();
    published.calls.length = 0;
    const res = await call("PATCH", `/api/orders/${id}/status`, { status: "shipped", notifyCustomer: false });
    expect(res.status).toBe(200);
    await settle();
    expect(published.calls.filter((n) => n.targetId === id)).toHaveLength(0);
  });

  it("a seller cancellation notice targets the buyer order screen", async () => {
    const id = await seed();
    published.calls.length = 0;
    const res = await call("PATCH", `/api/orders/${id}/status`, { status: "cancelled", reason: "out_of_stock" });
    expect(res.status).toBe(200);
    await settle();
    const cancelled = published.calls.filter((n) => n.type === "order_cancelled" && n.targetId === id);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].targetType).toBe("buyer_order");
  });
});
