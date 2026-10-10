/**
 * Store website (brandthread.app/@handle) + the Design editor's fields on
 * /api/growth/bio (migration 275).
 *
 * Covers: every seller with a username has a site before saving anything,
 * case-insensitive handles redirect to the lowercase URL, buyers / unknown /
 * switched-off stores 404, products (active only, featured first, prices),
 * product page Buy link, link buttons capped at five and click-tracked, the
 * preview card, design validation, and the older link-in-bio screen's
 * light/dark save not undoing a site theme.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import sharp from "sharp";
import { db, users, products, productVariants, bioPages, bioLinks, bioEvents } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(5).toString("hex");
const seller = `site-seller-${suffix}`;
const fresh = `site-fresh-${suffix}`;
const buyer = `site-buyer-${suffix}`;
const handle = `maison${suffix}`;
const freshHandle = `fresh${suffix}`;
const buyerHandle = `buyer${suffix}`;
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const authState = vi.hoisted(() => ({ clerkUserId: null as string | null }));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: authState.clerkUserId }) }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!authState.clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = authState.clerkUserId;
    next();
  },
  requirePlan: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let server: Server;
let base = "";
const productIds: Record<string, string> = {};

async function api(method: string, path: string, body?: unknown, as: string | null = seller) {
  authState.clerkUserId = as;
  const res = await fetch(`${base}/api/growth${path}`, {
    method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const get = (path: string, ua = CHROME) => fetch(`${base}${path}`, { redirect: "manual", headers: { "user-agent": ua } });

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@test.local`, name: "Seller", brandName: "Maison Noir", username: handle, bio: "Profile bio", role: "seller", accountType: "seller", socialLinks: { instagram: "maison.noir" } },
    { clerkId: fresh, email: `${fresh}@test.local`, name: "Fresh", displayName: "Fresh Label", username: freshHandle, role: "seller", accountType: "seller" },
    { clerkId: buyer, email: `${buyer}@test.local`, name: "Buyer", username: buyerHandle, role: "buyer", accountType: "buyer" },
  ]);
  const rows = await db.insert(products).values([
    { ownerId: seller, name: "Old tee", status: "active", images: ["https://cdn.test/old.jpg"], createdAt: new Date(Date.now() - 86_400_000) },
    { ownerId: seller, name: "New knit", status: "active", images: ["https://cdn.test/knit.jpg"], description: "Merino" },
    { ownerId: seller, name: "Draft hoodie", status: "draft", images: [] },
    { ownerId: seller, name: "Deleted cap", status: "active", images: [], deletedAt: new Date() },
    { ownerId: fresh, name: "Fresh tee", status: "active", images: [] },
  ]).returning({ id: products.id, name: products.name });
  for (const r of rows) productIds[r.name] = r.id;
  await db.insert(productVariants).values([
    { productId: productIds["New knit"], sku: `ST-${suffix}-1`, size: "M", color: "Black", priceCents: 12000, stock: 3 },
    { productId: productIds["New knit"], sku: `ST-${suffix}-2`, size: "L", color: "Black", priceCents: 9900, stock: 3 },
  ]);

  const { default: growthRouter } = await import("../growth");
  const site = await import("../storeSite");
  const app = express();
  app.use(express.json());
  app.set("trust proxy", 1);
  app.use("/api/growth", growthRouter);
  app.get("/@:handle", site.storeSiteHandler);
  app.get("/@:handle/p/:productId", site.storeSiteProductHandler);
  app.get("/@:handle/go/:linkId", site.storeSiteLinkRedirect);
  app.get("/@:handle/og.png", site.storeSiteOgHandler);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const ids = [seller, fresh, buyer];
  await db.delete(bioEvents).where(inArray(bioEvents.sellerId, ids));
  await db.delete(bioLinks).where(inArray(bioLinks.sellerId, ids));
  await db.delete(bioPages).where(inArray(bioPages.sellerId, ids));
  await db.delete(productVariants).where(inArray(productVariants.productId, Object.values(productIds)));
  await db.delete(products).where(inArray(products.ownerId, ids));
  await db.delete(users).where(inArray(users.clerkId, ids));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("store website", () => {
  it("works for a seller who never opened the editor (profile name, bio, socials, products)", async () => {
    const res = await get(`/@${freshHandle}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Fresh Label</title>");
    expect(html).toContain("Fresh tee");
    expect(html).toContain("Powered by");

    const main = await (await get(`/@${handle}`)).text();
    expect(main).toContain("<title>Maison Noir</title>");
    expect(main).toContain("Profile bio");
    expect(main).toContain('href="https://www.instagram.com/maison.noir"');
  });

  it("redirects mixed-case handles to the lowercase link", async () => {
    const res = await get(`/@${handle.toUpperCase()}`);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`/@${handle}`);
  });

  it("404s unknown handles, buyers and malformed handles", async () => {
    expect((await get(`/@nobody${suffix}`)).status).toBe(404);
    expect((await get(`/@${buyerHandle}`)).status).toBe(404);
    expect((await get("/@a")).status).toBe(404);
  });

  it("lists active products only, featured first, newest next, with the lowest price", async () => {
    let html = await (await get(`/@${handle}`)).text();
    expect(html.indexOf("New knit")).toBeLessThan(html.indexOf("Old tee"));
    expect(html).toContain("$99.00");
    expect(html).not.toContain("Draft hoodie");
    expect(html).not.toContain("Deleted cap");
    expect(html).not.toContain("Fresh tee");
    expect((await api("PUT", "/bio", { featuredProductIds: [productIds["Old tee"]] })).status).toBe(200);
    html = await (await get(`/@${handle}`)).text();
    expect(html.indexOf("Old tee")).toBeLessThan(html.indexOf("New knit"));
  });

  it("product page has Buy → web checkout, or the app on Android", async () => {
    const id = productIds["New knit"];
    const res = await get(`/@${handle}/p/${id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>New knit</h1>");
    expect(html).toContain("Merino");
    expect(html).toMatch(new RegExp(`class="btn buy" href="[^"]*/store/product/${id}\\?utm_source=brandthread_site`));
    const android = await (await get(`/@${handle}/p/${id}`, "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126")).text();
    expect(android).toContain(`href="intent://store/product/${id}#Intent;scheme=brandthread;package=com.brandthread.mobile;`);
    // another store's product, drafts and deleted products don't open under this handle
    expect((await get(`/@${handle}/p/${productIds["Fresh tee"]}`)).status).toBe(404);
    expect((await get(`/@${handle}/p/${productIds["Draft hoodie"]}`)).status).toBe(404);
    expect((await get(`/@${handle}/p/not-a-uuid`)).status).toBe(404);
  });

  it("caps link buttons at five and tracks clicks through /go", async () => {
    for (let i = 1; i <= 5; i++) expect((await api("POST", "/bio/links", { title: `Link ${i}`, url: `https://l${i}.test` })).status).toBe(201);
    expect((await api("POST", "/bio/links", { title: "Six", url: "https://six.test" })).status).toBe(409);
    const page = await api("GET", "/bio");
    const first = page.body.links[0];
    const html = await (await get(`/@${handle}`)).text();
    expect(html).toContain(`href="/@${handle}/go/${first.id}"`);
    expect(html).not.toContain("l1.test");
    const go = await get(`/@${handle}/go/${first.id}`);
    expect(go.status).toBe(302);
    expect(go.headers.get("location")).toBe("https://l1.test/");
    const clicks = await db.select().from(bioEvents).where(eq(bioEvents.bioLinkId, first.id));
    expect(clicks).toHaveLength(1);
    // a link id from another seller can't be used under this handle
    expect((await get(`/@${freshHandle}/go/${first.id}`)).status).toBe(404);
  });

  it("serves a 1200×630 preview card", async () => {
    const res = await get(`/@${handle}/og.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 630]);
    expect((await get(`/@nobody${suffix}/og.png`)).status).toBe(404);
  });
});

describe("Design editor fields on /api/growth/bio", () => {
  it("returns the site link, themes, fonts and current design", async () => {
    const r = await api("GET", "/bio");
    expect(r.status).toBe(200);
    expect(r.body.siteUrl).toMatch(new RegExp(`/@${handle}$`));
    expect(r.body.url).toBe(r.body.siteUrl);
    expect(r.body.username).toBe(handle);
    expect(r.body.siteTheme).toBe("black");
    expect(r.body.buttonStyle).toBe("rounded");
    expect(r.body.font).toBe("system");
    expect(r.body.showBanner).toBe(true);
    expect(r.body.themes.map((t: any) => t.key)).toContain("silver");
    expect(r.body.fonts.map((f: any) => f.key)).toEqual(["system", "serif", "mono"]);
  });

  it("saves and validates theme, buttons, font and banner", async () => {
    expect((await api("PUT", "/bio", { siteTheme: "hotpink" })).status).toBe(400);
    expect((await api("PUT", "/bio", { buttonStyle: "pill" })).status).toBe(400);
    expect((await api("PUT", "/bio", { font: "comic" })).status).toBe(400);
    const r = await api("PUT", "/bio", { siteTheme: "silver", buttonStyle: "square", font: "mono", showBanner: false, displayName: "Maison", bio: "Knitwear" });
    expect(r.status).toBe(200);
    expect([r.body.siteTheme, r.body.buttonStyle, r.body.font, r.body.showBanner]).toEqual(["silver", "square", "mono", false]);
    const html = await (await get(`/@${handle}`)).text();
    expect(html).toContain("background:#D1D1D6");
    expect(html).toContain("ui-monospace");
    expect(html).toMatch(/\.btn\{[^}]*border-radius:0;/);
    expect(html).toContain("<title>Maison</title>");
  });

  it("the older link-in-bio screen's light/dark save keeps a site theme of the same lightness", async () => {
    expect((await api("PUT", "/bio", { theme: "mono", bio: "Still knitwear" })).body.siteTheme).toBe("silver");
    expect((await api("PUT", "/bio", { theme: "dark" })).body.siteTheme).toBe("black");
  });

  it("switching the page off takes the site down", async () => {
    await api("PUT", "/bio", { published: false });
    expect((await get(`/@${handle}`)).status).toBe(404);
    expect((await get(`/@${handle}/p/${productIds["New knit"]}`)).status).toBe(404);
    await api("PUT", "/bio", { published: true });
    expect((await get(`/@${handle}`)).status).toBe(200);
  });

  it("buyers get no site link", async () => {
    const r = await api("GET", "/bio", undefined, buyer);
    expect(r.body.siteUrl).toBeNull();
  });
});
