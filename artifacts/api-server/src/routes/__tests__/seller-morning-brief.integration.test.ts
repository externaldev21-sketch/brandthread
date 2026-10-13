/**
 * GET /api/seller/morning-brief: yesterday's sales in the seller's own
 * calendar day, orders to ship, and the one-suggestion priority order, all
 * against a real database. `computeMorningBrief` is driven with a fixed
 * `now` for the day-boundary cases; the HTTP route is checked for auth,
 * tz validation and seller isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, orderItems, orders, productVariants, products, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const sfx = crypto.randomBytes(5).toString("hex");
const A = `brief-a-${sfx}`;
const B = `brief-b-${sfx}`;

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
let computeMorningBrief: typeof import("../seller-morning-brief").computeMorningBrief;

const DAY = 86_400_000;
let n = 0;

async function order(owner: string, opts: {
  totalCents: number;
  createdAt: Date;
  paid?: boolean;
  status?: string;
  refundedCents?: number;
  items?: Array<{ variantId: string; quantity: number }>;
}) {
  n += 1;
  const [o] = await db.insert(orders).values({
    ownerId: owner,
    orderNumber: `MB-${sfx}-${n}`,
    status: opts.status ?? "fulfilled",
    totalCents: opts.totalCents,
    subtotalCents: opts.totalCents,
    refundedCents: opts.refundedCents ?? 0,
    paidAt: opts.paid === false ? null : opts.createdAt,
    createdAt: opts.createdAt,
  }).returning();
  for (const item of opts.items ?? []) {
    await db.insert(orderItems).values({ orderId: o.id, variantId: item.variantId, productName: "P", quantity: item.quantity, priceCents: 1000 });
  }
  return o;
}

async function product(owner: string, name: string, variants: Array<{ stock: number; lowStockThreshold?: number }>, status = "active") {
  const [p] = await db.insert(products).values({ ownerId: owner, name, status }).returning();
  const ids: string[] = [];
  for (const [i, v] of variants.entries()) {
    const [row] = await db.insert(productVariants).values({
      productId: p.id,
      sku: `MB-${sfx}-${p.id.slice(0, 8)}-${i}`,
      priceCents: 1000,
      stock: v.stock,
      lowStockThreshold: v.lowStockThreshold ?? 10,
    }).returning();
    ids.push(row.id);
  }
  return { id: p.id, variantIds: ids };
}

async function reset() {
  for (const owner of [A, B]) {
    await db.delete(orders).where(eq(orders.ownerId, owner));
    await db.delete(products).where(eq(products.ownerId, owner));
  }
}

beforeAll(async () => {
  await db.insert(users).values([A, B].map((id) => ({
    clerkId: id, email: `${id}@test.local`, name: id, role: "seller", accountType: "seller",
  })));
  const mod = await import("../seller-morning-brief");
  computeMorningBrief = mod.computeMorningBrief;
  const app = express();
  app.use(express.json());
  app.use("/api/seller/morning-brief", mod.default);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(reset);

afterAll(async () => {
  await reset();
  await db.delete(users).where(inArray(users.clerkId, [A, B]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const get = async (path: string, as: string | null = A) => {
  authState.clerkUserId = as;
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: (await r.json()) as any };
};

describe("yesterday, in the seller's own day", () => {
  // 09:00 in Los Angeles on Oct 13 (16:00 UTC). LA yesterday = Oct 12 07:00Z .. Oct 13 07:00Z.
  const now = new Date("2026-10-13T16:00:00Z");
  const LA = "America/Los_Angeles";

  it("counts only orders inside local yesterday", async () => {
    await order(A, { totalCents: 1000, createdAt: new Date("2026-10-12T07:00:00Z") }); // 00:00 LA Oct 12: in
    await order(A, { totalCents: 2000, createdAt: new Date("2026-10-13T06:59:00Z") }); // 23:59 LA Oct 12: in
    await order(A, { totalCents: 4000, createdAt: new Date("2026-10-12T06:59:00Z") }); // 23:59 LA Oct 11: out
    await order(A, { totalCents: 8000, createdAt: new Date("2026-10-13T07:00:00Z") }); // 00:00 LA Oct 13 (today): out

    const brief = await computeMorningBrief(A, LA, now);
    expect(brief.date).toBe("2026-10-13");
    expect(brief.yesterday).toEqual({ netCents: 3000, orderCount: 2 });

    // The same rows read as a UTC seller: yesterday = all of Oct 12 UTC.
    const utc = await computeMorningBrief(A, "UTC", now);
    expect(utc.yesterday).toEqual({ netCents: 1000 + 4000, orderCount: 2 });
  });

  it("nets refunds and leaves out cancelled and unpaid orders", async () => {
    const at = new Date("2026-10-12T20:00:00Z");
    await order(A, { totalCents: 5000, refundedCents: 1500, createdAt: at });
    await order(A, { totalCents: 9000, status: "cancelled", createdAt: at });
    await order(A, { totalCents: 7000, paid: false, status: "pending", createdAt: at });

    const brief = await computeMorningBrief(A, LA, now);
    expect(brief.yesterday).toEqual({ netCents: 3500, orderCount: 1 });
  });

  it("returns the seller-local date even when UTC is a day ahead", async () => {
    const lateEvening = new Date("2026-10-14T05:30:00Z"); // 22:30 Oct 13 in LA
    expect((await computeMorningBrief(A, LA, lateEvening)).date).toBe("2026-10-13");
    expect((await computeMorningBrief(A, "UTC", lateEvening)).date).toBe("2026-10-14");
  });
});

describe("orders to ship", () => {
  it("counts paid pending/processing orders only", async () => {
    const at = new Date(Date.now() - 3600_000);
    await order(A, { totalCents: 100, status: "pending", createdAt: at });
    await order(A, { totalCents: 100, status: "processing", createdAt: at });
    await order(A, { totalCents: 100, status: "pending", paid: false, createdAt: at });
    await order(A, { totalCents: 100, status: "shipped", createdAt: at });
    await order(A, { totalCents: 100, status: "fulfilled", createdAt: at });
    await order(A, { totalCents: 100, status: "cancelled", createdAt: at });

    const brief = await computeMorningBrief(A, "UTC");
    expect(brief.toShip).toBe(2);
    expect(brief.hasPaidOrder).toBe(true);
  });
});

describe("the one suggestion", () => {
  const recent = () => new Date(Date.now() - 5 * DAY);

  it("restock: a sold-out active product that sold in the last 30 days", async () => {
    const coat = await product(A, "Wool Overcoat", [{ stock: 0 }, { stock: 0 }]);
    await order(A, { totalCents: 100, createdAt: recent(), items: [{ variantId: coat.variantIds[0], quantity: 2 }, { variantId: coat.variantIds[1], quantity: 1 }] });
    // An older late order would otherwise win rule 2.
    await order(A, { totalCents: 100, status: "pending", createdAt: new Date(Date.now() - 4 * DAY) });

    const brief = await computeMorningBrief(A, "UTC");
    expect(brief.suggestion).toEqual({
      kind: "restock",
      title: "Restock Wool Overcoat",
      detail: "Sold out. It sold 3 in the last 30 days.",
      target: { type: "product", id: coat.id },
    });
  });

  it("restock ignores drafts, deleted products, partial stock and sales older than 30 days", async () => {
    const draft = await product(A, "Draft", [{ stock: 0 }], "draft");
    const partial = await product(A, "Partial", [{ stock: 0 }, { stock: 4 }]);
    const stale = await product(A, "Stale", [{ stock: 0 }]);
    const deleted = await product(A, "Deleted", [{ stock: 0 }]);
    await db.update(products).set({ deletedAt: new Date() }).where(eq(products.id, deleted.id));
    await order(A, { totalCents: 100, createdAt: recent(), items: [
      { variantId: draft.variantIds[0], quantity: 1 },
      { variantId: partial.variantIds[0], quantity: 1 },
      { variantId: deleted.variantIds[0], quantity: 1 },
    ] });
    await order(A, { totalCents: 100, createdAt: new Date(Date.now() - 40 * DAY), items: [{ variantId: stale.variantIds[0], quantity: 5 }] });

    const brief = await computeMorningBrief(A, "UTC");
    expect(brief.suggestion?.kind).not.toBe("restock");
  });

  it("restock counts only paid, non-cancelled sales", async () => {
    const coat = await product(A, "Coat", [{ stock: 0 }]);
    await order(A, { totalCents: 100, status: "cancelled", createdAt: recent(), items: [{ variantId: coat.variantIds[0], quantity: 1 }] });
    await order(A, { totalCents: 100, paid: false, status: "pending", createdAt: recent(), items: [{ variantId: coat.variantIds[0], quantity: 1 }] });
    expect((await computeMorningBrief(A, "UTC")).suggestion).toBeNull();
  });

  it("ship: the oldest paid order waiting more than two days", async () => {
    await order(A, { totalCents: 100, status: "pending", createdAt: new Date(Date.now() - 1 * DAY) });
    const old = await order(A, { totalCents: 100, status: "processing", createdAt: new Date(Date.now() - 3.5 * DAY) });
    await order(A, { totalCents: 100, status: "shipped", createdAt: new Date(Date.now() - 9 * DAY) });

    const brief = await computeMorningBrief(A, "UTC");
    expect(brief.suggestion).toEqual({
      kind: "ship",
      title: `Ship ${old.orderNumber}`,
      detail: "3 days waiting.",
      target: { type: "order", id: old.id },
    });
  });

  it("low stock: a best seller at or below its threshold", async () => {
    const denim = await product(A, "Relaxed Denim", [{ stock: 2, lowStockThreshold: 0 }, { stock: 0, lowStockThreshold: 0 }]);
    const tee = await product(A, "Tee", [{ stock: 50 }]);
    await order(A, { totalCents: 100, createdAt: recent(), items: [{ variantId: denim.variantIds[0], quantity: 4 }, { variantId: tee.variantIds[0], quantity: 9 }] });

    const brief = await computeMorningBrief(A, "UTC");
    expect(brief.suggestion).toEqual({
      kind: "low_stock",
      title: "Relaxed Denim has 2 left",
      detail: "It sold 4 in the last 30 days.",
      target: { type: "product", id: denim.id },
    });
  });

  it("none when nothing qualifies", async () => {
    const tee = await product(A, "Tee", [{ stock: 50 }]);
    await order(A, { totalCents: 100, createdAt: recent(), items: [{ variantId: tee.variantIds[0], quantity: 1 }] });
    expect((await computeMorningBrief(A, "UTC")).suggestion).toBeNull();
  });
});

describe("GET /api/seller/morning-brief", () => {
  it("requires auth", async () => {
    expect((await get("/api/seller/morning-brief", null)).status).toBe(401);
  });

  it("falls back to UTC for an invalid tz", async () => {
    const { status, body } = await get("/api/seller/morning-brief?tz=Mars/Olympus");
    expect(status).toBe(200);
    expect(body.timeZone).toBe("UTC");
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is honest for a seller with no orders", async () => {
    const { body } = await get("/api/seller/morning-brief?tz=America/New_York");
    expect(body).toMatchObject({
      timeZone: "America/New_York",
      hasPaidOrder: false,
      yesterday: { netCents: 0, orderCount: 0 },
      toShip: 0,
      suggestion: null,
    });
  });

  it("never shows another seller's orders or products", async () => {
    const coat = await product(B, "B Coat", [{ stock: 0 }]);
    await order(B, { totalCents: 5000, status: "pending", createdAt: new Date(Date.now() - 4 * DAY), items: [{ variantId: coat.variantIds[0], quantity: 3 }] });
    await order(B, { totalCents: 5000, createdAt: new Date(Date.now() - DAY) });

    const a = await get("/api/seller/morning-brief?tz=UTC", A);
    expect(a.body).toMatchObject({ hasPaidOrder: false, yesterday: { netCents: 0, orderCount: 0 }, toShip: 0, suggestion: null });

    const b = await get("/api/seller/morning-brief?tz=UTC", B);
    expect(b.body.hasPaidOrder).toBe(true);
    expect(b.body.toShip).toBe(1);
    expect(b.body.suggestion.kind).toBe("restock");
  });
});
