import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, products, productVariants } from "@workspace/db";

const notify = vi.hoisted(() => ({ backInStock: vi.fn(async () => undefined) }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = req.headers["x-test-user"]; next(); },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/stockNotifications", () => ({
  notifyBackInStock: notify.backInStock,
  notifyStockLevelChanged: vi.fn(async () => undefined),
}));
vi.mock("../../lib/stockRules", () => ({ afterStockChange: vi.fn(async () => undefined) }));
vi.mock("../../lib/activityLog", () => ({
  logActivity: vi.fn(async () => undefined),
  reqActor: () => ({ ownerClerkId: "x", actorClerkId: "x", actorRole: "owner" }),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `w1s06inv-${suffix}`;
const productIds: string[] = [];
let liveVariant = "";
let deletedVariant = "";
let server: Server;
let base = "";

async function adjust(variantId: string, body?: unknown) {
  const r = await fetch(`${base}/api/inventory/${variantId}/adjust`, {
    method: "PATCH",
    headers: { "x-test-user": sellerId, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}

beforeAll(async () => {
  const [live, gone] = await db.insert(products).values([
    { ownerId: sellerId, name: `Live ${suffix}`, status: "active" },
    { ownerId: sellerId, name: `Gone ${suffix}`, status: "active", deletedAt: new Date() },
  ]).returning({ id: products.id });
  productIds.push(live.id, gone.id);
  const [v1, v2] = await db.insert(productVariants).values([
    { productId: live.id, sku: `W1S06-L-${suffix}`, priceCents: 1000, stock: 5 },
    { productId: gone.id, sku: `W1S06-G-${suffix}`, priceCents: 1000, stock: 0 },
  ]).returning({ id: productVariants.id });
  liveVariant = v1.id;
  deletedVariant = v2.id;
  const { default: router } = await import("../inventory");
  const app = express();
  app.use(express.json());
  app.use("/api/inventory", router);
  app.use((_err: unknown, _req: any, res: any, _next: any) => res.status(500).json({ error: "boom" }));
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(productVariants).where(inArray(productVariants.productId, productIds));
  await db.delete(products).where(inArray(products.id, productIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("PATCH /api/inventory/:variantId/adjust input hardening", () => {
  it("404s a non-uuid variant id", async () => {
    expect((await adjust("not-a-uuid", { delta: 1 })).status).toBe(404);
  });

  it("400s (not 500) when no body is sent", async () => {
    expect((await adjust(liveVariant)).status).toBe(400);
  });

  it("rejects stock values beyond the int4 column", async () => {
    expect((await adjust(liveVariant, { newStock: 3_000_000_000 })).status).toBe(400);
    expect((await adjust(liveVariant, { delta: 2_147_483_647 })).status).toBe(400);
    const [row] = await db.select({ stock: productVariants.stock }).from(productVariants).where(eq(productVariants.id, liveVariant));
    expect(row.stock).toBe(5);
  });

  it("still adjusts a live variant", async () => {
    const res = await adjust(liveVariant, { delta: 2 });
    expect(res.status).toBe(200);
    expect(res.body.stock).toBe(7);
  });

  it("does not adjust (or fire back-in-stock alerts for) a deleted product's variant", async () => {
    notify.backInStock.mockClear();
    const res = await adjust(deletedVariant, { newStock: 10 });
    expect(res.status).toBe(404);
    expect(notify.backInStock).not.toHaveBeenCalled();
  });
});
