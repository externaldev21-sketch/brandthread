/**
 * Shopify full-catalog import over OAuth, end to end against a real database:
 * not-configured honesty → connect/start (Shopify consent URL) → signed OAuth
 * callback (code → token exchange, mocked at fetch) → background import with
 * live progress → products with photos (copied into object storage), sizes,
 * colors and stock → a re-run updates in place without duplicating.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import {
  db, productOptionAxes, products, productVariants, shopifyConnections, shopifyProductLinks,
  shopifyOauthStates, shopifyCatalogImportJobs,
} from "@workspace/db";

const suffix = crypto.randomBytes(5).toString("hex");
const ownerId = `shopify-catalog-owner-${suffix}`;
const shopDomain = `catalog-${suffix}.myshopify.com`;

const state = vi.hoisted(() => ({
  ownerId: "",
  catalog: [] as any[],
  pageSize: 4,
  storedObjects: [] as string[],
  pageGate: null as null | Promise<void>,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = state.ownerId; next(); },
}));
vi.mock("../../middlewares/requireRole", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../lib/planAccess", () => ({
  getVerifiedPlanAccess: async () => ({ planId: "growth", limits: { products: null, teamSeats: 0 } }),
}));
vi.mock("../../lib/productImageResize", () => ({
  normalizeUploadedImage: async (buffer: Buffer, contentType: string) => ({ buffer, contentType }),
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async createObjectEntityFromBuffer() {
      const path = `/objects/uploads/${crypto.randomUUID()}`;
      state.storedObjects.push(path);
      return path;
    }
    async trySetObjectEntityAclPolicy() {}
  },
}));
// Only the Shopify network edge is faked; the GraphQL → product mapping runs for real.
vi.mock("../../lib/shopify/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/shopify/catalog")>();
  class FakeCatalogClient {
    async countProducts() { return state.catalog.length; }
    async productsPage(after: string | null) {
      if (state.pageGate) await state.pageGate;
      const start = after ? Number(after) : 0;
      const nodes = state.catalog.slice(start, start + state.pageSize);
      const next = start + state.pageSize < state.catalog.length ? String(start + state.pageSize) : null;
      return { products: nodes.map(actual.toRestShape), nextCursor: next };
    }
  }
  return { ...actual, ShopifyCatalogClient: FakeCatalogClient };
});

function graphqlProduct(i: number, overrides: Partial<{ price: string; stock: number }> = {}) {
  const id = String(9000 + i);
  return {
    legacyResourceId: id,
    title: `Heavyweight Tee ${i}`,
    descriptionHtml: `<p>Organic cotton tee <strong>no. ${i}</strong>.</p>`,
    productType: "T-Shirts",
    tags: ["cotton", "basics"],
    options: [{ name: "Color", position: 2 }, { name: "Size", position: 1 }],
    media: { nodes: [
      { image: { url: `https://cdn.shopify.com/s/files/1/tee-${i}-front.jpg?v=1` } },
      { image: { url: `https://cdn.shopify.com/s/files/1/tee-${i}-back.jpg?v=1` } },
      {}, // a video — not an image
    ] },
    variants: { nodes: ["S", "M", "L"].map((size, v) => ({
      legacyResourceId: `${id}${v}`,
      sku: `TEE-${i}-${size}`,
      price: overrides.price ?? "38.00",
      inventoryQuantity: overrides.stock ?? 4 + v,
      selectedOptions: [{ name: "Size", value: size }, { name: "Color", value: "Bone" }],
    })) },
  };
}

const API_SECRET = "catalog-test-secret";
let server: Server;
let base = "";
const realFetch = globalThis.fetch;
const shopifyCalls: string[] = [];

async function request(method: string, path: string, body?: unknown) {
  const response = await realFetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await response.text();
  let parsed: any = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* html */ }
  return { status: response.status, body: parsed };
}

async function waitForJob(id: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await request("GET", `/api/shopify/catalog-import/${id}`);
    if (response.body.status !== "running") return response.body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("catalog import did not finish");
}

function signedCallbackQuery(params: Record<string, string>) {
  const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  const hmac = crypto.createHmac("sha256", API_SECRET).update(message).digest("hex");
  return new URLSearchParams({ ...params, hmac }).toString();
}

