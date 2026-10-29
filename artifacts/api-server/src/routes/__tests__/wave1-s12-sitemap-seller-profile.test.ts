/**
 * Wave 1 / s12:
 *  - sitemap.xml must leave out products the seller hid from search engines
 *    (product_seo.no_index) and scheduled products before their launch, the
 *    same rules as routes/seo-public.ts.
 *  - PUT /api/seller/profile/store-layout for an account with no users row is
 *    a 404, not a 200 with an empty body.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, productLaunches, productSeo, products, users } from "@workspace/db";

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `wave1-s12-sitemap-${suffix}`;
const auth = vi.hoisted(() => ({ clerkUserId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = auth.clerkUserId; next(); },
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) { return `https://storage.test${path}`; }
  },
}));

const ids = { visible: "", hidden: "", scheduled: "", launched: "" };
let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values({
    clerkId: sellerId, email: `${sellerId}@test.local`, name: "Sitemap Seller",
    role: "seller", accountType: "seller", username: `s12map${suffix}`,
  });
  const rows = await db.insert(products).values(
    ["visible", "hidden", "scheduled", "launched"].map((name) => ({
      ownerId: sellerId, name: `S12 ${name} ${suffix}`, category: "apparel", status: "active",
    })),
  ).returning({ id: products.id, name: products.name });
  for (const row of rows) ids[row.name.split(" ")[1] as keyof typeof ids] = row.id;
  await db.insert(productSeo).values({ productId: ids.hidden, ownerId: sellerId, noIndex: true });
  await db.insert(productLaunches).values([
    { productId: ids.scheduled, launchAt: new Date(Date.now() + 7 * 86_400_000) },
    { productId: ids.launched, launchAt: new Date(Date.now() - 86_400_000) },
  ]);

  const { default: profileRouter } = await import("../seller-profile");
  const app = express();
  app.use(express.json());
  app.use("/api/seller", profileRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const all = Object.values(ids).filter(Boolean);
  if (all.length) await db.delete(products).where(inArray(products.id, all));
  await db.delete(users).where(eq(users.clerkId, sellerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("sitemap.xml product rules", () => {
  it("omits no_index and not-yet-launched products", async () => {
    const { sitemapEntries } = await import("../sitemap");
    const paths = new Set((await sitemapEntries()).map((e) => e.path));
    expect(paths.has(`/store/product/${ids.visible}`)).toBe(true);
    expect(paths.has(`/store/product/${ids.launched}`)).toBe(true);
    expect(paths.has(`/store/product/${ids.hidden}`)).toBe(false);
    expect(paths.has(`/store/product/${ids.scheduled}`)).toBe(false);
  });
});

describe("PUT /api/seller/profile/store-layout", () => {
  it("404s when the caller has no profile row", async () => {
    auth.clerkUserId = `wave1-s12-missing-${suffix}`;
    const res = await fetch(`${base}/api/seller/profile/store-layout`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ layout: "grid" }),
    });
    expect(res.status).toBe(404);
  });

  it("still saves the layout for an existing seller", async () => {
    auth.clerkUserId = sellerId;
    const res = await fetch(`${base}/api/seller/profile/store-layout`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ layout: "lookbook" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ storeLayout: "lookbook" });
  });
});
