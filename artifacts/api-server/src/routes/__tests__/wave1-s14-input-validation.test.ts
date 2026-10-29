/**
 * Slice s14 input-validation fixes over real HTTP and Postgres:
 *  - waitlist: malformed ids answer 4xx (not 500), a variant must belong to
 *    the product, and a product-level join is not duplicated;
 *  - vacation: an unparseable vacationUntil answers 400 (not 500);
 *  - team activity: fractional limit/offset do not reach Postgres;
 *  - taxes/calculate: uses the effective tax switches (on unless opted out),
 *    like /status and checkout.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const taxCalls = vi.hoisted(() => [] as any[]);

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.header("x-test-user");
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/requireRole")>();
  const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return { ...actual, teamContext: pass, requireRole: pass };
});
vi.mock("../../lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/stripe")>();
  const stripe = {
    tax: {
      calculations: {
        create: async (params: any, opts: any) => {
          taxCalls.push({ params, opts });
          return { id: "taxcalc_s14", tax_amount_exclusive: 123, tax_breakdown: [] };
        },
      },
    },
  };
  return { ...actual, stripe, requireStripe: () => stripe };
});
vi.mock("../notifications-feed", () => ({ publishNotification: async () => {} }));

import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { db, productVariants, products, sellerTaxConfig, users, waitlistEntries } from "@workspace/db";

const suffix = crypto.randomBytes(5).toString("hex");
const seller = `s14-val-seller-${suffix}`;
const buyer = `s14-val-buyer-${suffix}`;
const productIds: string[] = [];
let server: Server;
let base = "";

async function api(path: string, user: string, method = "GET", body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "x-test-user": user, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

beforeAll(async () => {
  const [waitlist, vacation, team, taxes] = await Promise.all([
    import("../waitlist"), import("../vacation"), import("../team"), import("../taxes"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  app.use("/api/waitlist", waitlist.default);
  app.use("/api/seller/vacation", vacation.default);
  app.use("/api/team", team.default);
  app.use("/api/taxes", taxes.default);
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "internal" });
  });
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@test.invalid`, name: "S14 seller", role: "seller", accountType: "seller", stripeAccountId: `acct_s14_${suffix}` },
    { clerkId: buyer, email: `${buyer}@test.invalid`, name: "S14 buyer", role: "buyer", accountType: "buyer" },
  ]);
});

afterAll(async () => {
  if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(sellerTaxConfig).where(eq(sellerTaxConfig.sellerId, seller));
  await db.delete(users).where(inArray(users.clerkId, [seller, buyer]));
  await new Promise<void>((r) => server.close(() => r()));
});

async function makeProduct() {
  const [p] = await db.insert(products).values({ ownerId: seller, name: `S14 Tee ${suffix}`, status: "active" }).returning({ id: products.id });
  productIds.push(p.id);
  const [v] = await db.insert(productVariants).values({ productId: p.id, size: "M", sku: `S14-${p.id}`, priceCents: 1000, stock: 0 })
    .returning({ id: productVariants.id });
  return { productId: p.id, variantId: v.id };
}

describe("waitlist", () => {
  it("answers 4xx/200 for malformed ids instead of 500", async () => {
    expect((await api("/api/waitlist/join", buyer, "POST", { productId: "not-a-uuid" })).status).toBe(404);
    expect((await api("/api/waitlist/check/not-a-uuid", buyer)).status).toBe(200);
    expect((await api("/api/waitlist/leave?productId=nope", buyer, "DELETE")).status).toBe(200);
    expect((await api("/api/waitlist/seller/notify/nope", seller, "POST", {})).status).toBe(404);
  });

  it("rejects a variant that belongs to another product", async () => {
    const a = await makeProduct();
    const b = await makeProduct();
    const res = await api("/api/waitlist/join", buyer, "POST", { productId: a.productId, variantId: b.variantId });
    expect(res.status).toBe(404);
    const rows = await db.select().from(waitlistEntries).where(eq(waitlistEntries.productId, a.productId));
    expect(rows).toHaveLength(0);
  });

  it("does not duplicate a product-level (no variant) join", async () => {
    const a = await makeProduct();
    expect((await api("/api/waitlist/join", buyer, "POST", { productId: a.productId })).status).toBe(200);
    expect((await api("/api/waitlist/join", buyer, "POST", { productId: a.productId })).status).toBe(200);
    const rows = await db.select().from(waitlistEntries)
      .where(and(eq(waitlistEntries.productId, a.productId), eq(waitlistEntries.userId, buyer)));
    expect(rows).toHaveLength(1);
  });
});

describe("vacation", () => {
  it("rejects an unparseable vacationUntil with 400", async () => {
    const res = await api("/api/seller/vacation", seller, "PUT", { vacationMode: true, vacationUntil: "not-a-date" });
    expect(res.status).toBe(400);
    const ok = await api("/api/seller/vacation", seller, "PUT", { vacationMode: true, vacationUntil: "2099-01-01T00:00:00.000Z" });
    expect(ok.status).toBe(200);
    expect(ok.body.vacationMode).toBe(true);
  });
});

describe("team activity", () => {
  it("does not 500 on fractional or huge limit/offset", async () => {
    for (const qs of ["limit=2.5", "offset=1.5", "offset=1e30", "limit=abc&offset=-3"]) {
      const res = await api(`/api/team/activity?${qs}`, seller);
      expect(res.status, qs).toBe(200);
      expect(Array.isArray(res.body.logs)).toBe(true);
    }
  });
});

describe("taxes/calculate", () => {
  it("calculates tax (and shipping tax) for a seller who never opted out", async () => {
    taxCalls.length = 0;
    const res = await api("/api/taxes/calculate", seller, "POST", {
      lineItems: [{ amountCents: 5000, productId: "p1" }],
      shippingAddress: { street: "1 Main St", city: "Austin", state: "TX", zip: "78701", country: "US" },
      shippingCents: 700,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ taxAmountCents: 123, estimated: false });
    expect(taxCalls).toHaveLength(1);
    expect(taxCalls[0].params.shipping_cost).toEqual({ amount: 700 });
  });

  it("skips the calculation once the seller explicitly turns tax off", async () => {
    taxCalls.length = 0;
    expect((await api("/api/taxes/config", seller, "PATCH", { stripeTaxEnabled: false })).status).toBe(200);
    const res = await api("/api/taxes/calculate", seller, "POST", {
      lineItems: [{ amountCents: 5000 }], shippingAddress: { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" },
    });
    expect(res.body).toMatchObject({ taxAmountCents: 0, estimated: true });
    expect(taxCalls).toHaveLength(0);
  });
});
