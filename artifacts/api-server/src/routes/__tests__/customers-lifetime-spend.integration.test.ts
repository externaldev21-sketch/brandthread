import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray, like, sql } from "drizzle-orm";
import { customers, db, orders, users } from "@workspace/db";
import { buyerKey, guestKey } from "../../lib/sellerCustomers";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    req.log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  },
}));

const sfx = crypto.randomBytes(5).toString("hex");
const id = (name: string) => `cus-${sfx}-${name}`;
const SELLER = id("seller");
const OTHER = id("other");
const BUYER = id("buyer");
const BIG = id("big");
const userIds = [SELLER, OTHER, BUYER, BIG];

let server: Server;
let base = "";
let n = 0;
const order = (v: Partial<typeof orders.$inferInsert>) => ({
  ownerId: SELLER, orderNumber: `${id("o")}-${++n}`, status: "processing", totalCents: 1000, subtotalCents: 1000, ...v,
});

async function get(path: string, as = SELLER) {
  const r = await fetch(`${base}/api/customers${path}`, { headers: { "x-test-user-id": as } });
  return { status: r.status, body: await r.json() as any };
}

let manualId = "";
let phoneRowId = "";

beforeAll(async () => {
  await db.insert(users).values(userIds.map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId,
    displayName: clerkId === BUYER ? "Sam Buyer" : clerkId === BIG ? "Big Spender" : clerkId,
    username: clerkId.replace(/[^a-z0-9]/gi, "").slice(0, 28), role: "buyer", accountType: "buyer",
  })));
  // The startup ALTER in routes/customers.ts and migration 271 both add tags/notes.
  await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'`);
  await db.execute(sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT`);
  const [m] = await db.insert(customers).values({ ownerId: SELLER, email: "vip@guest.test", name: "Vip Guest" }).returning({ id: customers.id });
  manualId = m!.id;
  await db.execute(sql`UPDATE customers SET tags = '["VIP"]'::jsonb, notes = 'Ships to studio' WHERE id = ${manualId}`);
  const [p] = await db.insert(customers).values({ ownerId: SELLER, email: "phone@order.test", name: "Phone Order" }).returning({ id: customers.id });
  phoneRowId = p!.id;
  await db.insert(customers).values({ ownerId: OTHER, email: "vip@guest.test", name: "Other seller's row" });

  const day = (k: number) => new Date(Date.UTC(2026, 8, k));
  await db.insert(orders).values([
    // Signed-in buyer: two live orders, one partially refunded, one cancelled (excluded).
    order({ buyerId: BUYER, totalCents: 5000, createdAt: day(1) }),
    order({ buyerId: BUYER, totalCents: 3000, refundedCents: 1000, createdAt: day(3) }),
    order({ buyerId: BUYER, totalCents: 99_999, status: "cancelled", createdAt: day(4) }),
    // Same person checking out as a guest with their account email: folds into the account.
    order({ guestEmail: `${BUYER}@test.local`, totalCents: 500, createdAt: day(5) }),
    // Two different guests stay separate (not one "Guest" bucket); case-folded email.
    order({ guestEmail: "VIP@guest.test", totalCents: 2000, createdAt: day(2), shippingAddress: { name: "Vee", street: "1", city: "c", state: "s", zip: "z", country: "US" } }),
    order({ guestEmail: "vip@guest.test", totalCents: 1500, createdAt: day(6) }),
    order({ guestEmail: "other@guest.test", totalCents: 700, createdAt: day(7) }),
    // A fully refunded order counts as an order but adds nothing to spend.
    order({ guestEmail: "refunded@guest.test", totalCents: 4000, refundedCents: 4000, status: "refunded", createdAt: day(8) }),
    // Seller-created order linked to a manual row only.
    order({ customerId: phoneRowId, totalCents: 1200, status: "pending", createdAt: day(9) }),
    // Biggest spender.
    order({ buyerId: BIG, totalCents: 20_000, createdAt: day(10) }),
    // Another seller's sale to the same buyer must never leak in.
    order({ ownerId: OTHER, buyerId: BUYER, totalCents: 77_777, createdAt: day(11) }),
  ]);

  const { default: router } = await import("../customers");
  const app = express();
  app.use(express.json());
  app.use("/api/customers", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.delete(orders).where(like(orders.orderNumber, `cus-${sfx}-%`));
  await db.delete(customers).where(inArray(customers.ownerId, [SELLER, OTHER]));
  await db.delete(users).where(inArray(users.clerkId, userIds));
});

describe("GET /api/customers — derived from orders", () => {
  it("lists one row per real customer with net lifetime spend, order count and last order", async () => {
    const r = await get("");
    expect(r.status).toBe(200);
    const byId = Object.fromEntries((r.body as any[]).map((c) => [c.id, c]));
    expect(Object.keys(byId).sort()).toEqual([
      buyerKey(BUYER), buyerKey(BIG), guestKey("vip@guest.test"), guestKey("other@guest.test"),
      guestKey("refunded@guest.test"), phoneRowId,
    ].sort());

    expect(byId[buyerKey(BUYER)]).toMatchObject({
      name: "Sam Buyer", kind: "account", orderCount: 3, totalSpentCents: 5000 + 2000 + 500,
      lastOrderAt: new Date(Date.UTC(2026, 8, 5)).toISOString(),
    });
    expect(byId[guestKey("vip@guest.test")]).toMatchObject({
      name: "Vip Guest", email: "vip@guest.test", orderCount: 2, totalSpentCents: 3500,
      tags: ["VIP"], notes: "Ships to studio", customerRowId: manualId,
    });
    expect(byId[guestKey("refunded@guest.test")]).toMatchObject({ orderCount: 1, totalSpentCents: 0 });
    expect(byId[phoneRowId]).toMatchObject({ name: "Phone Order", orderCount: 1, totalSpentCents: 1200, kind: "manual" });

    // Newest order first; identity sets and account emails stay server-side.
    expect(r.body[0].id).toBe(buyerKey(BIG));
    expect(r.body[0].buyerIds).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain(`${BIG}@test.local`);
  });

  it("returns the top spenders with ?top=", async () => {
    const r = await get("?top=20");
    expect(r.body.map((c: any) => c.totalSpentCents)).toEqual([20_000, 7500, 3500, 1200, 700, 0]);
    expect((await get("?top=2")).body.map((c: any) => c.id)).toEqual([buyerKey(BIG), buyerKey(BUYER)]);
  });

  it("searches name, email and tags", async () => {
    expect((await get("?search=vip")).body.map((c: any) => c.id)).toEqual([guestKey("vip@guest.test")]);
    expect((await get("?search=sam")).body.map((c: any) => c.id)).toEqual([buyerKey(BUYER)]);
  });

  it("isolates sellers", async () => {
    const r = await get("", OTHER);
    expect(r.body).toHaveLength(2); // its own sale to BUYER + its own manual row
    expect(r.body.find((c: any) => c.id === buyerKey(BUYER)).totalSpentCents).toBe(77_777);
    expect((await get(`/${guestKey("other@guest.test")}`, OTHER)).status).toBe(404);
  });
});

describe("GET /api/customers/:id and /:id/orders", () => {
  it("resolves derived ids and returns every order for the person, cancelled included in history", async () => {
    const c = await get(`/${buyerKey(BUYER)}`);
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ name: "Sam Buyer", orderCount: 3, totalSpentCents: 7500 });
    const o = await get(`/${buyerKey(BUYER)}/orders`);
    expect(o.body.map((x: any) => x.totalCents)).toEqual([500, 99_999, 3000, 5000]);
    expect(o.body.every((x: any) => x.ownerId === SELLER)).toBe(true);
  });

  it("opens a guest by its manual row uuid too", async () => {
    const c = await get(`/${manualId}`);
    expect(c.body.id).toBe(guestKey("vip@guest.test"));
    expect((await get(`/${manualId}/orders`)).body).toHaveLength(2);
  });

  it("404s unknown ids instead of erroring on non-uuid input", async () => {
    expect((await get("/buyer_nobody")).status).toBe(404);
    expect((await get("/not-a-uuid/orders")).status).toBe(404);
  });
});
