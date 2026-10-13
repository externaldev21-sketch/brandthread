/**
 * Seller milestones (migration 291) against a real database: every
 * threshold, refunds netted and cancelled orders excluded, a backfill that
 * surfaces only the highest, seen persistence, seller isolation and a
 * concurrency-safe insert.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orderItems, orders, productVariants, products, sellerMilestones, users } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

const sfx = crypto.randomBytes(5).toString("hex");
const A = `ms-a-${sfx}`;
const B = `ms-b-${sfx}`;

const authState = vi.hoisted(() => ({ clerkUserId: null as string | null }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!authState.clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = authState.clerkUserId;
    next();
  },
  requirePlan: () => (_q: unknown, _r: unknown, next: () => void) => next(),
}));

let server: Server;
let base = "";
let n = 0;

async function seedOrders(owner: string, count: number, opts: {
  totalCents: number;
  refundedCents?: number;
  status?: string;
  paid?: boolean;
  variantId?: string;
  quantity?: number;
  paidAt?: Date;
}) {
  if (count <= 0) return [];
  const values = Array.from({ length: count }, () => {
    n += 1;
    const at = opts.paidAt ?? new Date(Date.now() - 3600_000);
    return {
      ownerId: owner,
      orderNumber: `MS-${sfx}-${n}`,
      status: opts.status ?? "fulfilled",
      totalCents: opts.totalCents,
      subtotalCents: opts.totalCents,
      refundedCents: opts.refundedCents ?? 0,
      paidAt: opts.paid === false ? null : at,
      createdAt: at,
    };
  });
  const inserted = await db.insert(orders).values(values).returning({ id: orders.id });
  if (opts.variantId) {
    await db.insert(orderItems).values(inserted.map((o) => ({
      orderId: o.id, variantId: opts.variantId!, productName: "P", quantity: opts.quantity ?? 1, priceCents: opts.totalCents,
    })));
  }
  return inserted;
}

async function product(owner: string, name: string, images: string[]) {
  const [p] = await db.insert(products).values({ ownerId: owner, name, status: "active", images }).returning();
  const [v] = await db.insert(productVariants).values({ productId: p.id, sku: `MS-${sfx}-${p.id.slice(0, 8)}`, priceCents: 1000, stock: 5 }).returning();
  return { id: p.id, variantId: v.id };
}

async function reset() {
  for (const owner of [A, B]) {
    await db.delete(sellerMilestones).where(eq(sellerMilestones.ownerId, owner));
    await db.delete(orders).where(eq(orders.ownerId, owner));
    await db.delete(products).where(eq(products.ownerId, owner));
  }
}

const call = async (method: "GET" | "POST", path: string, as: string | null = A) => {
  authState.clerkUserId = as;
  const r = await fetch(`${base}${path}`, { method });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : undefined };
};
const next = (as: string | null = A) => call("GET", "/api/seller/milestones/next", as);
const seen = (key: string, as: string | null = A) => call("POST", `/api/seller/milestones/${key}/seen`, as);
const keysOf = async (owner: string) =>
  (await db.select().from(sellerMilestones).where(eq(sellerMilestones.ownerId, owner)))
    .sort((a, b) => a.key.localeCompare(b.key));

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: A, email: `${A}@test.local`, name: A, role: "seller", accountType: "seller", brandName: "Northline", username: `northline_${sfx}` },
    { clerkId: B, email: `${B}@test.local`, name: B, role: "seller", accountType: "seller", brandName: "Other", username: `other_${sfx}` },
  ]);
  const { default: router } = await import("../seller-milestones");
  const app = express();
  app.use(express.json());
  app.use("/api/seller/milestones", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(reset);

afterAll(async () => {
  await reset();
  await db.delete(users).where(inArray(users.clerkId, [A, B]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("auth and empty state", () => {
  it("requires auth", async () => {
    expect((await next(null)).status).toBe(401);
  });

  it("returns null with no sales", async () => {
    const r = await next();
    expect(r.status).toBe(200);
    expect(r.body).toBeNull();
    expect(await keysOf(A)).toEqual([]);
  });

  it("404s an unknown key on seen", async () => {
    expect((await seen("orders_7")).status).toBe(404);
  });
});

describe("every threshold", () => {
  it.each([
    ["first_sale", "First sale", 1, 500],
    ["sales_1k", "$1,000 in sales", 2, 50_000],
    ["orders_100", "100 orders", 100, 100],
    ["sales_10k", "$10,000 in sales", 100, 10_000],
    ["orders_1000", "1,000 orders", 1_000, 100],
    ["sales_100k", "$100,000 in sales", 1_000, 10_000],
  ])("%s", async (key, label, count, totalCents) => {
    await seedOrders(A, count, { totalCents });
    const r = await next();
    expect(r.body).toMatchObject({ key, label, storeName: "Northline", handle: `northline_${sfx}` });
    expect(Date.parse(r.body.reachedAt)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("one cent short of $1,000 is not $1,000", async () => {
    await seedOrders(A, 1, { totalCents: 99_999 });
    expect((await next()).body.key).toBe("first_sale");
  });
});

describe("what counts", () => {
  it("nets refunds (floored at 0 per order) and excludes cancelled and unpaid orders", async () => {
    await seedOrders(A, 1, { totalCents: 120_000, refundedCents: 30_000 }); // 900.00 net
    await seedOrders(A, 1, { totalCents: 5_000, refundedCents: 9_000 }); // over-refund counts 0, not -40
    await seedOrders(A, 1, { totalCents: 500_000, status: "cancelled" });
    await seedOrders(A, 1, { totalCents: 500_000, paid: false, status: "pending" });
    const r = await next();
    expect(r.body.key).toBe("first_sale");
    expect((await keysOf(A)).map((k) => k.key)).toEqual(["first_sale"]);

    await seedOrders(A, 1, { totalCents: 10_000 }); // 900 + 100 = 1,000.00
    expect((await next()).body.key).toBe("sales_1k");
  });

  it("cancelled-only history reaches nothing", async () => {
    await seedOrders(A, 3, { totalCents: 50_000, status: "cancelled" });
    expect((await next()).body).toBeNull();
  });
});

describe("backfill and seen", () => {
  it("records every reached milestone but surfaces only the highest", async () => {
    await seedOrders(A, 120, { totalCents: 40_000 }); // 120 orders, $48,000
    const r = await next();
    expect(r.body.key).toBe("sales_10k");

    const rows = await keysOf(A);
    expect(rows.map((k) => k.key)).toEqual(["first_sale", "orders_100", "sales_10k", "sales_1k"]);
    for (const row of rows) {
      if (row.key === "sales_10k") expect(row.seenAt).toBeNull();
      else expect(row.seenAt).not.toBeNull();
    }
  });

  it("seen persists: the card never comes back, and the next milestone does", async () => {
    await seedOrders(A, 1, { totalCents: 2_000 });
    expect((await next()).body.key).toBe("first_sale");
    expect((await seen("first_sale")).status).toBe(204);
    expect((await next()).body).toBeNull();
    expect((await next()).body).toBeNull();

    await seedOrders(A, 1, { totalCents: 98_000 });
    expect((await next()).body.key).toBe("sales_1k");
  });

  it("a newer milestone supersedes an older one that was never seen", async () => {
    await seedOrders(A, 1, { totalCents: 2_000 });
    expect((await next()).body.key).toBe("first_sale"); // recorded, not yet seen
    await seedOrders(A, 1, { totalCents: 99_000 });
    expect((await next()).body.key).toBe("sales_1k");
    await seen("sales_1k");
    expect((await next()).body).toBeNull(); // "First sale" never shows after "$1,000"
  });
});

describe("product image", () => {
  it("first sale shows the product from the first order", async () => {
    const first = await product(A, "First Tee", ["https://img.test/first.jpg", "https://img.test/2.jpg"]);
    const later = await product(A, "Later Hoodie", ["https://img.test/later.jpg"]);
    await seedOrders(A, 1, { totalCents: 100, variantId: first.variantId, paidAt: new Date(Date.now() - 5 * 86_400_000) });
    await seedOrders(A, 1, { totalCents: 100, variantId: later.variantId, quantity: 9 });
    const r = await next();
    expect(r.body).toMatchObject({ key: "first_sale", productImageUrl: "https://img.test/first.jpg" });
    expect((await keysOf(A))[0].productId).toBe(first.id);
  });

  it("other milestones show the best seller; no image means null", async () => {
    const slow = await product(A, "Slow", ["https://img.test/slow.jpg"]);
    const best = await product(A, "Best", ["https://img.test/best.jpg"]);
    await seedOrders(A, 1, { totalCents: 60_000, variantId: slow.variantId, quantity: 1 });
    await seedOrders(A, 1, { totalCents: 60_000, variantId: best.variantId, quantity: 5 });
    expect((await next()).body).toMatchObject({ key: "sales_1k", productImageUrl: "https://img.test/best.jpg" });

    await reset();
    const bare = await product(A, "Bare", []);
    await seedOrders(A, 1, { totalCents: 100, variantId: bare.variantId });
    expect((await next()).body).toMatchObject({ key: "first_sale", productImageUrl: null });
  });
});

describe("isolation and concurrency", () => {
  it("never counts or shows another seller's orders", async () => {
    await seedOrders(B, 100, { totalCents: 10_000 }); // 100 orders, $10,000
    expect((await next(A)).body).toBeNull();
    expect((await next(B)).body.key).toBe("sales_10k");
    expect(await keysOf(A)).toEqual([]);

    // A marking B's key seen touches only A's (absent) row.
    await seen("sales_10k", A);
    const b = await db.select().from(sellerMilestones).where(and(eq(sellerMilestones.ownerId, B), eq(sellerMilestones.key, "sales_10k")));
    expect(b[0].seenAt).toBeNull();
  });

  it("parallel first loads record each milestone once and agree", async () => {
    await seedOrders(A, 100, { totalCents: 1_500 }); // 100 orders, $1,500
    const results = await Promise.all(Array.from({ length: 6 }, () => next()));
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.body.key).toBe("orders_100");
    }
    const rows = await keysOf(A);
    expect(rows.map((k) => k.key)).toEqual(["first_sale", "orders_100", "sales_1k"]);
  });
});
