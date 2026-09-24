import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, manufacturers, manufacturerProducts, manufacturerProductPriceTiers } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: auth.userId || null }),
  clerkClient: { users: { getUser: async () => null } },
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!auth.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.clerkUserId = auth.userId;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../../routes/notifications-feed", () => ({
  publishNotification: async () => undefined,
}));

vi.mock("../../lib/brandthreadEmail", () => ({
  sendManufacturerSignupEmail: async () => undefined,
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) {
      return `https://objects.test${path}`;
    }
  },
}));

let server: Server;
let publicServer: Server;
let base = "";
let publicBase = "";
const prefix = `manufacturer-products-${crypto.randomBytes(8).toString("hex")}`;
const createdManufacturerIds: string[] = [];

async function request(baseUrl: string, path: string, method = "GET", body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function seedManufacturer(clerkId: string, overrides: Partial<typeof manufacturers.$inferInsert> = {}) {
  const [row] = await db.insert(manufacturers).values({
    clerkId,
    businessName: `${prefix}-factory-${createdManufacturerIds.length}`,
    country: "US",
    specialty: "Cut and sew",
    status: "active",
    isPublicDirectory: true,
    ...overrides,
  }).returning();
  createdManufacturerIds.push(row.id);
  return row;
}

beforeAll(async () => {
  const { default: manufacturersRouter } = await import("../manufacturers");
  const { default: manufacturerPublicRouter } = await import("../manufacturer-public");

  const app = express();
  app.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  app.use(express.json());
  app.use("/api/manufacturers", manufacturersRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const publicApp = express();
  publicApp.use((req, _res, next) => {
    (req as any).log = { error: () => undefined, warn: () => undefined };
    next();
  });
  publicApp.use(express.json());
  publicApp.use("/api/manufacturers/public", manufacturerPublicRouter);
  await new Promise<void>((resolve) => {
    publicServer = publicApp.listen(0, "127.0.0.1", () => resolve());
  });
  publicBase = `http://127.0.0.1:${(publicServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (createdManufacturerIds.length) {
    const ids = createdManufacturerIds.splice(0);
    const products = await db.select({ id: manufacturerProducts.id }).from(manufacturerProducts)
      .where(inArray(manufacturerProducts.manufacturerId, ids));
    if (products.length) {
      await db.delete(manufacturerProductPriceTiers).where(inArray(manufacturerProductPriceTiers.productId, products.map((p) => p.id)));
    }
    await db.delete(manufacturerProducts).where(inArray(manufacturerProducts.manufacturerId, ids));
    await db.delete(manufacturers).where(inArray(manufacturers.id, ids));
  }
  auth.userId = "";
});

afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    new Promise<void>((resolve, reject) => publicServer.close((error) => error ? reject(error) : resolve())),
  ]);
});

describe("manufacturer product catalog", () => {
  it("creates a product with quantity price tiers and returns them sorted", async () => {
    const clerkId = `${prefix}-clerk-a`;
    await seedManufacturer(clerkId);
    auth.userId = clerkId;

    const created = await request(base, "/api/manufacturers/me/products", "POST", {
      name: "Custom Hoodie",
      description: "Heavyweight fleece hoodie",
      category: "Cut & Sew",
      moq: 100,
      leadTimeDays: 21,
      samplePriceCents: 4500,
      priceTiers: [
        { minQuantity: 500, unitPriceCents: 900 },
        { minQuantity: 100, maxQuantity: 499, unitPriceCents: 1200 },
      ],
    });
    expect(created.status).toBe(201);
    const body = await json<{ id: string; priceTiers: Array<{ minQuantity: number; unitPriceCents: number }> }>(created);
    expect(body.priceTiers.map((t) => t.minQuantity)).toEqual([100, 500]);
    expect(body.priceTiers[0].unitPriceCents).toBe(1200);

    const listed = await request(base, "/api/manufacturers/me/products");
    expect(listed.status).toBe(200);
    const list = await json<Array<{ id: string }>>(listed);
    expect(list.map((p) => p.id)).toContain(body.id);
  });

  it("rejects a product without price tiers", async () => {
    const clerkId = `${prefix}-clerk-b`;
    await seedManufacturer(clerkId);
    auth.userId = clerkId;

    const created = await request(base, "/api/manufacturers/me/products", "POST", {
      name: "No Tiers Product",
      priceTiers: [],
    });
    expect(created.status).toBe(400);
  });

  it("updates a product and replaces its price tiers", async () => {
    const clerkId = `${prefix}-clerk-c`;
    await seedManufacturer(clerkId);
    auth.userId = clerkId;

    const created = await request(base, "/api/manufacturers/me/products", "POST", {
      name: "Tote Bag",
      priceTiers: [{ minQuantity: 50, unitPriceCents: 300 }],
    });
    const { id } = await json<{ id: string }>(created);

    const updated = await request(base, `/api/manufacturers/me/products/${id}`, "PATCH", {
      status: "draft",
      priceTiers: [
        { minQuantity: 50, maxQuantity: 199, unitPriceCents: 280 },
        { minQuantity: 200, unitPriceCents: 220 },
      ],
    });
    expect(updated.status).toBe(200);
    const body = await json<{ status: string; priceTiers: unknown[] }>(updated);
    expect(body.status).toBe("draft");
    expect(body.priceTiers).toHaveLength(2);
  });

  it("isolates products between manufacturers and enforces ownership on delete", async () => {
    const clerkA = `${prefix}-clerk-d`;
    const clerkB = `${prefix}-clerk-e`;
    await seedManufacturer(clerkA);
    await seedManufacturer(clerkB);

    auth.userId = clerkA;
    const created = await request(base, "/api/manufacturers/me/products", "POST", {
      name: "Seller A Product",
      priceTiers: [{ minQuantity: 10, unitPriceCents: 500 }],
    });
    const { id } = await json<{ id: string }>(created);

    auth.userId = clerkB;
    const listedByB = await request(base, "/api/manufacturers/me/products");
    expect(await json(listedByB)).toEqual([]);

    const deleteByB = await request(base, `/api/manufacturers/me/products/${id}`, "DELETE");
    expect(deleteByB.status).toBe(404);
  });

  it("exposes only active products through the public catalog", async () => {
    const clerkId = `${prefix}-clerk-f`;
    const mfr = await seedManufacturer(clerkId);
    auth.userId = clerkId;

    const active = await request(base, "/api/manufacturers/me/products", "POST", {
      name: "Public Active Product",
      priceTiers: [{ minQuantity: 25, unitPriceCents: 700 }],
    });
    const activeBody = await json<{ id: string }>(active);

    const draft = await request(base, "/api/manufacturers/me/products", "POST", {
      name: "Hidden Draft Product",
      priceTiers: [{ minQuantity: 25, unitPriceCents: 700 }],
    });
    const draftBody = await json<{ id: string }>(draft);
    await request(base, `/api/manufacturers/me/products/${draftBody.id}`, "PATCH", { status: "draft" });

    const publicList = await request(publicBase, `/api/manufacturers/public/${mfr.id}/products`);
    expect(publicList.status).toBe(200);
    const products = await json<Array<{ id: string; priceTiers: unknown[] }>>(publicList);
    expect(products.map((p) => p.id)).toEqual([activeBody.id]);
    expect(products[0].priceTiers).toHaveLength(1);

    const publicDraft = await request(publicBase, `/api/manufacturers/public/${mfr.id}/products/${draftBody.id}`);
    expect(publicDraft.status).toBe(404);

    const publicDetail = await request(publicBase, `/api/manufacturers/public/${mfr.id}/products/${activeBody.id}`);
    expect(publicDetail.status).toBe(200);
  });
});
