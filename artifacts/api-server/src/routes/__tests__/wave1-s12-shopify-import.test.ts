/**
 * Wave 1 / s12: Shopify import robustness.
 *  - The AI copywriter answering valid JSON that isn't an object (e.g. `null`)
 *    used to crash the import at `ai.title`; it now falls back to stock copy.
 *  - A malformed job id is a 404, not a Postgres uuid error (500).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db, products, storefronts, shopifyImportJobs,
  shopifyImportProductMappings, shopifyImportCollections,
} from "@workspace/db";

const owner = `wave1-s12-shopify-${crypto.randomBytes(5).toString("hex")}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = owner; next(); },
}));
vi.mock("../../middlewares/requireRole", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../lib/planAccess", () => ({
  getVerifiedPlanAccess: async () => ({ limits: { products: null } }),
}));
vi.mock("@workspace/integrations-openai-ai-server/text", () => ({
  generateText: async () => "null",
}));
vi.mock("../../lib/shopifyImport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/shopifyImport")>();
  return {
    ...actual,
    assertPublicShopifyHost: async () => {},
    discoverShopifyCatalog: async () => ({
      products: [{
        id: 1, title: "Only product", body_html: "<p>Desc</p>", product_type: "shirts",
        images: [{ src: "https://cdn.shopify.com/p.jpg" }],
        options: [{ name: "Size" }],
        variants: [{ id: 11, sku: "SKU-1", price: "20.00", inventory_quantity: 2, option1: "M" }],
      }],
      collections: [],
      nextCursor: null,
      storeName: "Null Copy Label",
      aboutCopy: "",
    }),
  };
});

let server: Server;
let base = "";

async function request(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const { default: router } = await import("../shopify-import");
  const app = express();
  app.use(express.json());
  app.use("/api/shopify-imports", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const jobIds = (await db.select({ id: shopifyImportJobs.id }).from(shopifyImportJobs)
    .where(eq(shopifyImportJobs.ownerId, owner))).map((r) => r.id);
  if (jobIds.length) {
    await db.delete(shopifyImportCollections).where(inArray(shopifyImportCollections.importJobId, jobIds));
    await db.delete(shopifyImportProductMappings).where(inArray(shopifyImportProductMappings.importJobId, jobIds));
    await db.delete(shopifyImportJobs).where(inArray(shopifyImportJobs.id, jobIds));
  }
  await db.delete(products).where(eq(products.ownerId, owner));
  await db.delete(storefronts).where(eq(storefronts.ownerId, owner));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Shopify import (wave1 s12)", () => {
  it("completes with fallback copy when the AI answers JSON null", async () => {
    const started = await request("POST", "/api/shopify-imports", { url: "https://shop.example" });
    expect(started.status).toBe(202);
    let job: any = null;
    for (let i = 0; i < 150; i++) {
      job = (await request("GET", `/api/shopify-imports/${started.body.id}`)).body;
      if (!["queued", "running"].includes(job.status)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(job).toMatchObject({ status: "complete", importedCount: 1, errorCode: null });
    const [store] = await db.select().from(storefronts).where(eq(storefronts.ownerId, owner));
    expect(store.title).toBe("Null Copy Label");
  });

  it("answers 404 for a malformed job id on read and continue", async () => {
    const read = await request("GET", "/api/shopify-imports/not-a-uuid");
    expect(read.status).toBe(404);
    expect(read.body.error).toBe("IMPORT_NOT_FOUND");
    const cont = await request("POST", "/api/shopify-imports/not-a-uuid/continue");
    expect(cont.status).toBe(404);
  });
});