beforeAll(async () => {
  state.ownerId = ownerId;
  delete process.env.SHOPIFY_APP_API_KEY;
  delete process.env.SHOPIFY_APP_API_SECRET;
  delete process.env.SHOPIFY_APP_REDIRECT_URI;
  delete process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY;

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://cdn.shopify.com/")) {
      shopifyCalls.push(url);
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    }
    if (url === `https://${shopDomain}/admin/oauth/access_token`) {
      shopifyCalls.push(url);
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ client_id: "catalog-client-id", client_secret: API_SECRET, code: "grant-code" });
      return Response.json({ access_token: "shpat_from_oauth", scope: "read_products,read_inventory" });
    }
    if (url.startsWith(`https://${shopDomain}/admin/api/`) && url.includes("/webhooks.json")) {
      shopifyCalls.push(url);
      return init?.method === "POST" ? Response.json({ webhook: { id: 1 } }) : Response.json({ webhooks: [] });
    }
    return realFetch(input, init);
  });

  const { default: shopifyRouter } = await import("../shopify");
  const { default: callbackRouter } = await import("../shopify-oauth-callback");
  const app = express();
  app.use(express.json());
  app.use("/api/shopify/oauth/callback", callbackRouter);
  app.use("/api/shopify", shopifyRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.restoreAllMocks();
  const owned = await db.select({ id: products.id }).from(products).where(eq(products.ownerId, ownerId));
  if (owned.length) await db.delete(productOptionAxes).where(inArray(productOptionAxes.productId, owned.map((p) => p.id)));
  if (owned.length) await db.delete(productVariants).where(inArray(productVariants.productId, owned.map((p) => p.id)));
  await db.delete(products).where(eq(products.ownerId, ownerId));
  await db.delete(shopifyProductLinks).where(eq(shopifyProductLinks.ownerId, ownerId));
  await db.delete(shopifyCatalogImportJobs).where(eq(shopifyCatalogImportJobs.ownerId, ownerId));
  await db.delete(shopifyOauthStates).where(eq(shopifyOauthStates.ownerId, ownerId));
  await db.delete(shopifyConnections).where(eq(shopifyConnections.ownerId, ownerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Shopify catalog import over OAuth", () => {
  it("says honestly that Shopify isn't configured yet and never starts a connection", async () => {
    const status = await request("GET", "/api/shopify/status");
    expect(status.body).toMatchObject({ configured: false, connected: false });
    const start = await request("POST", "/api/shopify/connect/start", { shopDomain, purpose: "import" });
    expect(start.status).toBe(503);
    expect(start.body.error).toBe("not_configured");
  });

  it("has no route that accepts a pasted access token", async () => {
    const pasted = await request("POST", "/api/shopify/connect/custom-app", { shopDomain, accessToken: "shpat_x", purpose: "import" });
    expect(pasted.status).toBe(404);
  });

  it("connects through Shopify's consent screen with read-only scopes", async () => {
    process.env.SHOPIFY_APP_API_KEY = "catalog-client-id";
    process.env.SHOPIFY_APP_API_SECRET = API_SECRET;

    const status = await request("GET", "/api/shopify/status");
    expect(status.body.configured).toBe(true);

    const start = await request("POST", "/api/shopify/connect/start", { shopDomain: shopDomain.replace(".myshopify.com", ""), purpose: "import" });
    expect(start.status).toBe(200);
    const authorize = new URL(start.body.authorizeUrl);
    expect(authorize.origin).toBe(`https://${shopDomain}`);
    expect(authorize.pathname).toBe("/admin/oauth/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("catalog-client-id");
    expect(authorize.searchParams.get("scope")).toBe("read_products,read_inventory");
    expect(authorize.searchParams.get("redirect_uri")).toMatch(/\/api\/shopify\/oauth\/callback$/);
    const oauthState = authorize.searchParams.get("state")!;

    // A forged callback (bad signature) is refused.
    const forged = await request("GET", `/api/shopify/oauth/callback?shop=${shopDomain}&code=x&state=${oauthState}&hmac=00`);
    expect(forged.status).toBe(401);

    const callback = await request("GET", `/api/shopify/oauth/callback?${signedCallbackQuery({
      code: "grant-code", shop: shopDomain, state: oauthState, timestamp: String(Math.floor(Date.now() / 1000)),
    })}`);
    expect(callback.status).toBe(200);
    expect(callback.body).toContain("brandthread://shopify-import?shopify=connected");

    const [connection] = await db.select().from(shopifyConnections).where(eq(shopifyConnections.ownerId, ownerId));
    expect(connection).toMatchObject({ shopDomain, connectionType: "oauth", status: "connected", scopes: "read_products,read_inventory" });
    expect(connection.accessTokenEncrypted).not.toContain("shpat_from_oauth");

    const after = await request("GET", "/api/shopify/status");
    expect(after.body).toMatchObject({ configured: true, connected: true, shopDomain });
  });

  it("imports the full catalog with progress, photos, sizes and stock", async () => {
    state.catalog = Array.from({ length: 10 }, (_, i) => graphqlProduct(i + 1));
    let release!: () => void;
    state.pageGate = new Promise<void>((resolve) => { release = resolve; });

    const started = await request("POST", "/api/shopify/catalog-import");
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ status: "running", processedCount: 0 });

    // A second tap while it runs returns the same job instead of a duplicate run.
    const again = await request("POST", "/api/shopify/catalog-import");
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(started.body.id);
    release();
    state.pageGate = null;

    const done = await waitForJob(started.body.id);
    expect(done).toMatchObject({
      status: "complete", totalCount: 10, processedCount: 10, importedCount: 10, updatedCount: 0, skippedCount: 0,
      imagesStored: 20, imagesLinked: 0,
    });

    const imported = await db.select().from(products).where(eq(products.ownerId, ownerId));
    expect(imported).toHaveLength(10);
    const tee = imported.find((p) => p.name === "Heavyweight Tee 3")!;
    expect(tee).toMatchObject({ status: "draft", description: "Organic cotton tee no. 3.", category: "t-shirts" });
    expect(tee.images).toHaveLength(2);
    expect((tee.images as string[]).every((img) => img.startsWith("/objects/uploads/"))).toBe(true);

    const variants = await db.select().from(productVariants).where(eq(productVariants.productId, tee.id));
    expect(variants.map((v) => [v.size, v.color, v.priceCents, v.stock]).sort()).toEqual([
      ["L", "Bone", 3800, 6], ["M", "Bone", 3800, 5], ["S", "Bone", 3800, 4],
    ]);
    // Size/Color axes in Shopify's option order, so the Variants & stock editor works on imports.
    const axes = await db.select().from(productOptionAxes).where(eq(productOptionAxes.productId, tee.id));
    expect(axes.sort((a, b) => a.position - b.position).map((a) => [a.name, a.values])).toEqual([
      ["Size", ["S", "M", "L"]], ["Color", ["Bone"]],
    ]);

    const latest = await request("GET", "/api/shopify/catalog-import/latest");
    expect(latest.body.id).toBe(started.body.id);
  });

  it("re-running updates prices and stock in place without duplicating or re-downloading photos", async () => {
    const downloadsBefore = shopifyCalls.filter((u) => u.startsWith("https://cdn.shopify.com/")).length;
    const storedBefore = state.storedObjects.length;
    state.catalog = [
      ...Array.from({ length: 10 }, (_, i) => graphqlProduct(i + 1, i === 2 ? { price: "42.00", stock: 0 } : {})),
      graphqlProduct(11),
    ];
    const started = await request("POST", "/api/shopify/catalog-import");
    const done = await waitForJob(started.body.id);
    expect(done).toMatchObject({ status: "complete", processedCount: 11, importedCount: 1, updatedCount: 10, imagesStored: 2 });

    const imported = await db.select().from(products).where(eq(products.ownerId, ownerId));
    expect(imported).toHaveLength(11);
    const tee = imported.find((p) => p.name === "Heavyweight Tee 3")!;
    const variants = await db.select().from(productVariants).where(eq(productVariants.productId, tee.id));
    expect(variants).toHaveLength(3);
    expect(variants.every((v) => v.priceCents === 4200 && v.stock === 0)).toBe(true);

    expect(shopifyCalls.filter((u) => u.startsWith("https://cdn.shopify.com/")).length - downloadsBefore).toBe(2);
    expect(state.storedObjects.length - storedBefore).toBe(2);
  });

  it("reports products Shopify sent that can't be imported instead of hiding them", async () => {
    state.catalog = [graphqlProduct(1), { ...graphqlProduct(99), variants: { nodes: [] } }];
    const started = await request("POST", "/api/shopify/catalog-import");
    const done = await waitForJob(started.body.id);
    expect(done).toMatchObject({ status: "complete", processedCount: 2, updatedCount: 1, skippedCount: 1 });
    expect(done.skipped[0]).toMatchObject({ shopifyProductId: "9099", title: "Heavyweight Tee 99" });
  });

  it("reports a job whose process died as stopped instead of frozen progress", async () => {
    const [stale] = await db.insert(shopifyCatalogImportJobs).values({
      ownerId, shopDomain, status: "running", totalCount: 61, processedCount: 23,
      updatedAt: new Date(Date.now() - 6 * 60 * 1000),
    }).returning();
    const read = await request("GET", `/api/shopify/catalog-import/${stale.id}`);
    expect(read.body).toMatchObject({ status: "failed", processedCount: 23 });
    expect(read.body.errorMessage).toMatch(/stopped before it finished/);
  });
});
