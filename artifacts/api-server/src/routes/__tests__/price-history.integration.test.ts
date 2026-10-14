/**
 * Price history + "Tell me if the price drops", against the real database:
 * the migration-271 trigger records price changes, the public route returns
 * the 90-day chart, the saved-item switch round-trips, and notifyPriceDrop
 * pushes only to buyers who turned the switch on (once per new low).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, productVariants, products, savedItems, users } from "@workspace/db";

const spies = vi.hoisted(() => ({ publish: vi.fn(async () => undefined) }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.header("x-test-user");
    next();
  },
}));
vi.mock("../notifications-feed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notifications-feed")>()),
  publishNotification: spies.publish,
}));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `ph-seller-${suffix}`;
const alertBuyer = `ph-alert-${suffix}`;
const quietBuyer = `ph-quiet-${suffix}`;
const strangerId = `ph-stranger-${suffix}`;
let productId = "";
let server: Server;
let base = "";

async function call(path: string, user?: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: { ...(user ? { "x-test-user": user } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: sellerId, email: `${sellerId}@test.local`, name: "Seller", brandName: "North Loom", accountType: "seller", role: "owner" },
    { clerkId: alertBuyer, email: `${alertBuyer}@test.local`, name: "Alert Buyer", accountType: "buyer", role: "buyer" },
    { clerkId: quietBuyer, email: `${quietBuyer}@test.local`, name: "Quiet Buyer", accountType: "buyer", role: "buyer" },
    { clerkId: strangerId, email: `${strangerId}@test.local`, name: "Stranger", accountType: "buyer", role: "buyer" },
  ]);
  const [product] = await db.insert(products).values({
    ownerId: sellerId, name: "Field Shell Jacket", status: "active",
    createdAt: new Date(Date.now() - 60 * 86_400_000),
  }).returning({ id: products.id });
  productId = product.id;
  await db.insert(productVariants).values([
    { productId, sku: `PH-S-${suffix}`, size: "S", priceCents: 22000, stock: 5 },
    { productId, sku: `PH-M-${suffix}`, size: "M", priceCents: 22000, stock: 5 },
  ]);
  await db.insert(savedItems).values([
    { userId: alertBuyer, itemType: "product", targetId: productId, title: "Field Shell Jacket", savedPriceCents: 22000, lastNotifiedPriceCents: 22000 },
    { userId: quietBuyer, itemType: "product", targetId: productId, title: "Field Shell Jacket", savedPriceCents: 22000, lastNotifiedPriceCents: 22000 },
  ]);

  const { default: publicRouter } = await import("../public");
  const { default: savedRouter } = await import("../saved");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api/public", publicRouter);
  app.use("/api/buyer/saved", savedRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => spies.publish.mockClear());

afterAll(async () => {
  await db.delete(savedItems).where(eq(savedItems.targetId, productId));
  await db.delete(products).where(eq(products.id, productId));
  await db.delete(users).where(inArray(users.clerkId, [sellerId, alertBuyer, quietBuyer, strangerId]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("price history", () => {
  it("shows nothing before the price has changed", async () => {
    const { status, body } = await call(`/api/public/products/${productId}/price-history`);
    expect(status).toBe(200);
    expect(body).toEqual({ changed: false, points: [] });
  });

  it("records a bulk drop of every variant as one change", async () => {
    await db.update(productVariants).set({ priceCents: 19000 }).where(eq(productVariants.productId, productId));
    const { body } = await call(`/api/public/products/${productId}/price-history`);
    expect(body.changed).toBe(true);
    expect(body.points.map((p: any) => p.priceCents)).toEqual([22000, 19000]);
  });

  it("404s for an unknown product", async () => {
    const { status } = await call(`/api/public/products/${crypto.randomUUID()}/price-history`);
    expect(status).toBe(404);
  });
});

describe("Tell me if the price drops", () => {
  it("is off until the buyer turns it on", async () => {
    expect((await call(`/api/buyer/saved/${productId}/price-alert`, alertBuyer)).body).toEqual({ saved: true, enabled: false });
    const put = await call(`/api/buyer/saved/${productId}/price-alert`, alertBuyer, { method: "PUT", body: { enabled: true } });
    expect(put).toEqual({ status: 200, body: { saved: true, enabled: true } });
    expect((await call(`/api/buyer/saved/${productId}/price-alert`, alertBuyer)).body.enabled).toBe(true);
  });

  it("can't be turned on for an item you didn't save", async () => {
    expect((await call(`/api/buyer/saved/${productId}/price-alert`, strangerId)).body).toEqual({ saved: false, enabled: false });
    const put = await call(`/api/buyer/saved/${productId}/price-alert`, strangerId, { method: "PUT", body: { enabled: true } });
    expect(put.status).toBe(404);
  });

  it("rejects a non-boolean", async () => {
    const put = await call(`/api/buyer/saved/${productId}/price-alert`, alertBuyer, { method: "PUT", body: { enabled: "yes" } });
    expect(put.status).toBe(400);
  });

  it("pushes only to the opted-in buyer, once per new low", async () => {
    const { notifyPriceDrop } = await import("../../lib/stockNotifications");
    const { drainSavedProductAlerts } = await import("../../lib/savedProductAlerts");
    const drop = { productId, ownerId: sellerId, productName: "Field Shell Jacket", previousPriceCents: 22000, newPriceCents: 19000 };
    await db.update(productVariants).set({ priceCents: drop.newPriceCents }).where(eq(productVariants.productId, productId));
    await notifyPriceDrop(drop);
    await drainSavedProductAlerts();
    const calls = spies.publish.mock.calls.map(([n]: any[]) => ({ userId: n.userId, channel: n.pushChannelId, type: n.type }));
    expect(calls).toEqual(expect.arrayContaining([
      { userId: alertBuyer, channel: "stock", type: "price_drop" },
    ]));
    expect(calls).toHaveLength(1);
    expect(calls.some((call) => call.userId === quietBuyer)).toBe(false);

    spies.publish.mockClear();
    await notifyPriceDrop(drop);
    await drainSavedProductAlerts();
    expect(spies.publish).not.toHaveBeenCalled();

    await db.update(productVariants).set({ priceCents: 17500 }).where(eq(productVariants.productId, productId));
    await notifyPriceDrop({ ...drop, previousPriceCents: 19000, newPriceCents: 17500 });
    await drainSavedProductAlerts();
    expect(spies.publish).toHaveBeenCalledTimes(1);
  });
});
