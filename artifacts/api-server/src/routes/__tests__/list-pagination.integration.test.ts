/**
 * Opt-in pagination on legacy list endpoints. The shipped app calls these
 * without params and expects the same bare-array shape; paging is opt-in via
 * ?limit=&offset=, with X-Pagination-* headers describing the page.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, drops, orderItems, orders } from "@workspace/db";
import { inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));

vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../notifications-feed", () => ({ publishNotification: vi.fn(async () => {}) }));

const suffix = crypto.randomBytes(6).toString("hex");
const buyerId = `list-page-buyer-${suffix}`;
const sellerId = `list-page-seller-${suffix}`;
const orderIds: string[] = [];
const dropIds: string[] = [];
let server: Server;
let base = "";

// Oldest first; created_at strictly increasing so newest-first order is known.
const ORDER_COUNT = 3;

beforeAll(async () => {
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  for (let i = 0; i < ORDER_COUNT; i += 1) {
    const [order] = await db.insert(orders).values({
      ownerId: sellerId,
      buyerId,
      orderNumber: `LP-${suffix}-${i}`,
      status: "pending",
      totalCents: 1_000 + i,
      subtotalCents: 1_000 + i,
      createdAt: new Date(t0 + i * 60_000),
    }).returning({ id: orders.id });
    orderIds.push(order.id);
    // i items on order i, so itemCount is checkable per row.
    for (let k = 0; k < i; k += 1) {
      await db.insert(orderItems).values({ orderId: order.id, productName: `Item ${k}`, quantity: 1, priceCents: 500 });
    }
    const [drop] = await db.insert(drops).values({
      ownerId: sellerId,
      name: `Drop ${i} ${suffix}`,
      type: "pre-made",
      createdAt: new Date(t0 + i * 60_000),
    }).returning({ id: drops.id });
    dropIds.push(drop.id);
  }

  const [{ default: buyerRouter }, { default: ordersRouter }, { default: dropsRouter }] = await Promise.all([
    import("../buyer"), import("../orders"), import("../drops"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/buyer", buyerRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/drops", dropsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (orderIds.length) await db.delete(orders).where(inArray(orders.id, orderIds));
  if (dropIds.length) await db.delete(drops).where(inArray(drops.id, dropIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(path: string, user: string) {
  const response = await fetch(`${base}${path}`, { headers: { "x-test-user": user } });
  return { status: response.status, headers: response.headers, body: await response.json() as any };
}

const newestFirst = () => [...orderIds].reverse();

describe("GET /api/buyer/orders pagination", () => {
  it("without params returns the same bare array (all orders, newest first) plus default-cap headers", async () => {
    const res = await get("/api/buyer/orders", buyerId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((o: any) => o.id)).toEqual(newestFirst());
    expect(res.body[0]).toEqual(expect.objectContaining({ id: orderIds[2], orderNumber: `LP-${suffix}-2`, delivery: expect.anything() }));
    expect(res.headers.get("x-pagination-limit")).toBe("500");
    expect(res.headers.get("x-pagination-offset")).toBe("0");
    expect(res.headers.get("x-pagination-returned")).toBe(String(ORDER_COUNT));
    expect(res.headers.get("x-pagination-has-more")).toBe("false");
  });

  it("pages with explicit limit/offset", async () => {
    const first = await get("/api/buyer/orders?limit=2", buyerId);
    expect(first.body.map((o: any) => o.id)).toEqual(newestFirst().slice(0, 2));
    expect(first.headers.get("x-pagination-limit")).toBe("2");
    expect(first.headers.get("x-pagination-returned")).toBe("2");
    expect(first.headers.get("x-pagination-has-more")).toBe("true");

    const second = await get("/api/buyer/orders?limit=2&offset=2", buyerId);
    expect(second.body.map((o: any) => o.id)).toEqual(newestFirst().slice(2));
    expect(second.headers.get("x-pagination-offset")).toBe("2");
    expect(second.headers.get("x-pagination-has-more")).toBe("false");
  });

  it("never 400s on bad params: garbage falls back to the default, oversized limits are clamped", async () => {
    const garbage = await get("/api/buyer/orders?limit=abc&offset=-3", buyerId);
    expect(garbage.status).toBe(200);
    expect(garbage.body).toHaveLength(ORDER_COUNT);
    expect(garbage.headers.get("x-pagination-limit")).toBe("500");
    expect(garbage.headers.get("x-pagination-offset")).toBe("0");

    const huge = await get("/api/buyer/orders?limit=100000", buyerId);
    expect(huge.status).toBe(200);
    expect(huge.headers.get("x-pagination-limit")).toBe("500");
  });
});

describe("GET /api/orders (seller) pagination", () => {
  it("keeps the array shape and per-order itemCount without params", async () => {
    const res = await get("/api/orders", sellerId);
    expect(res.status).toBe(200);
    expect(res.body.map((o: any) => o.id)).toEqual(newestFirst());
    expect(res.body.map((o: any) => o.itemCount)).toEqual([2, 1, 0]);
    expect(res.headers.get("x-pagination-limit")).toBe("2000");
    expect(res.headers.get("x-pagination-has-more")).toBe("false");
  });

  it("pages with explicit limit and still honors the buyerId filter", async () => {
    const page = await get(`/api/orders?limit=1&offset=1&buyerId=${encodeURIComponent(buyerId)}`, sellerId);
    expect(page.body.map((o: any) => o.id)).toEqual([orderIds[1]]);
    expect(page.body[0].itemCount).toBe(1);
    expect(page.headers.get("x-pagination-has-more")).toBe("true");

    const otherSeller = await get("/api/orders", `someone-else-${suffix}`);
    expect(otherSeller.body).toEqual([]);
  });
});

describe("GET /api/drops pagination", () => {
  it("returns the bare array without params and pages with limit", async () => {
    const all = await get("/api/drops", sellerId);
    expect(all.status).toBe(200);
    expect(all.body.map((d: any) => d.id)).toEqual([...dropIds].reverse());
    expect(all.headers.get("x-pagination-limit")).toBe("500");

    const page = await get("/api/drops?limit=1", sellerId);
    expect(page.body.map((d: any) => d.id)).toEqual([dropIds[2]]);
    expect(page.headers.get("x-pagination-has-more")).toBe("true");
  });
});
