import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, products, storefronts, shopifyImportJobs,
  shopifyImportProductMappings, shopifyImportCollections,
} from "@workspace/db";

const state = vi.hoisted(() => ({
  ownerId: "shopify-import-owner-a",
  failStorefront: false,
  cursor: null as string | null,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = state.ownerId;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("@workspace/integrations-openai-ai-server/text", () => ({
  generateText: async () => JSON.stringify({
    title: "Imported Label", tagline: "Made with intention.",
    heroHeading: "New forms.", heroDescription: "A study in everyday pieces.",
    storyHeading: "Our studio.", storyDescription: "Designed slowly.",
  }),
}));
vi.mock("../../lib/shopifyImport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/shopifyImport")>();
  return {
    ...actual,
    assertPublicShopifyHost: async () => {},
    discoverShopifyCatalog: async (_url: string, cursor?: string | null) => ({
      products: [{
        id: cursor ? 2 : 1,
        title: cursor ? "Second product" : "First product",
        body_html: "<p>Imported description</p>",
        product_type: "shirts",
        images: [{ src: "https://cdn.shopify.com/product.jpg" }],
        options: [{ name: "Size" }, { name: "Color" }],
        variants: [{ id: cursor ? 22 : 11, sku: "SOURCE-SKU", price: "20.00", inventory_quantity: 3, option1: "M", option2: "Black" }],
      }],
      collections: [{
        id: 7, title: "New arrivals", handle: "new-arrivals",
        sourceProductIds: [String(cursor ? 2 : 1)],
      }],
      nextCursor: cursor ? null : state.cursor,
      storeName: "Imported Label",
      aboutCopy: "Independent clothing studio.",
    }),
  };
});

let server: Server;
let base = "";
const owners = ["shopify-import-owner-a", "shopify-import-owner-b", "shopify-import-owner-rollback"];

async function request(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function waitForJob(id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await request("GET", `/api/shopify-imports/${id}`);
    if (!["queued", "running"].includes(response.body.status)) return response.body;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Shopify import did not finish");
}

beforeAll(async () => {
  const { default: router } = await import("../shopify-import");
  const app = express();
  app.use(express.json());
  app.use("/api/shopify-imports", router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const jobRows = await db.select({ id: shopifyImportJobs.id }).from(shopifyImportJobs)
    .where(inArray(shopifyImportJobs.ownerId, owners));
  const jobIds = jobRows.map((row) => row.id);
  if (jobIds.length) {
    await db.delete(shopifyImportCollections).where(inArray(shopifyImportCollections.importJobId, jobIds));
    await db.delete(shopifyImportProductMappings).where(inArray(shopifyImportProductMappings.importJobId, jobIds));
    await db.delete(shopifyImportJobs).where(inArray(shopifyImportJobs.id, jobIds));
  }
  await db.delete(products).where(inArray(products.ownerId, owners));
  await db.delete(storefronts).where(inArray(storefronts.ownerId, owners));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Shopify import lifecycle", () => {
  it("creates seller-owned products, supports continuation, and does not duplicate retries", async () => {
    state.ownerId = owners[0];
    state.cursor = "next-page";
    const started = await request("POST", "/api/shopify-imports", { url: "https://shop.example" });
    expect(started.status).toBe(202);
    const first = await waitForJob(started.body.id);
    expect(first).toMatchObject({ status: "needs_continuation", importedCount: 1, hasMore: true });

    const continuationResults = await Promise.all([
      request("POST", `/api/shopify-imports/${started.body.id}/continue`),
      request("POST", `/api/shopify-imports/${started.body.id}/continue`),
    ]);
    expect(continuationResults.map((result) => result.status).sort()).toEqual([202, 409]);
    const complete = await waitForJob(started.body.id);
    expect(complete).toMatchObject({ status: "complete", importedCount: 2, hasMore: false });

    state.cursor = null;
    const retry = await request("POST", "/api/shopify-imports", { url: "https://shop.example" });
    await waitForJob(retry.body.id);
    const owned = await db.select().from(products).where(eq(products.ownerId, owners[0]));
    expect(owned).toHaveLength(2);
    expect(owned.every((product) => product.ownerId === owners[0])).toBe(true);
    expect(owned.every((product) => product.category === "new arrivals")).toBe(true);
    const [store] = await db.select().from(storefronts).where(eq(storefronts.ownerId, owners[0]));
    const sections = store.sections as any[];
    expect(sections.find((section) => section.id === "shopify-collection-7").settings.productIds).toHaveLength(2);
    const latest = await request("GET", "/api/shopify-imports/latest");
    expect(latest.body.id).toBe(retry.body.id);
  });

  it("does not expose another seller's import job", async () => {
    state.ownerId = owners[0];
    const started = await request("POST", "/api/shopify-imports", { url: "https://other.example" });
    await waitForJob(started.body.id);
    state.ownerId = owners[1];
    expect((await request("GET", `/api/shopify-imports/${started.body.id}`)).status).toBe(404);
  });

  it("rolls the catalog back when storefront persistence fails", async () => {
    state.ownerId = owners[2];
    state.cursor = null;
    const slug = "store-deadbeef";
    await db.insert(storefronts).values({ ownerId: "slug-collision-owner", slug, title: "Collision" }).onConflictDoNothing();
    const randomBytes = vi.spyOn(crypto, "randomBytes").mockReturnValue(Buffer.from("deadbeef", "hex") as any);
    const started = await request("POST", "/api/shopify-imports", { url: "https://rollback.example" });
    const result = await waitForJob(started.body.id);
    randomBytes.mockRestore();
    expect(result.status).toBe("failed");
    expect(await db.select().from(products).where(eq(products.ownerId, owners[2]))).toHaveLength(0);
    expect(await db.select().from(shopifyImportProductMappings).where(eq(shopifyImportProductMappings.ownerId, owners[2]))).toHaveLength(0);
    await db.delete(storefronts).where(eq(storefronts.ownerId, "slug-collision-owner"));
  });
});