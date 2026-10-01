/**
 * Integration tests for /api/product-bulk — price, status and duplicate.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, productVariants, productVariantCompareAt, productSeo } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const state = vi.hoisted(() => ({
  limit: null as number | null,
  priceDrops: [] as any[],
  activity: [] as string[],
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/planAccess", async (orig) => ({
  ...(await orig<typeof import("../../lib/planAccess")>()),
  getVerifiedPlanAccess: async () => ({ planId: "starter", limits: { products: state.limit, teamSeats: 0 } }),
}));
vi.mock("../../lib/stockNotifications", () => ({
  notifyPriceDrop: async (input: unknown) => { state.priceDrops.push(input); },
}));
vi.mock("../../lib/activityEvents", () => ({ notifyNewProduct: async () => undefined }));
vi.mock("../../lib/activityLog", () => ({
  logActivity: async (_o: string, _a: string, _r: string, action: string) => { state.activity.push(action); },
  reqActor: (req: any) => ({ ownerClerkId: req.clerkUserId, actorClerkId: req.clerkUserId, actorRole: "owner" }),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `bulk-seller-${suffix}`;
const other = `bulk-other-${suffix}`;
const created: string[] = [];
let server: Server;
let base = "";

async function call(user: string, path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${base}/api/product-bulk${path}`, {
    method,
    headers: { "x-test-user": user, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function seed(owner: string, name: string, opts: {
  status?: string; removalKind?: string; variants?: Array<{ sku: string; priceCents: number; stock?: number }>;
} = {}) {
  const [p] = await db.insert(products).values({
    ownerId: owner, name, status: opts.status ?? "active", removalKind: opts.removalKind ?? null,
  }).returning({ id: products.id });
  created.push(p.id);
  const vs = opts.variants ?? [{ sku: `${name}-${suffix}`.replace(/\s+/g, "-"), priceCents: 5000, stock: 7 }];
  if (vs.length) {
    await db.insert(productVariants).values(vs.map((v) => ({ productId: p.id, sku: v.sku, priceCents: v.priceCents, stock: v.stock ?? 0 })));
  }
  return p.id;
}
const prices = async (id: string) =>
  (await db.select({ p: productVariants.priceCents }).from(productVariants).where(eq(productVariants.productId, id))).map((r) => r.p).sort();
const statusOf = async (id: string) => (await db.select({ s: products.status }).from(products).where(eq(products.id, id)))[0].s;

beforeAll(async () => {
  const { default: router } = await import("../product-bulk");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: (o: unknown) => console.error(o), warn: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/product-bulk", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  state.limit = null;
  state.priceDrops.length = 0;
  state.activity.length = 0;
});

afterAll(async () => {
  if (created.length) {
    // Variants, compare-at and SEO rows cascade from their product.
    const copies = await db.select({ id: products.id }).from(products).where(inArray(products.ownerId, [seller, other]));
    await db.delete(products).where(inArray(products.id, [...created, ...copies.map((c) => c.id)]));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /price", () => {
  it("previews before/after per product without writing", async () => {
    const id = await seed(seller, "Preview Tee", { variants: [
      { sku: `PV-A-${suffix}`, priceCents: 4000 }, { sku: `PV-B-${suffix}`, priceCents: 5000 },
    ] });
    const { status, body } = await call(seller, "/price", "POST", {
      productIds: [id], change: { mode: "percent", direction: "decrease", value: 1000 }, preview: true,
    });
    expect(status).toBe(200);
    expect(body.preview).toBe(true);
    expect(body.items[0]).toMatchObject({ beforeMin: 4000, beforeMax: 5000, afterMin: 3600, afterMax: 4500, changed: true });
    expect(await prices(id)).toEqual([4000, 5000]);
    expect(state.priceDrops).toHaveLength(0);
    expect(state.activity).toHaveLength(0);
  });

  it("applies a percent decrease, rounds to .99, stores compare-at, notifies and logs", async () => {
    const a = await seed(seller, "Apply A", { variants: [{ sku: `AP-A-${suffix}`, priceCents: 4000 }] });
    const b = await seed(seller, "Apply B", { variants: [{ sku: `AP-B-${suffix}`, priceCents: 2000 }] });
    const { status, body } = await call(seller, "/price", "POST", {
      productIds: [a, b], change: { mode: "percent", direction: "decrease", value: 1000 },
      rounding: "end_99", compareAt: "previous",
    });
    expect(status).toBe(200);
    expect(body.summary).toMatchObject({ products: 2, changedProducts: 2, variants: 2 });
    expect(await prices(a)).toEqual([3599]);
    expect(await prices(b)).toEqual([1799]);
    const [cmp] = await db.select().from(productVariantCompareAt)
      .innerJoin(productVariants, eq(productVariants.id, productVariantCompareAt.variantId))
      .where(eq(productVariants.productId, a));
    expect(cmp.product_variant_compare_at.compareAtCents).toBe(4000);
    expect(state.priceDrops.map((d) => [d.productId, d.previousPriceCents, d.newPriceCents]).sort())
      .toEqual([[a, 4000, 3599], [b, 2000, 1799]].sort());
    expect(state.activity).toHaveLength(2);
  });

  it("does not fire price-drop notifications for increases", async () => {
    const id = await seed(seller, "Raise", { variants: [{ sku: `RS-${suffix}`, priceCents: 3000 }] });
    const { status } = await call(seller, "/price", "POST", {
      productIds: [id], change: { mode: "amount", direction: "increase", value: 500 },
    });
    expect(status).toBe(200);
    expect(await prices(id)).toEqual([3500]);
    expect(state.priceDrops).toHaveLength(0);
  });

  it("floors at one cent", async () => {
    const id = await seed(seller, "Floor", { variants: [{ sku: `FL-${suffix}`, priceCents: 300 }] });
    await call(seller, "/price", "POST", { productIds: [id], change: { mode: "amount", direction: "decrease", value: 99999 } });
    expect(await prices(id)).toEqual([1]);
  });

  it("refuses another seller's products and changes nothing (all-or-nothing)", async () => {
    const mine = await seed(seller, "Mine", { variants: [{ sku: `MN-${suffix}`, priceCents: 5000 }] });
    const theirs = await seed(other, "Theirs", { variants: [{ sku: `TH-${suffix}`, priceCents: 5000 }] });
    const { status, body } = await call(seller, "/price", "POST", {
      productIds: [mine, theirs], change: { mode: "set", value: 100 },
    });
    expect(status).toBe(404);
    expect(body).toMatchObject({ code: "PRODUCT_NOT_FOUND", missingIds: [theirs] });
    expect(await prices(mine)).toEqual([5000]);
    expect(await prices(theirs)).toEqual([5000]);
  });

  it("rejects more than 200 products and malformed input", async () => {
    const ids = Array.from({ length: 201 }, () => crypto.randomUUID());
    const tooMany = await call(seller, "/price", "POST", { productIds: ids, change: { mode: "set", value: 100 } });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.code).toBe("TOO_MANY_PRODUCTS");
    const bad = await call(seller, "/price", "POST", { productIds: ["nope"], change: { mode: "set", value: 100 } });
    expect(bad.status).toBe(400);
    const badChange = await call(seller, "/price", "POST", { productIds: [crypto.randomUUID()], change: { mode: "set", value: 0 } });
    expect(badChange.status).toBe(400);
  });

  it("reports products without variants as skipped", async () => {
    const id = await seed(seller, "No variants", { variants: [] });
    const { body } = await call(seller, "/price", "POST", { productIds: [id], change: { mode: "set", value: 100 }, preview: true });
    expect(body.items[0].skipped).toBe("no_variants");
  });
});

describe("POST /status", () => {
  it("archives and unarchives a selection", async () => {
    const a = await seed(seller, "Arch A");
    const b = await seed(seller, "Arch B", { status: "draft" });
    const archived = await call(seller, "/status", "POST", { productIds: [a, b], status: "archived" });
    expect(archived.status).toBe(200);
    expect(archived.body.updated.sort()).toEqual([a, b].sort());
    expect(await statusOf(a)).toBe("archived");
    const back = await call(seller, "/status", "POST", { productIds: [a, b], status: "draft" });
    expect(back.status).toBe(200);
    expect(await statusOf(b)).toBe("draft");
  });

  it("enforces the plan product limit when unarchiving, and rolls the whole batch back", async () => {
    const owner = `${seller}-limit`;
    const live1 = await seed(owner, "Live 1");
    const live2 = await seed(owner, "Live 2");
    const arch1 = await seed(owner, "Archived 1", { status: "archived" });
    const arch2 = await seed(owner, "Archived 2", { status: "archived" });
    state.limit = 3; // two live + one more fits, two more does not
    const tooMany = await call(owner, "/status", "POST", { productIds: [arch1, arch2], status: "active" });
    expect(tooMany.status).toBe(403);
    expect(tooMany.body.code).toBe("PLAN_LIMIT_REACHED");
    expect(await statusOf(arch1)).toBe("archived");
    expect(await statusOf(arch2)).toBe("archived");
    const one = await call(owner, "/status", "POST", { productIds: [arch1], status: "active" });
    expect(one.status).toBe(200);
    expect(await statusOf(arch1)).toBe("active");
    // Archiving is always allowed, even at the cap.
    const arc = await call(owner, "/status", "POST", { productIds: [live1, live2], status: "archived" });
    expect(arc.status).toBe(200);
  });

  it("refuses moderation-locked listings and leaves the rest of the batch untouched", async () => {
    const locked = await seed(seller, "Locked", { status: "archived", removalKind: "moderation_removed" });
    const fine = await seed(seller, "Fine", { status: "archived" });
    const { status, body } = await call(seller, "/status", "POST", { productIds: [fine, locked], status: "active" });
    expect(status).toBe(409);
    expect(body).toMatchObject({ code: "PRODUCT_MODERATION_LOCKED", lockedIds: [locked] });
    expect(await statusOf(fine)).toBe("archived");
    const archive = await call(seller, "/status", "POST", { productIds: [locked], status: "archived" });
    expect(archive.status).toBe(200);
  });

  it("cannot touch another seller's products", async () => {
    const theirs = await seed(other, "Theirs status");
    const { status } = await call(seller, "/status", "POST", { productIds: [theirs], status: "archived" });
    expect(status).toBe(404);
    expect(await statusOf(theirs)).toBe("active");
  });

  it("validates the target status", async () => {
    const id = await seed(seller, "Bad status");
    const { status } = await call(seller, "/status", "POST", { productIds: [id], status: "deleted" });
    expect(status).toBe(400);
  });
});

describe("POST /duplicate", () => {
  it("copies products with variants as drafts with unique SKUs", async () => {
    const src = await seed(seller, "Dupe Me", { variants: [
      { sku: `DUPE-S-${suffix}`, priceCents: 4200, stock: 9 }, { sku: `DUPE-M-${suffix}`, priceCents: 4400, stock: 3 },
    ] });
    const [v] = await db.select().from(productVariants).where(eq(productVariants.sku, `DUPE-S-${suffix}`));
    await db.insert(productVariantCompareAt).values({ variantId: v.id, compareAtCents: 6000 });
    await db.insert(productSeo).values({ productId: src, ownerId: seller, seoTitle: "T", urlHandle: `dupe-me-${suffix}`, noIndex: true });

    const first = await call(seller, "/duplicate", "POST", { productIds: [src] });
    expect(first.status).toBe(201);
    const copyId = first.body.created[0].id as string;
    expect(first.body.created[0].name).toBe("Dupe Me (Copy)");
    expect(await statusOf(copyId)).toBe("draft");
    const copyVariants = await db.select().from(productVariants).where(eq(productVariants.productId, copyId));
    expect(copyVariants.map((c) => c.sku).sort()).toEqual([`DUPE-M-${suffix}-COPY`, `DUPE-S-${suffix}-COPY`]);
    expect(copyVariants.every((c) => c.stock === 0)).toBe(true);
    expect(copyVariants.map((c) => c.priceCents).sort()).toEqual([4200, 4400]);
    const cmp = await db.select().from(productVariantCompareAt).where(eq(productVariantCompareAt.variantId, copyVariants.find((c) => c.priceCents === 4200)!.id));
    expect(cmp[0].compareAtCents).toBe(6000);
    const [seo] = await db.select().from(productSeo).where(eq(productSeo.productId, copyId));
    expect(seo).toMatchObject({ seoTitle: "T", noIndex: true, urlHandle: null });

    const second = await call(seller, "/duplicate", "POST", { productIds: [src], copyInventory: true });
    expect(second.status).toBe(201);
    const secondVariants = await db.select().from(productVariants).where(eq(productVariants.productId, second.body.created[0].id));
    expect(secondVariants.map((c) => c.sku).sort()).toEqual([`DUPE-M-${suffix}-COPY-2`, `DUPE-S-${suffix}-COPY-2`]);
    expect(secondVariants.map((c) => c.stock).sort()).toEqual([3, 9]);
  });

  it("respects the plan limit and is atomic", async () => {
    const owner = `${seller}-dupelimit`;
    const a = await seed(owner, "Limit A");
    const b = await seed(owner, "Limit B");
    state.limit = 3;
    const { status, body } = await call(owner, "/duplicate", "POST", { productIds: [a, b] });
    expect(status).toBe(403);
    expect(body.code).toBe("PLAN_LIMIT_REACHED");
    const after = await db.select({ id: products.id }).from(products).where(eq(products.ownerId, owner));
    expect(after).toHaveLength(2);
  });

  it("cannot duplicate another seller's product", async () => {
    const theirs = await seed(other, "Theirs dupe");
    const { status } = await call(seller, "/duplicate", "POST", { productIds: [theirs] });
    expect(status).toBe(404);
  });
});

describe("GET /products", () => {
  it("lists only the seller's products with price range, filters by status and search", async () => {
    const owner = `${seller}-list`;
    await seed(owner, "Zebra Jacket", { variants: [{ sku: `ZJ-A-${suffix}`, priceCents: 1000 }, { sku: `ZJ-B-${suffix}`, priceCents: 3000 }] });
    await seed(owner, "Quiet Cap", { status: "archived" });
    await seed(other, "Zebra Other");
    const all = await call(owner, "/products");
    expect(all.body.total).toBe(2);
    const zebra = all.body.items.find((i: any) => i.name === "Zebra Jacket");
    expect(zebra).toMatchObject({ minPriceCents: 1000, maxPriceCents: 3000, variantCount: 2 });
    const archived = await call(owner, "/products?status=archived");
    expect(archived.body.items.map((i: any) => i.name)).toEqual(["Quiet Cap"]);
    const search = await call(owner, "/products?q=zebra");
    expect(search.body.items.map((i: any) => i.name)).toEqual(["Zebra Jacket"]);
    const bySku = await call(owner, `/products?q=ZJ-B-${suffix}`);
    expect(bySku.body.items).toHaveLength(1);
  });
});
