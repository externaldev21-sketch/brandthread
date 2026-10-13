import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, products, sales, users } from "@workspace/db";
import { applySalesToVariants, clearSalesCache, effectiveUnitPrice } from "../../lib/pricing/salesRuntime";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
}));

const sfx = crypto.randomBytes(5).toString("hex");
const SELLER = `slx-${sfx}-seller`;
const OTHER = `slx-${sfx}-other`;
const HOUR = 3_600_000;

let server: Server;
let base = "";
let productId = "";

async function call(method: string, path: string, as: string, body?: unknown) {
  const r = await fetch(`${base}/api/sales${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user-id": as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() as any };
}

async function priceAt(now: Date) {
  clearSalesCache();
  return effectiveUnitPrice({ productId, sellerId: SELLER, priceCents: 10_000, now });
}

beforeAll(async () => {
  await db.insert(users).values([SELLER, OTHER].map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId, role: "buyer", accountType: "seller",
  })));
  const [p] = await db.insert(products).values({ ownerId: SELLER, name: "Sale tee", status: "active" }).returning({ id: products.id });
  productId = p!.id;
  const { default: router } = await import("../sales");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: () => {}, info: () => {}, warn: () => {} }; next(); });
  app.use("/api/sales", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.delete(sales).where(like(sales.sellerId, `slx-${sfx}-%`));
  await db.delete(products).where(eq(products.ownerId, SELLER));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, OTHER]));
  clearSalesCache();
});

describe("automatic sales: scheduled → live → ended by time", () => {
  it("stores minute-precise start/end instants plus the seller's time zone and reports scheduled", async () => {
    const startsAt = new Date(Math.ceil((Date.now() + HOUR) / 60_000) * 60_000);
    const endsAt = new Date(startsAt.getTime() + 90 * 60_000);
    const r = await call("POST", "/", SELLER, {
      name: "Lunch hour", discountType: "percent", value: 25, scope: "store",
      startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), scheduleTimeZone: "America/Los_Angeles",
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "scheduled", scheduleTimeZone: "America/Los_Angeles" });
    expect(new Date(r.body.startsAt).toISOString()).toBe(startsAt.toISOString());
    expect(new Date(r.body.endsAt).toISOString()).toBe(endsAt.toISOString());

    // Not on sale before the start minute…
    expect((await priceAt(new Date(startsAt.getTime() - 1))).saleId).toBeNull();
    // …on sale from the start instant…
    const live = await priceAt(startsAt);
    expect(live).toMatchObject({ saleId: r.body.id, priceCents: 7_500, compareAtPriceCents: 10_000 });
    const mid = await priceAt(new Date(startsAt.getTime() + 45 * 60_000));
    expect(mid.priceCents).toBe(7_500);
    // …and back to full price from the end instant.
    expect((await priceAt(new Date(endsAt.getTime() - 1))).priceCents).toBe(7_500);
    const ended = await priceAt(endsAt);
    expect(ended).toMatchObject({ saleId: null, priceCents: 10_000 });

    // Catalog path agrees with the checkout path.
    clearSalesCache();
    const [variant] = await applySalesToVariants(
      [{ id: productId, ownerId: SELLER, category: null, tags: [] }],
      [{ productId, priceCents: 10_000, compareAtPriceCents: null }],
      new Date(startsAt.getTime() + 60_000),
    );
    expect(variant).toMatchObject({ priceCents: 7_500, compareAtPriceCents: 10_000 });

    await call("DELETE", `/${r.body.id}`, SELLER);
  });

  it("shows live and ended statuses from the real clock", async () => {
    const live = await call("POST", "/", SELLER, {
      name: "Now", discountType: "fixed", value: 500, scope: "store",
      startsAt: new Date(Date.now() - HOUR).toISOString(), endsAt: new Date(Date.now() + HOUR).toISOString(),
    });
    expect(live.body.status).toBe("live");
    expect((await priceAt(new Date())).priceCents).toBe(9_500);
    await call("DELETE", `/${live.body.id}`, SELLER);

    const ended = await call("POST", "/", SELLER, {
      name: "Done", discountType: "percent", value: 10, scope: "store",
      startsAt: new Date(Date.now() - 2 * HOUR).toISOString(), endsAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(ended.body.status).toBe("ended");
    expect((await priceAt(new Date())).saleId).toBeNull();
    const list = await call("GET", "/", SELLER);
    expect(list.body.find((s: any) => s.id === ended.body.id)).toMatchObject({ status: "ended" });
    await call("DELETE", `/${ended.body.id}`, SELLER);
  });

  it("moving the start into the future takes a live sale off immediately", async () => {
    const r = await call("POST", "/", SELLER, { name: "Moved", discountType: "percent", value: 30, scope: "store" });
    expect(r.body.status).toBe("live");
    expect((await priceAt(new Date())).priceCents).toBe(7_000);
    const moved = await call("PATCH", `/${r.body.id}`, SELLER, { startsAt: new Date(Date.now() + HOUR).toISOString(), scheduleTimeZone: "Europe/Paris" });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ status: "scheduled", scheduleTimeZone: "Europe/Paris" });
    expect((await priceAt(new Date())).saleId).toBeNull();
    await call("DELETE", `/${r.body.id}`, SELLER);
  });

  it("rejects an end at or before the start, bad dates and a bad time zone", async () => {
    const at = new Date(Date.now() + HOUR).toISOString();
    const base = { name: "Bad", discountType: "percent", value: 10, scope: "store" };
    for (const extra of [
      { startsAt: at, endsAt: at },
      { startsAt: "tomorrow-ish" },
      { scheduleTimeZone: "Nowhere/Land" },
    ]) {
      const r = await call("POST", "/", SELLER, { ...base, ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(400);
    }
    const created = await call("POST", "/", SELLER, { ...base, startsAt: at });
    const shrink = await call("PATCH", `/${created.body.id}`, SELLER, { endsAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    expect(shrink.status).toBe(400);
    expect((await call("PATCH", `/${created.body.id}`, OTHER, { name: "Mine now" })).status).toBe(404);
    await call("DELETE", `/${created.body.id}`, SELLER);
  });
});
