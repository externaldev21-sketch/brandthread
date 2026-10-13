import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import {
  db, drops, productLaunches, productSeo, productVariants, products, storefronts, users,
} from "@workspace/db";

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `seo-seller-${suffix}`;
const suspended = `seo-susp-${suffix}`;
const privateBuyer = `seo-priv-${suffix}`;
const ids = [seller, suspended, privateBuyer];
const DAY = 24 * 3600 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

let server: Server;
let base = "";
const p: Record<string, string> = {};
const storeSlug = `seo-store-${suffix}`;
const hiddenSlug = `seo-hidden-${suffix}`;
let dropId = "";
let draftDropId = "";

const get = async (path: string) => {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: (await r.json().catch(() => null)) as any, headers: r.headers };
};

async function product(key: string, values: Partial<typeof products.$inferInsert>, variants: Array<Partial<typeof productVariants.$inferInsert>> = [{}]) {
  const [row] = await db.insert(products).values({
    ownerId: seller, name: `${key} ${suffix}`, status: "active", images: ["https://img.test/a.jpg", "/objects/private.jpg"], ...values,
  }).returning({ id: products.id });
  p[key] = row.id;
  let n = 0;
  for (const v of variants) {
    await db.insert(productVariants).values({ productId: row.id, sku: `SECRET-${key}-${suffix}-${n++}`, priceCents: 4500, stock: 3, ...v });
  }
  return row.id;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@seo.test`, name: "Seller", displayName: "Nova Person", brandName: "Nova Brand", role: "seller", accountType: "seller", inviteCode: `S${suffix.slice(0, 7).toUpperCase()}` },
    { clerkId: suspended, email: `${suspended}@seo.test`, name: "Susp", displayName: "Gone", role: "seller", accountType: "seller", suspendedAt: new Date(), inviteCode: `X${suffix.slice(0, 7).toUpperCase()}` },
    { clerkId: privateBuyer, email: `${privateBuyer}@seo.test`, name: "Priv", displayName: "Private Pat", role: "buyer", accountType: "buyer", isPrivate: true, inviteCode: `P${suffix.slice(0, 7).toUpperCase()}` },
  ]);
  await db.insert(storefronts).values([
    { ownerId: seller, slug: storeSlug, title: "Nova Goods", status: "published" },
    { ownerId: suspended, slug: hiddenSlug, title: "Hidden", status: "published" },
  ]);
  await product("fresh", { createdAt: ago(1), description: "<b>Soft</b> heavyweight hoodie." }, [
    { priceCents: 4500, compareAtPriceCents: 6000, stock: 0 },
    { priceCents: 5200, stock: 2 },
  ]);
  await product("older", { createdAt: ago(2) });
  await product("stale", { createdAt: ago(20) });
  await product("soldout", { createdAt: ago(3) }, [{ stock: 0 }]);
  await product("preorder", { createdAt: ago(3), isPreOrder: true }, [{ stock: 0 }]);
  await product("draft", { createdAt: ago(1), status: "draft" });
  await product("deleted", { createdAt: ago(1), deletedAt: new Date() });
  await product("noindex", { createdAt: ago(1) });
  await product("scheduled", { createdAt: ago(1) });
  await product("launchedRecently", { createdAt: ago(30) });
  await product("novariants", { createdAt: ago(1) }, []);
  await product("suspendedSeller", { createdAt: ago(1), ownerId: suspended });
  await db.insert(productSeo).values([
    { productId: p.noindex, ownerId: seller, noIndex: true },
    { productId: p.fresh, ownerId: seller, seoTitle: "Custom Title", socialImageUrl: "https://img.test/social.jpg" },
  ]);
  await db.insert(productLaunches).values([
    { productId: p.scheduled, launchAt: new Date(Date.now() + 2 * DAY) },
    { productId: p.launchedRecently, launchAt: ago(2), launchedAt: ago(2) },
  ]);
  const [d1, d2] = await db.insert(drops).values([
    { ownerId: seller, name: "Live drop", type: "pre-made", status: "active" },
    { ownerId: seller, name: "Draft drop", type: "pre-made", status: "draft" },
  ]).returning({ id: drops.id });
  dropId = d1.id;
  draftDropId = d2.id;

  const { default: router } = await import("../seo-public");
  const app = express();
  app.use("/api/v1/public", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(drops).where(inArray(drops.ownerId, ids));
  await db.delete(products).where(inArray(products.ownerId, ids));
  await db.delete(storefronts).where(inArray(storefronts.ownerId, ids));
  await db.delete(users).where(inArray(users.clerkId, ids));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /public/seo/products/:id", () => {
  it("returns schema.org Product inputs with the store name as brand and real availability", async () => {
    const r = await get(`/api/v1/public/seo/products/${p.fresh}`);
    expect(r.status).toBe(200);
    expect(r.body.name).toBe(`fresh ${suffix}`);
    expect(r.body.title).toBe("Custom Title");
    expect(r.body.brand).toBe("Nova Goods");
    expect(r.body.storeSlug).toBe(storeSlug);
    expect(r.body.images).toEqual(["https://img.test/a.jpg"]);
    expect(r.body.socialImageUrl).toBe("https://img.test/social.jpg");
    expect(r.body.price).toEqual({ lowCents: 4500, highCents: 5200, compareAtCents: 6000, offerCount: 2 });
    expect(r.body.availability).toBe("InStock");
    expect(r.body.longDescription).toBe("Soft heavyweight hoodie.");
    expect(r.body.noIndex).toBe(false);
    expect(r.body.sku).toBe(p.fresh);
    expect(r.headers.get("cache-control")).toContain("public");
  });

  it("never leaks the seller's private SKU, email or Clerk id", async () => {
    const r = await get(`/api/v1/public/seo/products/${p.fresh}`);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain("SECRET-");
    expect(text).not.toContain("@seo.test");
    expect(text).not.toContain(seller);
  });

  it("maps sold-out, pre-order and not-yet-launched products honestly", async () => {
    expect((await get(`/api/v1/public/seo/products/${p.soldout}`)).body.availability).toBe("OutOfStock");
    expect((await get(`/api/v1/public/seo/products/${p.preorder}`)).body.availability).toBe("PreOrder");
    expect((await get(`/api/v1/public/seo/products/${p.scheduled}`)).body.availability).toBe("OutOfStock");
  });

  it("passes the seller's hide-from-search setting through", async () => {
    expect((await get(`/api/v1/public/seo/products/${p.noindex}`)).body.noIndex).toBe(true);
  });

  it.each(["draft", "deleted", "suspendedSeller"])("404s a non-public product (%s)", async (key) => {
    expect((await get(`/api/v1/public/seo/products/${p[key]}`)).status).toBe(404);
  });

  it("404s unknown and malformed ids", async () => {
    expect((await get(`/api/v1/public/seo/products/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await get("/api/v1/public/seo/products/nope")).status).toBe(404);
  });
});

