/**
 * Seller payout gate: listings can only go live once the owner's Stripe
 * Connect account is active (charges + payouts enabled). Covers every publish
 * path — POST/PUT /api/products, POST /api/product-bulk/status and the Shopify
 * import's publishStatus — plus GET /api/products/payout-gate, and checks that
 * listings already live before the gate are never unpublished.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { payoutReadinessFrom } from "../../lib/payoutGate";

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
  getVerifiedPlanAccess: async () => ({ planId: "growth", limits: { products: null, teamSeats: 0 } }),
}));
vi.mock("../../lib/activityEvents", () => ({ notifyNewProduct: async () => undefined }));
vi.mock("../../lib/activityLog", () => ({
  logActivity: async () => undefined,
  reqActor: (req: any) => ({ ownerClerkId: req.clerkUserId, actorClerkId: req.clerkUserId, actorRole: "owner" }),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const noAccount = `gate-none-${suffix}`;
const pending = `gate-pending-${suffix}`;
const restricted = `gate-restricted-${suffix}`;
const ready = `gate-ready-${suffix}`;
const sellers = [noAccount, pending, restricted, ready];
let server: Server;
let base = "";

async function call(user: string, path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "x-test-user": user, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function seed(owner: string, status: string) {
  const [p] = await db.insert(products).values({ ownerId: owner, name: `Gate ${status} ${suffix}`, status })
    .returning({ id: products.id });
  return p.id;
}
const statusOf = async (id: string) => (await db.select({ s: products.status }).from(products).where(eq(products.id, id)))[0].s;
const listing = (status: string) => ({
  name: `Gate Tee ${suffix}`, status, variants: [{ sku: `GATE-${crypto.randomBytes(4).toString("hex")}`, priceCents: 4500, stock: 3 }],
});

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: noAccount, email: `${noAccount}@test.local`, name: "No Account" },
    { clerkId: pending, email: `${pending}@test.local`, name: "Pending", stripeAccountId: `acct_p_${suffix}`, stripeAccountStatus: "pending" },
    { clerkId: restricted, email: `${restricted}@test.local`, name: "Restricted", stripeAccountId: `acct_r_${suffix}`, stripeAccountStatus: "restricted" },
    { clerkId: ready, email: `${ready}@test.local`, name: "Ready", stripeAccountId: `acct_a_${suffix}`, stripeAccountStatus: "active" },
  ]);
  const [{ default: productsRouter }, { default: bulkRouter }, { default: shopifyRouter }] = await Promise.all([
    import("../products"), import("../product-bulk"), import("../shopify"),
  ]);
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: (o: unknown) => console.error(o), warn: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/products", productsRouter);
  app.use("/api/product-bulk", bulkRouter);
  app.use("/api/shopify", shopifyRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(products).where(inArray(products.ownerId, sellers));
  await db.delete(users).where(inArray(users.clerkId, sellers));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("payoutReadinessFrom", () => {
  it("is ready only with an account whose cached status is active", () => {
    expect(payoutReadinessFrom(undefined)).toEqual({ ready: false, status: "not_started" });
    expect(payoutReadinessFrom({ stripeAccountId: null, stripeAccountStatus: "active" })).toEqual({ ready: false, status: "not_started" });
    expect(payoutReadinessFrom({ stripeAccountId: "acct_1", stripeAccountStatus: null })).toEqual({ ready: false, status: "pending" });
    expect(payoutReadinessFrom({ stripeAccountId: "acct_1", stripeAccountStatus: "restricted" })).toEqual({ ready: false, status: "restricted" });
    expect(payoutReadinessFrom({ stripeAccountId: "acct_1", stripeAccountStatus: "active" })).toEqual({ ready: true, status: "active" });
  });
});

describe("POST /api/products", () => {
  it.each([
    [noAccount, "not_started"],
    [pending, "pending"],
    [restricted, "restricted"],
  ])("refuses to publish for %s with PAYOUTS_NOT_READY and creates nothing", async (seller, payoutStatus) => {
    const res = await call(seller, "/products", "POST", listing("active"));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "PAYOUTS_NOT_READY", payoutStatus });
    expect(res.body.error).toMatch(/draft/);
    const rows = await db.select({ id: products.id }).from(products).where(eq(products.ownerId, seller));
    expect(rows).toHaveLength(0);
  });

  it("still saves drafts before payouts are set up", async () => {
    const res = await call(noAccount, "/products", "POST", listing("draft"));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
  });

  it("publishes once Connect onboarding is complete", async () => {
    const res = await call(ready, "/products", "POST", listing("active"));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("active");
  });
});

describe("PUT /api/products/:id", () => {
  it("refuses draft → active before payouts are set up and leaves the draft as is", async () => {
    const id = await seed(pending, "draft");
    const res = await call(pending, `/products/${id}`, "PUT", { status: "active", name: "Renamed" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PAYOUTS_NOT_READY");
    const [row] = await db.select({ status: products.status, name: products.name }).from(products).where(eq(products.id, id));
    expect(row).toEqual({ status: "draft", name: `Gate draft ${suffix}` });
  });

  it("allows non-publishing edits to a draft", async () => {
    const id = await seed(noAccount, "draft");
    const res = await call(noAccount, `/products/${id}`, "PUT", { status: "draft", name: "Draft edit" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "draft", name: "Draft edit" });
  });

  it("never unpublishes a listing that went live before the gate, and keeps it editable", async () => {
    const id = await seed(noAccount, "active");
    const res = await call(noAccount, `/products/${id}`, "PUT", { status: "active", name: "Legacy edit" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "active", name: "Legacy edit" });
  });

  it("publishes a draft for a payout-ready seller", async () => {
    const id = await seed(ready, "draft");
    const res = await call(ready, `/products/${id}`, "PUT", { status: "active" });
    expect(res.status).toBe(200);
    expect(await statusOf(id)).toBe("active");
  });
});

describe("POST /api/product-bulk/status", () => {
  it("refuses to bulk-publish before payouts are set up and rolls the batch back", async () => {
    const draftId = await seed(restricted, "draft");
    const liveId = await seed(restricted, "active");
    const res = await call(restricted, "/product-bulk/status", "POST", { productIds: [draftId, liveId], status: "active" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "PAYOUTS_NOT_READY", payoutStatus: "restricted" });
    expect(await statusOf(draftId)).toBe("draft");
    expect(await statusOf(liveId)).toBe("active");
  });

  it("still lets the seller move listings to draft or archive", async () => {
    const liveId = await seed(restricted, "active");
    const res = await call(restricted, "/product-bulk/status", "POST", { productIds: [liveId], status: "draft" });
    expect(res.status).toBe(200);
    expect(await statusOf(liveId)).toBe("draft");
  });

  it("bulk-publishes for a payout-ready seller", async () => {
    const draftId = await seed(ready, "draft");
    const res = await call(ready, "/product-bulk/status", "POST", { productIds: [draftId], status: "active" });
    expect(res.status).toBe(200);
    expect(await statusOf(draftId)).toBe("active");
  });
});

describe("POST /api/shopify/products/import", () => {
  it("refuses publishStatus active before payouts are set up", async () => {
    const res = await call(noAccount, "/shopify/products/import", "POST", { shopifyProductIds: ["1"], publishStatus: "active" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PAYOUTS_NOT_READY");
  });

  it("does not gate draft imports", async () => {
    const res = await call(noAccount, "/shopify/products/import", "POST", { shopifyProductIds: ["1"], publishStatus: "draft" });
    // No Shopify connection in this test: the request moves past the gate to the connection check.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Connect Shopify first");
  });
});

describe("GET /api/products/payout-gate", () => {
  it("reports live listings that are waiting on payout setup", async () => {
    const seller = `gate-banner-${suffix}`;
    sellers.push(seller);
    await db.insert(users).values({ clerkId: seller, email: `${seller}@test.local`, name: "Banner" });
    await seed(seller, "active");
    await seed(seller, "active");
    await seed(seller, "draft");
    const res = await call(seller, "/products/payout-gate");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: false, payoutStatus: "not_started", liveProductCount: 2 });
  });

  it("reports ready for a seller who finished onboarding", async () => {
    const res = await call(ready, "/products/payout-gate");
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.payoutStatus).toBe("active");
  });
});
