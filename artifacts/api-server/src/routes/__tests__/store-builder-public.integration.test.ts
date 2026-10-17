/**
 * Store Builder collections / pages / navigation saved via PUT /api/store
 * appear on the live store (GET /site/:slug HTML and GET /public/:slug JSON):
 * published items only, and collection products resolve to the seller's own
 * real products — never another seller's.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, products, productVariants, storefronts } from "@workspace/db";

const suffix = crypto.randomBytes(4).toString("hex");
const OWNER = `sbp-owner-${suffix}`;
const OTHER = `sbp-other-${suffix}`;
const SLUG = `sbp-${suffix}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    // Simulate a signed-out visitor so public routes can be checked for auth ordering.
    if (req.headers["x-test-signed-out"]) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = OWNER; next();
  },
}));

let server: Server;
let base = "";
let mine = "";
let theirs = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/store${path}`, {
    method, headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, text, json };
}

beforeAll(async () => {
  const [a] = await db.insert(products).values({ ownerId: OWNER, name: `Mine Hoodie ${suffix}`, status: "active" }).returning({ id: products.id });
  const [b] = await db.insert(products).values({ ownerId: OTHER, name: `Theirs Tee ${suffix}`, status: "active" }).returning({ id: products.id });
  mine = a.id; theirs = b.id;
  await db.insert(productVariants).values([
    { productId: mine, sku: `SBP-A-${suffix}`, priceCents: 5500, stock: 3 },
    { productId: theirs, sku: `SBP-B-${suffix}`, priceCents: 1000, stock: 3 },
  ]);
  await db.insert(storefronts).values({ ownerId: OWNER, slug: SLUG, title: "Builder Store", status: "published" });

  const { default: storeRouter } = await import("../store");
  const app = express();
  app.use(express.json());
  app.use("/api/store", storeRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(storefronts).where(eq(storefronts.ownerId, OWNER));
  await db.delete(products).where(inArray(products.id, [mine, theirs].filter(Boolean)));
  await new Promise<void>((r) => server.close(() => r()));
});

describe("builder state on the live store", () => {
  it("renders published collections (own products only), pages and menus", async () => {
    const put = await call("PUT", "/", {
      collections: [
        { id: "c1", type: "manual", name: "Winter Edit", description: "Cold days.", handle: "winter-edit",
          productIds: [mine, theirs], productOrder: "manual", conditions: [], conditionMatch: "all", status: "active" },
        { id: "c2", type: "manual", name: "Secret Draft", handle: "secret", productIds: [mine], status: "draft" },
      ],
      pages: [
        { id: "p1", type: "about", title: "About Us", slug: "about", content: "Made in Brooklyn.", status: "published" },
        { id: "p2", type: "faq", title: "Unfinished FAQ", slug: "faq", content: "TBD", status: "draft" },
      ],
      navigation: [
        { id: "m1", type: "main", name: "Main Menu", items: [
          { id: "i1", label: "Shop Winter", target: "collection", targetId: "Winter Edit", visible: true, order: 0, children: [] },
          { id: "i2", label: "Our Story", target: "page", targetId: "about", visible: true, order: 1, children: [] },
        ] },
        { id: "m2", type: "footer", name: "Footer Menu", items: [
          { id: "i3", label: "Instagram", target: "external", url: "https://instagram.com/builder", visible: true, order: 0, children: [] },
        ] },
      ],
    });
    expect(put.status).toBe(200);

    const site = await call("GET", `/site/${SLUG}`);
    expect(site.status).toBe(200);
    expect(site.text).toContain("Winter Edit");
    expect(site.text).toContain(`Mine Hoodie ${suffix}`);
    expect(site.text).not.toContain(`Theirs Tee ${suffix}`);
    expect(site.text).not.toContain("Secret Draft");
    expect(site.text).toContain('id="page-about"');
    expect(site.text).toContain("Made in Brooklyn.");
    expect(site.text).not.toContain("Unfinished FAQ");
    expect(site.text).toContain('<a href="#collection-winter-edit">Shop Winter</a>');
    expect(site.text).toContain('<a href="#page-about">Our Story</a>');
    expect(site.text).toContain("https://instagram.com/builder");

    const pub = await call("GET", `/public/${SLUG}`);
    expect(pub.status).toBe(200);
    expect(pub.json.collections).toHaveLength(1);
    expect(pub.json.collections[0].products.map((p: any) => p.id)).toEqual([mine]);
    expect(pub.json.pages.map((p: any) => p.slug)).toEqual(["about"]);
    expect(pub.json.navigation.map((m: any) => m.type)).toEqual(["main", "footer"]);
  });

  it("keeps the default nav when no menu is set", async () => {
    await call("PUT", "/", { collections: [], pages: [], navigation: [] });
    const site = await call("GET", `/site/${SLUG}`);
    expect(site.text).toContain('<a href="#">Shop</a>');
  });

  it("serves GET /public/:slug to signed-out visitors (registered before requireAuth)", async () => {
    const res = await fetch(`${base}/api/store/public/${SLUG}`, { headers: { "x-test-signed-out": "1" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.slug).toBe(SLUG);
    expect(body.storePasswordHash).toBeUndefined();
    const owner = await fetch(`${base}/api/store`, { headers: { "x-test-signed-out": "1" } });
    expect(owner.status).toBe(401);
  });
});
