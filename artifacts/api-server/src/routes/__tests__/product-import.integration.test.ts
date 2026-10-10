import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray, like } from "drizzle-orm";
import { db, products, productVariants, productImportMappings, productImportRuns, etsyConnections, etsyOauthStates } from "@workspace/db";

const plan = vi.hoisted(() => ({ limit: null as number | null }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.header("x-test-user");
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/planAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/planAccess")>();
  return {
    ...actual,
    getVerifiedPlanAccess: async () => ({ planId: "starter", limits: { products: plan.limit } }),
  };
});

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../lib/productImport/__tests__/fixtures");
const fixture = (name: string) => fs.readFileSync(path.join(fixtures, name), "utf8");

let server: Server;
let base = "";
const prefix = `pimp-${crypto.randomBytes(6).toString("hex")}`;
const sellerA = `${prefix}-a`;
const sellerB = `${prefix}-b`;

function call(user: string, route: string, opts: { method?: string; csv?: string } = {}) {
  return fetch(`${base}/api/product-import${route}`, {
    method: opts.method ?? (opts.csv !== undefined ? "POST" : "GET"),
    headers: { "x-test-user": user, ...(opts.csv !== undefined ? { "content-type": "text/csv" } : {}) },
    body: opts.csv,
  });
}

const ENV_KEYS = ["ETSY_API_KEY", "ETSY_SHARED_SECRET", "ETSY_REDIRECT_URI", "ETSY_TOKEN_ENCRYPTION_KEY", "SHOPIFY_TOKEN_ENCRYPTION_KEY",
  "SHOPIFY_APP_API_KEY", "SHOPIFY_APP_API_SECRET", "SHOPIFY_APP_REDIRECT_URI"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  const { default: router, etsyCallbackRouter } = await import("../product-import");
  const app = express();
  app.use(express.json());
  app.use("/api/product-import/etsy/callback", etsyCallbackRouter);
  app.use("/api/product-import", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  plan.limit = null;
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(async () => {
  const owned = await db.select({ id: products.id }).from(products).where(like(products.ownerId, `${prefix}%`));
  if (owned.length) {
    await db.delete(productVariants).where(inArray(productVariants.productId, owned.map((p) => p.id)));
    await db.delete(products).where(inArray(products.id, owned.map((p) => p.id)));
  }
  await db.delete(productImportRuns).where(like(productImportRuns.ownerId, `${prefix}%`));
  await db.delete(etsyConnections).where(like(etsyConnections.ownerId, `${prefix}%`));
  await db.delete(etsyOauthStates).where(like(etsyOauthStates.ownerId, `${prefix}%`));
});

afterAll(async () => {
  for (const key of ENV_KEYS) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

async function productsOf(owner: string) {
  const rows = await db.select().from(products).where(eq(products.ownerId, owner));
  const variants = rows.length ? await db.select().from(productVariants).where(inArray(productVariants.productId, rows.map((r) => r.id))) : [];
  return { rows, variants };
}

describe("providers", () => {
  it("requires sign-in", async () => {
    const res = await fetch(`${base}/api/product-import/providers`);
    expect(res.status).toBe(401);
  });

  it("reports csv on and etsy off with a reason when keys are missing", async () => {
    const body: any = await (await call(sellerA, "/providers")).json();
    expect(body.csv).toBe(true);
    expect(body.etsy).toEqual({ enabled: false, connected: false, reason: "Etsy import isn't enabled on this server." });
    expect(body.shopify).toMatchObject({ publicUrl: true, oauth: false, connected: false });
  });

  it("reports etsy enabled once all keys exist, and shopify oauth when its env is complete", async () => {
    process.env.ETSY_API_KEY = "k"; process.env.ETSY_SHARED_SECRET = "s";
    process.env.ETSY_REDIRECT_URI = "https://api.example.com/api/product-import/etsy/callback";
    process.env.ETSY_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    process.env.SHOPIFY_APP_API_KEY = "a"; process.env.SHOPIFY_APP_API_SECRET = "b";
    process.env.SHOPIFY_APP_REDIRECT_URI = "https://x"; process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    const body: any = await (await call(sellerA, "/providers")).json();
    expect(body.etsy).toMatchObject({ enabled: true, connected: false });
    expect(body.shopify.oauth).toBe(true);
  });

  it("does not enable etsy when only some keys are set", async () => {
    process.env.ETSY_API_KEY = "k";
    const body: any = await (await call(sellerA, "/providers")).json();
    expect(body.etsy.enabled).toBe(false);
  });

  it("etsy endpoints answer 503 (not a crash) when disabled", async () => {
    for (const [route, method] of [["/etsy/connect/start", "POST"], ["/etsy/preview", "POST"], ["/etsy/commit", "POST"]] as const) {
      const res = await fetch(`${base}/api/product-import${route}`, { method, headers: { "x-test-user": sellerA } });
      expect(res.status, route).toBe(503);
      expect((await res.json() as any).message).toBe("Etsy import isn't enabled on this server.");
    }
    const cb = await fetch(`${base}/api/product-import/etsy/callback?code=x&state=y`);
    expect(cb.status).toBe(503);
  });
});

describe("csv preview", () => {
  it("detects the layout, counts products/variants, reports row errors, and writes nothing", async () => {
    const res = await call(sellerA, "/csv/preview", { csv: fixture("shopify_export.csv") });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toMatchObject({ layout: "shopify", layoutLabel: "Shopify export", source: "shopify_csv" });
    expect(body.counts).toMatchObject({ products: 3, variants: 5, create: 3, update: 0, unchanged: 0 });
    expect(body.counts.errors).toBeGreaterThan(0);
    expect(body.issues[0].severity).toBe("error");
    expect(body.sample[0]).toMatchObject({ name: "Boxy Tee", variantCount: 3, action: "create", priceFromCents: 4800 });
    expect((await productsOf(sellerA)).rows).toHaveLength(0);
  });

  it("rejects unknown layouts, empty files, and oversize row counts with clear errors", async () => {
    let res = await call(sellerA, "/csv/preview", { csv: "foo,bar\n1,2" });
    expect(res.status).toBe(422);
    expect((await res.json() as any).error).toBe("LAYOUT_UNKNOWN");
    res = await call(sellerA, "/csv/preview", { csv: "name,price\n" });
    expect((await res.json() as any).error).toBe("NO_ROWS");
    res = await call(sellerA, "/csv/preview", { csv: "" });
    expect(res.status).toBe(400);
    const many = "name,price\n" + Array.from({ length: 2001 }, (_, i) => `P${i},1`).join("\n");
    res = await call(sellerA, "/csv/preview", { csv: many });
    expect(res.status).toBe(413);
    expect((await res.json() as any).error).toBe("TOO_MANY_ROWS");
  });

  it("rejects files over 5 MB", async () => {
    const big = "name,price\n" + "x".repeat(5 * 1024 * 1024 + 10);
    const res = await call(sellerA, "/csv/preview", { csv: big });
    expect(res.status).toBe(413);
    expect((await res.json() as any).error).toBe("FILE_TOO_LARGE");
  });
});

describe("csv commit", () => {
  it("folds Shopify variants into one product with variants, as drafts, with mappings", async () => {
    const res = await call(sellerA, "/csv/commit?filename=export.csv", { csv: fixture("shopify_export.csv") });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.counts).toMatchObject({ created: 3, updated: 0, unchanged: 0, failed: 0 });
    const { rows, variants } = await productsOf(sellerA);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.name === "Boxy Tee")).toMatchObject({ status: "draft", category: "tops" });
    expect(rows.find((r) => r.name === "Sock Set")!.status).toBe("archived");
    const boxy = rows.find((r) => r.name === "Boxy Tee")!;
    expect(variants.filter((v) => v.productId === boxy.id).map((v) => v.sku).sort()).toEqual(["BOXY-L-WHT", "BOXY-M-BLK", "BOXY-S-BLK"]);
    const maps = await db.select().from(productImportMappings).where(eq(productImportMappings.ownerId, sellerA));
    expect(maps.map((m) => m.externalKey).sort()).toEqual(["boxy-tee", "cargo-pant", "sock-set"]);
  });

  it("is idempotent: re-importing the same file changes nothing, and an edited file updates in place", async () => {
    const csv = fixture("generic_comma.csv");
    await call(sellerA, "/csv/commit", { csv });
    const again: any = await (await call(sellerA, "/csv/commit", { csv })).json();
    expect(again.counts).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect((await productsOf(sellerA)).rows).toHaveLength(1);

    const edited = csv.replace(",32,", ",35,").replace(",10\n", ",20\n");
    const preview: any = await (await call(sellerA, "/csv/preview", { csv: edited })).json();
    expect(preview.counts).toMatchObject({ create: 0, update: 1, unchanged: 0 });
    const updated: any = await (await call(sellerA, "/csv/commit", { csv: edited })).json();
    expect(updated.counts).toMatchObject({ created: 0, updated: 1 });
    const { rows, variants } = await productsOf(sellerA);
    expect(rows).toHaveLength(1);
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ priceCents: 3500, stock: 20 });
  });

  it("adds a new variant to an existing product on re-import", async () => {
    await call(sellerA, "/csv/commit", { csv: "name,price,sku,size\nTee,10,T-S,S\n" });
    await call(sellerA, "/csv/commit", { csv: "name,price,sku,size\nTee,10,T-S,S\nTee,10,T-M,M\n" });
    const { rows, variants } = await productsOf(sellerA);
    expect(rows).toHaveLength(1);
    expect(variants.map((v) => v.sku).sort()).toEqual(["T-M", "T-S"]);
  });

  it("resolves SKU collisions: within the file, and against another seller's product", async () => {
    await call(sellerB, "/csv/commit", { csv: "name,price,sku\nTheirs,5,SHARED-SKU\n" });
    const csv = `name,price,sku\nOne,10,${prefix}-DUP\nTwo,10,${prefix}-DUP\nThree,10,SHARED-SKU\n`;
    const preview: any = await (await call(sellerA, "/csv/preview", { csv })).json();
    expect(preview.issues.filter((i: any) => i.field === "sku")).toHaveLength(2);
    const res: any = await (await call(sellerA, "/csv/commit", { csv })).json();
    expect(res.counts.created).toBe(3);
    const { variants } = await productsOf(sellerA);
    const skus = variants.map((v) => v.sku);
    expect(new Set(skus).size).toBe(3);
    expect(skus).toContain(`${prefix}-DUP`);
    expect(skus).toContain(`${prefix}-DUP-2`);
    expect(skus.find((s) => s.startsWith("SHARED-SKU-"))).toBeTruthy();
    // Seller B's own product keeps its SKU.
    expect((await productsOf(sellerB)).variants.map((v) => v.sku)).toEqual(["SHARED-SKU"]);
    // Re-import is stable (no duplicates, no churn).
    const again: any = await (await call(sellerA, "/csv/commit", { csv })).json();
    expect(again.counts).toMatchObject({ created: 0, unchanged: 3 });
  });

  it("generates stable SKUs for rows without one", async () => {
    await call(sellerA, "/csv/commit", { csv: "name,price\nNo Sku Tee,10\n" });
    const first = (await productsOf(sellerA)).variants[0].sku;
    expect(first).toMatch(/^IMP-[0-9A-F]{20}$/);
    await call(sellerA, "/csv/commit", { csv: "name,price,stock\nNo Sku Tee,10,4\n" });
    const { variants } = await productsOf(sellerA);
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ sku: first, stock: 4 });
  });

  it("imports drafts past the plan's live-product cap (drafts don't count)", async () => {
    plan.limit = 2;
    const csv = "name,price\nA,1\nB,2\nC,3\n";
    const preview: any = await (await call(sellerA, "/csv/preview", { csv })).json();
    expect(preview.capacity).toMatchObject({ limit: 2, used: 0, remaining: 2, newProducts: 3, wouldExceed: false });
    expect(preview.notes.join(" ")).toContain("you can publish 2 more");
    const res: any = await (await call(sellerA, "/csv/commit", { csv })).json();
    expect(res.counts).toMatchObject({ created: 3, skipped: 0 });
    expect(res.planLimitReached).toBe(false);
    const { rows } = await productsOf(sellerA);
    expect(rows).toHaveLength(3);
    expect(rows.every((r: any) => r.status === "draft")).toBe(true);
  });

  it("scopes everything to the owner: same file, two sellers, no cross-talk", async () => {
    const csv = "name,price,sku\nShared Name,10,\n";
    await call(sellerA, "/csv/commit", { csv });
    const b: any = await (await call(sellerB, "/csv/commit", { csv })).json();
    expect(b.counts.created).toBe(1);
    expect((await productsOf(sellerA)).rows).toHaveLength(1);
    expect((await productsOf(sellerB)).rows).toHaveLength(1);
    const runsB: any = await (await call(sellerB, "/runs")).json();
    expect(runsB.runs).toHaveLength(1);
    const maps = await db.select().from(productImportMappings).where(like(productImportMappings.ownerId, `${prefix}%`));
    expect(new Set(maps.map((m) => m.productId)).size).toBe(2);
  });

  it("skips (does not resurrect or overwrite) a product the seller soft-deleted", async () => {
    await call(sellerA, "/csv/commit", { csv: "name,price\nGone,10\n" });
    const { rows } = await productsOf(sellerA);
    await db.update(products).set({ deletedAt: new Date() }).where(eq(products.id, rows[0].id));
    const res: any = await (await call(sellerA, "/csv/commit", { csv: "name,price\nGone,12\n" })).json();
    expect(res.counts).toMatchObject({ created: 0, skipped: 1 });
  });

  it("returns NOTHING_TO_IMPORT when every row is invalid", async () => {
    const res = await call(sellerA, "/csv/commit", { csv: "name,price\nBad,abc\n" });
    expect(res.status).toBe(422);
    expect((await res.json() as any).error).toBe("NOTHING_TO_IMPORT");
  });

  it("imports an Etsy CSV with variations", async () => {
    const res: any = await (await call(sellerA, "/csv/commit", { csv: fixture("etsy_listings.csv") })).json();
    expect(res.source).toBe("etsy_csv");
    expect(res.counts.created).toBe(3);
    const { rows, variants } = await productsOf(sellerA);
    const tote = rows.find((r) => r.name === "Embroidered Tote")!;
    expect(variants.filter((v) => v.productId === tote.id)).toHaveLength(4);
  });
});
