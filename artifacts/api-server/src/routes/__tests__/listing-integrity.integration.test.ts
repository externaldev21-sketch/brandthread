/**
 * Counterfeit keyword guard (feature 69) on every path that takes a listing
 * live: create, edit, bulk publish. Drafts are never blocked; verified
 * sellers are never blocked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, users } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

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
const unverified = `li-unverified-${suffix}`;
const verified = `li-verified-${suffix}`;
let server: Server;
let base = "";

async function call(user: string, path: string, method: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "x-test-user": user, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function seed(owner: string, name: string, status = "draft") {
  const [p] = await db.insert(products).values({ ownerId: owner, name, status }).returning({ id: products.id });
  return p.id;
}
const statusOf = async (id: string) => (await db.select({ s: products.status }).from(products).where(eq(products.id, id)))[0].s;

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: unverified, email: `${unverified}@t.local`, name: "U", username: `liu_${suffix}`, role: "seller", accountType: "seller" },
    {
      clerkId: verified, email: `${verified}@t.local`, name: "V", username: `liv_${suffix}`, role: "seller", accountType: "seller",
      verified: true, verificationStatus: "verified",
    },
  ]);
  const { default: productsRouter } = await import("../products");
  const { default: bulkRouter } = await import("../product-bulk");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: (o: unknown) => console.error(o), warn: () => undefined }; next(); });
  app.use(express.json());
  app.use("/api/products", productsRouter);
  app.use("/api/product-bulk", bulkRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(products).where(inArray(products.ownerId, [unverified, verified]));
  await db.delete(users).where(inArray(users.clerkId, [unverified, verified]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/products", () => {
  it("refuses to publish a listing with counterfeit terms from an unverified seller", async () => {
    const { status, body } = await call(unverified, "/api/products", "POST", { name: "Replica Gucci belt", status: "active" });
    expect(status).toBe(422);
    expect(body).toMatchObject({ code: "COUNTERFEIT_TERMS", terms: ["replica", "gucci"], verifyRoute: "/seller-verification" });
    const rows = await db.select().from(products).where(eq(products.ownerId, unverified));
    expect(rows.find((r) => r.name === "Replica Gucci belt")).toBeUndefined();
  });

  it("saves the same listing as a draft", async () => {
    const { status, body } = await call(unverified, "/api/products", "POST", { name: "Gucci belt", status: "draft" });
    expect(status).toBe(201);
    expect(body.status).toBe("draft");
  });

  it("publishes for a verified seller", async () => {
    const { status } = await call(verified, "/api/products", "POST", { name: "Nike Dunk Low, worn twice", status: "active" });
    expect(status).toBe(201);
  });

  it("publishes clean listings", async () => {
    const { status } = await call(unverified, "/api/products", "POST", { name: "Heavyweight boxy tee", status: "active" });
    expect(status).toBe(201);
  });
});

describe("PUT /api/products/:id", () => {
  it("blocks publishing a draft whose stored text has a protected brand", async () => {
    const id = await seed(unverified, "Prada nylon bag");
    const { status, body } = await call(unverified, `/api/products/${id}`, "PUT", { status: "active" });
    expect(status).toBe(422);
    expect(body.terms).toEqual(["prada"]);
    expect(await statusOf(id)).toBe("draft");
  });

  it("blocks editing a live listing to add a counterfeit term", async () => {
    const id = await seed(unverified, "Boxy tee", "active");
    const { status } = await call(unverified, `/api/products/${id}`, "PUT", { description: "1:1 mirror quality" });
    expect(status).toBe(422);
  });

  it("lets a draft edit through and publishes once the term is removed", async () => {
    const id = await seed(unverified, "Replica tee");
    expect((await call(unverified, `/api/products/${id}`, "PUT", { description: "still a draft" })).status).toBe(200);
    expect((await call(unverified, `/api/products/${id}`, "PUT", { name: "Studio tee", status: "active" })).status).toBe(200);
    expect(await statusOf(id)).toBe("active");
  });
});

describe("POST /api/product-bulk/status", () => {
  it("refuses the whole batch and names the blocked listings", async () => {
    const clean = await seed(unverified, "Clean hoodie");
    const flagged = await seed(unverified, "Balenciaga runners");
    const { status, body } = await call(unverified, "/api/product-bulk/status", "POST", { productIds: [clean, flagged], status: "active" });
    expect(status).toBe(422);
    expect(body).toMatchObject({ code: "COUNTERFEIT_TERMS", blockedIds: [flagged] });
    expect(await statusOf(clean)).toBe("draft");
  });

  it("publishes a verified seller's batch", async () => {
    const id = await seed(verified, "Balenciaga runners");
    const { status } = await call(verified, "/api/product-bulk/status", "POST", { productIds: [id], status: "active" });
    expect(status).toBe(200);
    expect(await statusOf(id)).toBe("active");
  });
});
