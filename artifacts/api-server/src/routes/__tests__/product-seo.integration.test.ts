/**
 * Integration tests for /api/product-seo — seller editing, handle uniqueness
 * and the public resolved-SEO / sitemap endpoints.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, products, storefronts } from "@workspace/db";
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
vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/activityLog", () => ({
  logActivity: async () => undefined,
  reqActor: (req: any) => ({ ownerClerkId: req.clerkUserId, actorClerkId: req.clerkUserId, actorRole: "owner" }),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `seo-seller-${suffix}`;
const other = `seo-other-${suffix}`;
const storeSlug = `seo-store-${suffix}`;
const productIds: string[] = [];
let server: Server;
let base = "";

async function call(user: string | null, path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${base}/api/product-seo${path}`, {
    method,
    headers: { ...(user ? { "x-test-user": user } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function seed(owner: string, name: string, extra: Partial<typeof products.$inferInsert> = {}) {
  const [p] = await db.insert(products).values({ ownerId: owner, name, status: "active", ...extra }).returning({ id: products.id });
  productIds.push(p.id);
  return p.id;
}

beforeAll(async () => {
  const { default: router } = await import("../product-seo");
  const app = express();
  app.use(express.json());
  app.use("/api/product-seo", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(storefronts).where(eq(storefronts.slug, storeSlug));
  if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("seller GET/PUT", () => {
  it("returns the stored fields, the resolved listing and a suggested handle", async () => {
    const id = await seed(seller, "Linen Shirt", { description: "Soft linen." });
    const { status, body } = await call(seller, `/${id}`);
    expect(status).toBe(200);
    expect(body.seo).toMatchObject({ seoTitle: null, urlHandle: null, noIndex: false });
    expect(body.suggestedHandle).toBe("linen-shirt");
    expect(body.resolved.title).toBe("Linen Shirt");
    expect(body.limits).toEqual({ title: 70, description: 160, handle: 80 });
  });

  it("saves and round-trips SEO fields", async () => {
    const id = await seed(seller, "Wool Coat");
    const put = await call(seller, `/${id}`, "PUT", {
      seoTitle: "Wool coat for winter", seoDescription: "Warm.", urlHandle: `wool-coat-${suffix}`, noIndex: true,
      socialImageUrl: "https://cdn.example.com/og.png",
    });
    expect(put.status).toBe(200);
    expect(put.body.resolved).toMatchObject({ title: "Wool coat for winter", handle: `wool-coat-${suffix}`, noIndex: true });
    const get = await call(seller, `/${id}`);
    expect(get.body.seo.seoDescription).toBe("Warm.");
  });

  it("validates lengths, handle rules and image link", async () => {
    const id = await seed(seller, "Validation");
    expect((await call(seller, `/${id}`, "PUT", { seoTitle: "x".repeat(71) })).status).toBe(400);
    expect((await call(seller, `/${id}`, "PUT", { seoTitle: "x".repeat(70) })).status).toBe(200);
    expect((await call(seller, `/${id}`, "PUT", { seoDescription: "x".repeat(161) })).status).toBe(400);
    const badHandle = await call(seller, `/${id}`, "PUT", { urlHandle: "Not A Handle" });
    expect(badHandle.status).toBe(400);
    expect(badHandle.body.code).toBe("INVALID_HANDLE");
    expect((await call(seller, `/${id}`, "PUT", { socialImageUrl: "javascript:alert(1)" })).status).toBe(400);
    expect((await call(seller, `/${id}`, "PUT", { noIndex: "yes" })).status).toBe(400);
  });

  it("keeps handles unique per seller but not across sellers", async () => {
    const a = await seed(seller, "Unique A");
    const b = await seed(seller, "Unique B");
    const theirs = await seed(other, "Unique Other");
    const handle = `taken-${suffix}`;
    expect((await call(seller, `/${a}`, "PUT", { urlHandle: handle })).status).toBe(200);
    const clash = await call(seller, `/${b}`, "PUT", { urlHandle: handle.toUpperCase() });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("HANDLE_TAKEN");
    expect((await call(other, `/${theirs}`, "PUT", { urlHandle: handle })).status).toBe(200);
    // Re-saving the same product with its own handle is fine.
    expect((await call(seller, `/${a}`, "PUT", { urlHandle: handle })).status).toBe(200);
    // The suggestion for a product named like a taken handle skips it.
    const c = await seed(seller, `Taken ${suffix}`);
    expect((await call(seller, `/${c}`)).body.suggestedHandle).toBe(`taken-${suffix}-2`);
  });

  it("cannot read or write another seller's product", async () => {
    const theirs = await seed(other, "Private");
    expect((await call(seller, `/${theirs}`)).status).toBe(404);
    expect((await call(seller, `/${theirs}`, "PUT", { seoTitle: "hack" })).status).toBe(404);
    expect((await call(seller, "/not-a-uuid")).status).toBe(404);
  });
});

describe("public endpoints", () => {
  let indexed = "";
  let hidden = "";
  let draft = "";

  beforeAll(async () => {
    await db.insert(storefronts).values({
      ownerId: `${seller}-pub`, slug: storeSlug, title: "Nova Studio", status: "published",
      seo: { sitemapEnabled: true, productSeoDefaults: { titleTemplate: "{{product}} | {{store}}", descriptionTemplate: "{{description}}" } },
    });
    const owner = `${seller}-pub`;
    indexed = await seed(owner, "Public Hoodie", { description: "Heavy fleece." });
    hidden = await seed(owner, "Hidden Hoodie");
    draft = await seed(owner, "Draft Hoodie", { status: "draft" });
    await call(owner, `/${indexed}`, "PUT", { urlHandle: `public-hoodie-${suffix}` });
    await call(owner, `/${hidden}`, "PUT", { noIndex: true });
    await call(owner, `/${draft}`, "PUT", { urlHandle: `draft-hoodie-${suffix}` });
  });

  it("resolves SEO by handle using the store templates", async () => {
    const { status, body } = await call(null, `/public/${storeSlug}/public-hoodie-${suffix}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      productId: indexed, title: "Public Hoodie | Nova Studio", description: "Heavy fleece.",
      noIndex: false, robots: "index, follow", path: `/products/public-hoodie-${suffix}`,
    });
  });

  it("resolves by product id and reports noindex", async () => {
    const { status, body } = await call(null, `/public/${storeSlug}/${hidden}`);
    expect(status).toBe(200);
    expect(body.robots).toBe("noindex, nofollow");
  });

  it("404s for drafts, unknown handles and unpublished stores", async () => {
    expect((await call(null, `/public/${storeSlug}/draft-hoodie-${suffix}`)).status).toBe(404);
    expect((await call(null, `/public/${storeSlug}/nothing`)).status).toBe(404);
    expect((await call(null, `/public/no-such-store/whatever`)).status).toBe(404);
  });

  it("keeps noindex and non-active products out of the sitemap", async () => {
    const { status, body } = await call(null, `/public/${storeSlug}/sitemap`);
    expect(status).toBe(200);
    const ids = body.entries.map((e: any) => e.productId);
    expect(ids).toContain(indexed);
    expect(ids).not.toContain(hidden);
    expect(ids).not.toContain(draft);
  });

  it("returns an empty sitemap when the store turned it off", async () => {
    await db.update(storefronts).set({ seo: { sitemapEnabled: false } }).where(eq(storefronts.slug, storeSlug));
    const { body } = await call(null, `/public/${storeSlug}/sitemap`);
    expect(body.entries).toEqual([]);
  });
});
