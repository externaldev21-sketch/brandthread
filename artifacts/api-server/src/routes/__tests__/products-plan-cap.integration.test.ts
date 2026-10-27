/**
 * The active-product cap on the real routes (Dev's plan-tier spec): only
 * publishing is limited, drafts are always allowed, a product's variants
 * count once, hitting the cap returns the upgrade copy, and a seller already
 * over a lowered cap keeps every live listing but can't publish more.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, products, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.header("x-test-user");
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const suffix = crypto.randomBytes(5).toString("hex");
const starter = `cap-starter-${suffix}`;
const unpaid = `cap-unpaid-${suffix}`;
const overCap = `cap-over-${suffix}`;
let server: Server;
let base = "";

async function call(method: string, path: string, user: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

const product = (name: string, status: string, variants = 1) => ({
  name, status,
  variants: Array.from({ length: variants }, (_, i) => ({ sku: `${name}-${i}-${suffix}`, size: `S${i}`, priceCents: 2_000, stock: 1 })),
});

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: starter, email: `${starter}@cap.invalid`, name: "Starter", role: "seller", subscriptionStatus: "trialing", subscriptionPlanId: "starter" },
    { clerkId: unpaid, email: `${unpaid}@cap.invalid`, name: "Unpaid", role: "seller" },
    { clerkId: overCap, email: `${overCap}@cap.invalid`, name: "Over cap", role: "seller", subscriptionStatus: "active", subscriptionPlanId: "starter" },
  ]);
  const { default: productsRouter } = await import("../products");
  const { default: bulkRouter } = await import("../product-bulk");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }; next(); });
  app.use("/api/products/bulk", bulkRouter);
  app.use("/api/products", productsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(products).where(inArray(products.ownerId, [starter, unpaid, overCap]));
  await db.delete(users).where(inArray(users.clerkId, [starter, unpaid, overCap]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("active-product cap", () => {
  it("Starter publishes 5 (variants count once), then the 6th gets the upgrade copy; drafts still save", async () => {
    // One product with 3 sizes is still one product.
    expect((await call("POST", "/api/products", starter, product("Hoodie", "active", 3))).status).toBe(201);
    for (let i = 1; i < 5; i++) {
      expect((await call("POST", "/api/products", starter, product(`Tee${i}`, "active"))).status).toBe(201);
    }
    const blocked = await call("POST", "/api/products", starter, product("Tee6", "active"));
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({
      code: "PLAN_LIMIT_REACHED",
      currentPlan: "starter",
      requiredPlan: "growth",
      used: 5,
      limit: 5,
      nextLimit: 25,
      message: "You've reached your Starter limit of 5 products — upgrade to Growth to list more.",
    });

    const draft = await call("POST", "/api/products", starter, product("Draft", "draft"));
    expect(draft.status).toBe(201);
    // Publishing the draft hits the same cap; archiving one live product makes room.
    expect((await call("PUT", `/api/products/${draft.body.id}`, starter, { status: "active" })).status).toBe(403);
    const [oldest] = await db.select({ id: products.id }).from(products)
      .where(eq(products.ownerId, starter)).orderBy(products.createdAt).limit(1);
    expect((await call("PUT", `/api/products/${oldest.id}`, starter, { status: "archived" })).status).toBe(200);
    expect((await call("PUT", `/api/products/${draft.body.id}`, starter, { status: "active" })).status).toBe(200);
  });

  it("bulk publishing can't go past the cap either", async () => {
    const a = await call("POST", "/api/products", starter, product("BulkA", "draft"));
    const res = await call("POST", "/api/products/bulk/status", starter, { productIds: [a.body.id], status: "active" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PLAN_LIMIT_REACHED");
  });

  it("a Starter seller already over the cap (7 live) keeps all 7, can't publish an 8th, and can still save drafts", async () => {
    const existing = [];
    for (let i = 0; i < 7; i++) {
      const [row] = await db.insert(products).values({ ownerId: overCap, name: `Old${i}`, status: "active" }).returning({ id: products.id });
      existing.push(row.id);
    }
    const blocked = await call("POST", "/api/products", overCap, product("New", "active"));
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({
      code: "PLAN_LIMIT_REACHED",
      requiredPlan: "growth",
      limit: 5,
      message: "You've reached your Starter limit of 5 products — upgrade to Growth to list more.",
    });
    expect((await call("POST", "/api/products", overCap, product("Later", "draft"))).status).toBe(201);
    const rows = await db.select({ id: products.id, status: products.status, deletedAt: products.deletedAt })
      .from(products).where(inArray(products.id, existing));
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.status === "active" && r.deletedAt === null)).toBe(true);
  });

  it("a seller with no live trial or plan can save drafts but can't publish", async () => {
    expect((await call("POST", "/api/products", unpaid, product("Idea", "draft"))).status).toBe(201);
    const res = await call("POST", "/api/products", unpaid, product("Live", "active"));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ requiredPlan: "starter", message: "Pick a plan to start selling." });
  });
});
