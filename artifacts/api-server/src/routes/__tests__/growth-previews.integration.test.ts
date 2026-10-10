/**
 * Share previews and public media for growth links (BT-304/314/319/320).
 * Real routers + Postgres; object signing is stubbed.
 */
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { bioPages, db, giveaways, liveStreams, productVariants, products, storefronts, users } from "@workspace/db";

vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: any, _res: any, next: () => void) => next(),
}));

const { default: sharePreviewRouter } = await import("../share-preview");
const { default: publicMediaRouter, setPublicMediaStorageForTests } = await import("../public-media");
const { giveawayLanding } = await import("../giveawayLanding");
const { bioPageHandler } = await import("../growthPublic");

const sfx = crypto.randomBytes(4).toString("hex");
const seller = `gp-seller-${sfx}`;
const plain = `gp-plain-${sfx}`;
const sellerName = `gpshop_${sfx}`;
const plainName = `gpplain_${sfx}`;
let productId = "";
let draftId = "";
let streamId = "";
let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@example.test`, name: "Seller", username: sellerName, accountType: "seller", brandName: "Northline", bio: "Small-batch knitwear.", profileImageUrl: "https://cdn.example.test/northline.png", onboardingComplete: true },
    { clerkId: plain, email: `${plain}@example.test`, name: "Plain", username: plainName, accountType: "seller", displayName: "Plain Goods", onboardingComplete: true },
  ]);
  const [p] = await db.insert(products).values({ ownerId: seller, name: "Aurora Hoodie", status: "active", images: ["/objects/uploads/aurora", "https://cdn.example.test/aurora-2.jpg"] }).returning();
  productId = p.id;
  const [d] = await db.insert(products).values({ ownerId: seller, name: "Secret", status: "draft", images: ["/objects/uploads/secret"] }).returning();
  draftId = d.id;
  await db.insert(productVariants).values([
    { productId, sku: `gp-${sfx}-a`, priceCents: 5200 },
    { productId, sku: `gp-${sfx}-b`, priceCents: 4500 },
  ]);
  await db.insert(storefronts).values({ ownerId: seller, slug: `store-${sfx}`, title: "Northline Store", status: "published" });
  const [s] = await db.insert(liveStreams).values({ sellerId: seller, channelName: `gp-${sfx}`, title: "Fall drop", status: "live" }).returning();
  streamId = s.id;
  await db.insert(giveaways).values({
    sellerId: seller, shareCode: `GP${sfx.toUpperCase()}`.slice(0, 10), title: "Win a hoodie", prizeText: "Aurora Hoodie",
    productId, startsAt: new Date(Date.now() - 3600_000), endsAt: new Date(Date.now() + 86_400_000), rulesText: "Rules",
  });
  await db.insert(bioPages).values({ sellerId: seller, slug: `gp-${sfx}`, displayName: "Northline", published: true, featuredProductIds: [productId] });

  setPublicMediaStorageForTests({ getObjectEntityDownloadURL: async (p: string) => `https://storage.example.test${p}?sig=1` });
  const app = express();
  app.use("/api/v1/public", sharePreviewRouter);
  app.use("/api/v1/public", publicMediaRouter);
  app.get("/g/:code", giveawayLanding);
  app.get("/bio/:slug", bioPageHandler);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(bioPages).where(eq(bioPages.sellerId, seller));
  await db.delete(giveaways).where(eq(giveaways.sellerId, seller));
  await db.delete(liveStreams).where(eq(liveStreams.sellerId, seller));
  await db.delete(storefronts).where(eq(storefronts.ownerId, seller));
  await db.delete(products).where(eq(products.ownerId, seller));
  await db.delete(users).where(inArray(users.clerkId, [seller, plain]));
  await new Promise((resolve) => server.close(resolve));
});

const json = async (path: string) => {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: r.status === 200 ? await r.json() as any : null };
};

describe("store share preview resolves the Share Store username (BT-304)", () => {
  it("uses the published storefront for a seller username, any case", async () => {
    const r = await json(`/api/v1/public/stores/${sellerName.toUpperCase()}/share-preview`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ slug: sellerName, name: "Northline Store", imageUrl: "https://cdn.example.test/northline.png" });
  });
  it("never 404s a seller with no storefront", async () => {
    const r = await json(`/api/v1/public/stores/${plainName}/share-preview`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ slug: plainName, name: "Plain Goods" });
  });
  it("still resolves a storefront slug, and 404s unknown names", async () => {
    expect((await json(`/api/v1/public/stores/store-${sfx}/share-preview`)).body.name).toBe("Northline Store");
    expect((await json(`/api/v1/public/stores/nobody-${sfx}/share-preview`)).status).toBe(404);
  });
});

