/**
 * Wave-1 audit (slice s10) — bad input that used to reach Postgres (500) and
 * a deleted listing showing in recently viewed:
 *  - recently-viewed: non-uuid productId is a 404; deleted products are hidden;
 *  - push register/deregister: a non-string token is a 400;
 *  - reports PATCH /:id/status: a non-uuid id is a 404;
 *  - profile-music PUT /me with no JSON body is a 400.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, productVariants, recentlyViewedProducts, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: null }) }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const id = req.headers["x-test-user"];
    if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = id;
    next();
  },
  requireModerator: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const buyer = `w1s10-misc-${suffix}`;
const seller = `w1s10-miscs-${suffix}`;
const productIds: string[] = [];
let server: Server;
let base = "";

function call(path: string, method = "GET", body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "x-test-user": buyer, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: buyer, email: `${buyer}@test.local`, name: "Misc Buyer", accountType: "buyer" },
    { clerkId: seller, email: `${seller}@test.local`, name: "Misc Seller", accountType: "seller" },
  ]);
  for (const deleted of [false, true]) {
    const [p] = await db.insert(products).values({
      ownerId: seller, name: `Misc ${deleted ? "Gone" : "Live"} ${suffix}`, status: "active",
      ...(deleted ? { deletedAt: new Date() } : {}),
    }).returning();
    productIds.push(p.id);
    await db.insert(productVariants).values({ productId: p.id, sku: `W1S10M-${deleted}-${suffix}`, priceCents: 1_500, stock: 1 });
  }
  const [{ default: rv }, { default: push }, { default: reports }, { default: music }] = await Promise.all([
    import("../recently-viewed"), import("../push"), import("../reports"), import("../profile-music"),
  ]);
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: () => undefined, warn: () => undefined, info: () => undefined }; next(); });
  app.use(express.json());
  app.use("/rv", rv);
  app.use("/push", push);
  app.use("/reports", reports);
  app.use("/music", music);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(recentlyViewedProducts).where(eq(recentlyViewedProducts.userId, buyer));
  await db.delete(productVariants).where(inArray(productVariants.productId, productIds));
  await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(users).where(inArray(users.clerkId, [buyer, seller]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("recently viewed", () => {
  it("a non-uuid productId is a 404", async () => {
    const res = await call("/rv", "POST", { productId: "not-a-product" });
    expect(res.status).toBe(404);
  });

  it("a deleted listing drops out of the list", async () => {
    for (const id of productIds) expect((await call("/rv", "POST", { productId: id })).status).toBe(204);
    const list = (await (await call("/rv")).json()) as any[];
    expect(list.map((r) => r.productId)).toEqual([productIds[0]]);
  });
});

describe("push tokens", () => {
  it("register refuses a non-string token", async () => {
    const res = await call("/push/register", "POST", { token: { nested: true } });
    expect(res.status).toBe(400);
  });

  it("deregister refuses a non-string token", async () => {
    const res = await call("/push/deregister", "DELETE", { token: 12345 });
    expect(res.status).toBe(400);
  });
});

describe("reports", () => {
  it("PATCH /:id/status with a non-uuid id is a 404", async () => {
    const res = await call("/reports/not-a-report/status", "PATCH", { status: "dismissed" });
    expect(res.status).toBe(404);
  });
});

describe("profile music", () => {
  it("PUT /me without a JSON body is a 400", async () => {
    const res = await fetch(`${base}/music/me`, { method: "PUT", headers: { "x-test-user": buyer } });
    expect(res.status).toBe(400);
  });
});
