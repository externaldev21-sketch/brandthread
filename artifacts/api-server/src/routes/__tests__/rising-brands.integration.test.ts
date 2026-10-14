import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import { db, orders, users } from "@workspace/db";

// The seller setting route sits behind requireAuth; the public leaderboard
// is mounted with no auth at all.
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const id = req.header("x-test-user-id");
    if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = id;
    req.log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  },
}));

const sfx = crypto.randomBytes(5).toString("hex");
const id = (name: string) => `rb-${sfx}-${name}`;
type Seed = { key: string; cur: number; prev: number; optIn?: boolean; suspended?: boolean; brand?: string };
const SEEDS: Seed[] = [
  { key: "a", cur: 10, prev: 2, brand: "Atlas" },             // +400%
  { key: "b", cur: 6, prev: 0, brand: "Bloom" },              // +600%
  { key: "flat", cur: 5, prev: 5 },                           // no growth
  { key: "few", cur: 4, prev: 0 },                            // under 5 orders this week
  { key: "optout", cur: 20, prev: 1, optIn: false },          // didn't opt in
  { key: "susp", cur: 20, prev: 1, suspended: true },         // suspended
  { key: "tiebig", cur: 8, prev: 4, brand: "Tide" },          // +100%, bigger week
  { key: "tiesmall", cur: 6, prev: 3, brand: "Arc" },         // +100%
];
const SELLERS = SEEDS.map((s) => id(s.key));

let server: Server;
let base = "";
let n = 0;

beforeAll(async () => {
  await db.insert(users).values(SEEDS.map((s) => ({
    clerkId: id(s.key), email: `${id(s.key)}@test.local`, name: s.key,
    brandName: s.brand ?? s.key, username: id(s.key).replace(/[^a-z0-9]/gi, "").slice(0, 28),
    role: "seller", accountType: "seller",
    risingBrandsOptIn: s.optIn ?? true,
    suspendedAt: s.suspended ? new Date() : null,
    logoUrl: s.key === "a" ? "https://cdn.test/atlas.png" : "/objects/private/logo.png",
  })));
  const now = Date.now();
  const day = 86_400_000;
  const rows: (typeof orders.$inferInsert)[] = [];
  const add = (ownerId: string, paidAt: Date | null, status = "pending") => rows.push({
    ownerId, orderNumber: `${id("o")}-${++n}`, status, totalCents: 2500, subtotalCents: 2500, paidAt,
  });
  for (const s of SEEDS) {
    for (let i = 0; i < s.cur; i++) add(id(s.key), new Date(now - (1 + (i % 5)) * day));
    for (let i = 0; i < s.prev; i++) add(id(s.key), new Date(now - (8 + (i % 5)) * day));
  }
  // Never counted: cancelled, unpaid, and orders older than two weeks.
  for (let i = 0; i < 3; i++) add(id("few"), new Date(now - 2 * day), "cancelled");
  for (let i = 0; i < 3; i++) add(id("few"), null);
  for (let i = 0; i < 9; i++) add(id("tiesmall"), new Date(now - 20 * day));
  await db.insert(orders).values(rows);

  const { default: publicRouter } = await import("../public");
  const { default: sellerProfileRouter } = await import("../seller-profile");
  const app = express();
  app.use(express.json());
  app.use("/api/public", publicRouter);
  app.use("/api/seller", sellerProfileRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.delete(orders).where(like(orders.orderNumber, `rb-${sfx}-%`));
  await db.delete(users).where(inArray(users.clerkId, SELLERS));
});

async function rising() {
  const r = await fetch(`${base}/api/public/brands/rising`);
  return { status: r.status, cacheControl: r.headers.get("cache-control"), body: await r.json() as any };
}
const mine = (brands: any[]) => brands.filter((b) => SELLERS.includes(b.sellerId));

describe("GET /api/public/brands/rising", () => {
  it("is public (no auth) and ranks opted-in sellers by order growth", async () => {
    const r = await rising();
    expect(r.status).toBe(200);
    expect(r.cacheControl).toContain("max-age=600");
    expect(mine(r.body.brands).map((b: any) => [b.sellerId, b.growthPct])).toEqual([
      [id("b"), 600], [id("a"), 400], [id("tiebig"), 100], [id("tiesmall"), 100],
    ]);
    expect(r.body.brands.map((b: any) => b.rank)).toEqual(r.body.brands.map((_: any, i: number) => i + 1));
    expect(r.body.weekOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("excludes opted-out, suspended, flat and under-threshold sellers", async () => {
    const ids = mine((await rising()).body.brands).map((b: any) => b.sellerId);
    for (const k of ["optout", "susp", "flat", "few"]) expect(ids).not.toContain(id(k));
  });

  it("returns percent only: no order counts, no private image paths", async () => {
    const { body } = await rising();
    const atlas = body.brands.find((b: any) => b.sellerId === id("a"));
    expect(Object.keys(atlas).sort()).toEqual(["brandName", "growthPct", "logoUrl", "rank", "sellerId", "username"]);
    expect(atlas).toMatchObject({ brandName: "Atlas", logoUrl: "https://cdn.test/atlas.png" });
    expect(JSON.stringify(body)).not.toMatch(/"(cur|prev|orders|orderCount)"/);
    expect(JSON.stringify(body)).not.toContain("/objects/");
  });
});

describe("Show in Rising brands setting", () => {
  const put = (optIn: unknown, as: string | null = id("optout")) => fetch(`${base}/api/seller/profile/rising-brands`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(as ? { "x-test-user-id": as } : {}) },
    body: JSON.stringify({ optIn }),
  });

  it("defaults to off for new sellers", async () => {
    const fresh = id("fresh");
    await db.insert(users).values({ clerkId: fresh, email: `${fresh}@test.local`, name: "f", role: "seller", accountType: "seller" });
    SELLERS.push(fresh);
    const [row] = await db.select({ v: users.risingBrandsOptIn }).from(users).where(eq(users.clerkId, fresh));
    expect(row?.v).toBe(false);
  });

  it("validates, requires auth, and opting in puts the seller on the board", async () => {
    expect((await put("yes")).status).toBe(400);
    expect((await put(true, null)).status).toBe(401);
    const r = await put(true);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ risingBrandsOptIn: true });
    expect(mine((await rising()).body.brands)[0].sellerId).toBe(id("optout")); // +1900%
    expect((await (await put(false)).json())).toEqual({ risingBrandsOptIn: false });
    expect(mine((await rising()).body.brands).map((b: any) => b.sellerId)).not.toContain(id("optout"));
  });
});