describe("public product photos (BT-314)", () => {
  it("returns an absolute https cover and the lowest price", async () => {
    const r = await json(`/api/v1/public/products/${productId}/share-preview`);
    expect(r.body.priceCents).toBe(4500);
    expect(r.body.sellerName).toBe("Northline");
    expect(r.body.imageUrl).toMatch(new RegExp(`^https://.+/api/v1/public/media/products/${productId}/0$`));
  });
  it("redirects the media URL to a signed object URL, or the stored https URL", async () => {
    const a = await fetch(`${base}/api/v1/public/media/products/${productId}/0`, { redirect: "manual" });
    expect(a.status).toBe(302);
    expect(a.headers.get("location")).toBe("https://storage.example.test/objects/uploads/aurora?sig=1");
    const b = await fetch(`${base}/api/v1/public/media/products/${productId}/1`, { redirect: "manual" });
    expect(b.headers.get("location")).toBe("https://cdn.example.test/aurora-2.jpg");
  });
  it("never serves a draft product's photo or an index that isn't there", async () => {
    expect((await fetch(`${base}/api/v1/public/media/products/${draftId}/0`, { redirect: "manual" })).status).toBe(404);
    expect((await fetch(`${base}/api/v1/public/media/products/${productId}/5`, { redirect: "manual" })).status).toBe(404);
    expect((await fetch(`${base}/api/v1/public/media/products/not-a-uuid/0`, { redirect: "manual" })).status).toBe(404);
    expect((await json(`/api/v1/public/products/${draftId}/share-preview`)).status).toBe(404);
  });
  it("puts the public photo on bio page tiles", async () => {
    const html = await (await fetch(`${base}/bio/gp-${sfx}`)).text();
    expect(html).toContain(`/api/v1/public/media/products/${productId}/0`);
    expect(html).not.toContain("/objects/uploads/aurora\"");
  });
});

describe("live and giveaway cards (BT-319/320)", () => {
  it("describes a live stream", async () => {
    const r = await json(`/api/v1/public/live/${streamId}/share-preview`);
    expect(r.body).toEqual({ hostName: "Northline", title: "Fall drop", live: true, imageUrl: "https://cdn.example.test/northline.png" });
  });
  it("gives the giveaway landing a photo and a way in without the app", async () => {
    vi.stubEnv("APP_STORE_URL", "https://apps.apple.com/app/id000000000");
    const code = `GP${sfx.toUpperCase()}`.slice(0, 10);
    const html = await (await fetch(`${base}/g/${code}`)).text();
    vi.unstubAllEnvs();
    expect(html).toContain(`og:image" content="`);
    expect(html).toContain(`/api/v1/public/media/products/${productId}/0`);
    expect(html).toContain('twitter:card" content="summary_large_image"');
    expect(html).toContain(`/giveaway?code=${code}">Enter giveaway</a>`);
    expect(html).toContain("https://apps.apple.com/app/id000000000");
  });
  it("leaves the store buttons out until the store URLs are set", async () => {
    const code = `GP${sfx.toUpperCase()}`.slice(0, 10);
    const html = await (await fetch(`${base}/g/${code}`)).text();
    expect(html).not.toContain("App Store");
    expect(html).not.toContain("Google Play");
  });
});

describe("sitemap (BT-315)", () => {
  it("lists static pages, seller profiles and public products, never drafts", async () => {
    const { renderSitemap, sitemapEntries } = await import("../sitemap");
    const xml = renderSitemap(await sitemapEntries());
    expect(xml).toContain("<loc>https://brandthread.app/privacy</loc>");
    expect(xml).toContain(`<loc>https://brandthread.app/u/${sellerName}</loc>`);
    expect(xml).toContain(`<loc>https://brandthread.app/store/product/${productId}</loc>`);
    expect(xml).not.toContain(draftId);
    expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });
  it("escapes XML", async () => {
    const { renderSitemap } = await import("../sitemap");
    expect(renderSitemap([{ path: "/a?b=1&c=2" }])).toContain("<loc>https://brandthread.app/a?b=1&amp;c=2</loc>");
  });
});