describe("GET /public/new-this-week", () => {
  it("lists only public, launched, indexable products first published in the last 7 days, newest first", async () => {
    const r = await get("/api/v1/public/new-this-week");
    expect(r.status).toBe(200);
    const mine = (r.body.items as any[]).filter((i) => i.name.endsWith(suffix)).map((i) => i.name.replace(` ${suffix}`, ""));
    expect(mine[0]).toBe("fresh");
    expect(new Set(mine)).toEqual(new Set(["fresh", "older", "launchedRecently", "soldout", "preorder"]));
    for (const excluded of ["stale", "draft", "deleted", "noindex", "scheduled", "novariants", "suspendedSeller"]) {
      expect(mine).not.toContain(excluded);
    }
    const times = (r.body.items as any[]).map((i) => Date.parse(i.publishedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("returns card fields only: image, name, brand, price, sold-out flag and link", async () => {
    const r = await get("/api/v1/public/new-this-week");
    const fresh = (r.body.items as any[]).find((i) => i.id === p.fresh);
    expect(fresh).toEqual({
      id: p.fresh, name: `fresh ${suffix}`, brand: "Nova Goods", imageUrl: "https://img.test/a.jpg",
      priceCents: 4500, compareAtPriceCents: 6000, hasPriceRange: true, currency: "USD", soldOut: false,
      publishedAt: expect.any(String), path: `/store/product/${p.fresh}`,
    });
    const soldout = (r.body.items as any[]).find((i) => i.id === p.soldout);
    expect(soldout.soldOut).toBe(true);
    expect((r.body.items as any[]).find((i) => i.id === p.preorder).soldOut).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain("SECRET-");
  });

  it("paginates with a capped page size and validates input", async () => {
    const r = await get("/api/v1/public/new-this-week?limit=1");
    expect(r.body.items).toHaveLength(1);
    expect(r.body.nextOffset).toBe(1);
    const big = await get("/api/v1/public/new-this-week?limit=9999");
    expect(big.status).toBe(200);
    expect(big.body.items.length).toBeLessThanOrEqual(48);
    expect((await get("/api/v1/public/new-this-week?limit=abc")).status).toBe(400);
    expect((await get("/api/v1/public/new-this-week?offset=-1")).status).toBe(400);
  });
});

describe("GET /public/seo/sitemap/:kind", () => {
  it("lists indexable public products only", async () => {
    const r = await get("/api/v1/public/seo/sitemap/products");
    expect(r.status).toBe(200);
    const paths = (r.body.entries as any[]).map((e) => e.path);
    expect(paths).toContain(`/store/product/${p.fresh}`);
    expect(paths).toContain(`/store/product/${p.stale}`);
    for (const key of ["draft", "deleted", "noindex", "scheduled", "suspendedSeller"]) {
      expect(paths).not.toContain(`/store/product/${p[key]}`);
    }
  });

  it("lists published stores of sellers in good standing and non-draft drops", async () => {
    const stores = (await get("/api/v1/public/seo/sitemap/stores")).body.entries.map((e: any) => e.path);
    expect(stores).toContain(`/store/${storeSlug}`);
    expect(stores).not.toContain(`/store/${hiddenSlug}`);
    const dropPaths = (await get("/api/v1/public/seo/sitemap/drops")).body.entries.map((e: any) => e.path);
    expect(dropPaths).toContain(`/drops/${dropId}`);
    expect(dropPaths).not.toContain(`/drops/${draftDropId}`);
  });

  it("404s an unknown sitemap kind", async () => {
    expect((await get("/api/v1/public/seo/sitemap/users")).status).toBe(404);
  });
});

describe("GET /public/invites/:code/share-preview", () => {
  it("returns only the inviter's public name and the invitee reward, without counting a click", async () => {
    const code = `S${suffix.slice(0, 7).toUpperCase()}`;
    const r = await get(`/api/v1/public/invites/${code.toLowerCase()}/share-preview`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ code, inviterName: "Nova Brand", inviteeRewardCents: 1000 });
    const [row] = await db.select({ clicks: users.inviteLinkClicks }).from(users).where(inArray(users.clerkId, [seller]));
    expect(row.clicks).toBe(0);
  });

  it("keeps private accounts anonymous and 404s suspended or unknown codes", async () => {
    const priv = await get(`/api/v1/public/invites/P${suffix.slice(0, 7).toUpperCase()}/share-preview`);
    expect(priv.body.inviterName).toBeNull();
    expect((await get(`/api/v1/public/invites/X${suffix.slice(0, 7).toUpperCase()}/share-preview`)).status).toBe(404);
    expect((await get("/api/v1/public/invites/ZZZZZZZZ/share-preview")).status).toBe(404);
    expect((await get("/api/v1/public/invites/bad!code/share-preview")).status).toBe(404);
  });
});
