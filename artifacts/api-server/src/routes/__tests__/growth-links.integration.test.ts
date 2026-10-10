/**
 * Growth links (migration 122): tracked UTM links, link-in-bio, store pixels.
 *
 * Covers: short-link redirect + UTM + click log (bots filtered, repeat clicks
 * rate-limited, no IP stored), seller isolation, revenue/orders attribution
 * without touching the orders table, bio page render + click tracking, auth on
 * every editor endpoint, team-permission gating and pixel injection on the
 * public store site (validated IDs only, honours Sec-GPC / DNT).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import {
  db, users, products, productVariants, orders, storefronts, teamMembers, trackedLinks, linkClicks, checkoutAttributions,
  bioPages, bioLinks, bioEvents, storePixels,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(5).toString("hex");
const sellerA = `growth-seller-a-${suffix}`;
const sellerB = `growth-seller-b-${suffix}`;
const viewer = `growth-viewer-${suffix}`;
const usernameA = `growtha${suffix}`;
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
let productA = "";
let productB = "";
let storeSlug = "";
let teamRowId = "";
const orderIds: string[] = [];

const H = (ua = CHROME, extra: Record<string, string> = {}) => ({ "user-agent": ua, ...extra });
async function api(method: string, path: string, body?: unknown, as: string | null = sellerA) {
  authState.clerkUserId = as;
  const res = await fetch(`${base}/api/growth${path}`, {
    method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const get = (path: string, headers: Record<string, string> = H()) => fetch(`${base}${path}`, { redirect: "manual", headers });

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: sellerA, email: `${sellerA}@test.local`, name: "Seller A", displayName: "Acme Studio", username: usernameA, bio: "Profile bio", role: "seller", accountType: "seller" },
    { clerkId: sellerB, email: `${sellerB}@test.local`, name: "Seller B", displayName: "Other Brand", role: "seller", accountType: "seller" },
    { clerkId: viewer, email: `${viewer}@test.local`, name: "Viewer", role: "seller", accountType: "seller" },
  ]);
  await db.insert(teamMembers).values({ ownerId: sellerA, memberClerkId: viewer, email: `${viewer}@test.local`, role: "viewer", status: "active" });
  const [pa] = await db.insert(products).values({ ownerId: sellerA, name: "Tee A", status: "active", images: ["https://cdn.test/tee.jpg"] }).returning({ id: products.id });
  const [pb] = await db.insert(products).values({ ownerId: sellerB, name: "Tee B", status: "active" }).returning({ id: products.id });
  productA = pa.id; productB = pb.id;
  await db.insert(productVariants).values({ productId: productA, sku: `GR-${suffix}`, size: "M", color: "Black", priceCents: 4500, stock: 5 });
  storeSlug = `growth-${suffix}`;
  await db.insert(storefronts).values({ ownerId: sellerA, slug: storeSlug, title: "Acme Store", status: "published" });

  const { default: growthRouter } = await import("../growth");
  const { default: storeRouter } = await import("../store");
  const pub = await import("../growthPublic");
  const app = express();
  app.use(express.json());
  app.set("trust proxy", 1);
  app.use("/api/growth", growthRouter);
  app.use("/api/store", storeRouter);
  app.get("/l/:code", pub.trackedLinkRedirect);
  app.get("/bio/:slug", pub.bioPageHandler);
  app.get("/bio/:slug/go/:linkId", pub.bioLinkRedirect);
  app.get("/bio/:slug/shop", pub.bioShopRedirect);
  app.get("/bio/:slug/p/:productId", pub.bioProductRedirect);
  const site = await import("../storeSite");
  app.get("/@:handle", site.storeSiteHandler);
  app.get("/@:handle/p/:productId", site.storeSiteProductHandler);
  app.get("/@:handle/go/:linkId", site.storeSiteLinkRedirect);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const sellers = [sellerA, sellerB];
  await db.delete(checkoutAttributions).where(inArray(checkoutAttributions.sellerId, sellers));
  await db.delete(linkClicks).where(inArray(linkClicks.sellerId, sellers));
  await db.delete(trackedLinks).where(inArray(trackedLinks.sellerId, sellers));
  await db.delete(bioEvents).where(inArray(bioEvents.sellerId, sellers));
  await db.delete(bioLinks).where(inArray(bioLinks.sellerId, sellers));
  await db.delete(bioPages).where(inArray(bioPages.sellerId, sellers));
  await db.delete(storePixels).where(inArray(storePixels.sellerId, sellers));
  if (orderIds.length) await db.delete(orders).where(inArray(orders.id, orderIds));
  await db.delete(storefronts).where(inArray(storefronts.ownerId, sellers));
  await db.delete(teamMembers).where(eq(teamMembers.ownerId, sellerA));
  await db.delete(productVariants).where(inArray(productVariants.productId, [productA, productB]));
  await db.delete(products).where(inArray(products.id, [productA, productB]));
  await db.delete(users).where(inArray(users.clerkId, [sellerA, sellerB, viewer]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("auth on editor endpoints", () => {
  it.each([
    ["GET", "/links"], ["POST", "/links"], ["GET", "/links/00000000-0000-4000-8000-000000000000"],
    ["PATCH", "/links/00000000-0000-4000-8000-000000000000"], ["DELETE", "/links/00000000-0000-4000-8000-000000000000"],
    ["GET", "/destinations"], ["GET", "/bio"], ["PUT", "/bio"], ["POST", "/bio/links"], ["PUT", "/bio/links/order"],
    ["PATCH", "/bio/links/00000000-0000-4000-8000-000000000000"], ["DELETE", "/bio/links/00000000-0000-4000-8000-000000000000"],
    ["GET", "/bio/stats"], ["GET", "/pixels"], ["PUT", "/pixels"],
  ])("%s %s rejects signed-out callers", async (method, path) => {
    const r = await api(method, path, method === "GET" || method === "DELETE" ? undefined : {}, null);
    expect(r.status).toBe(401);
  });

  it("a read-only team role cannot create links, save the bio or set pixels", async () => {
    const create = await api("POST", "/links", { destinationType: "store", utmSource: "a", utmMedium: "b" }, viewer);
    expect(create.status).toBe(403);
    expect((await api("PUT", "/bio", { displayName: "x" }, viewer)).status).toBe(403);
    expect((await api("PUT", "/pixels", { metaPixelId: "1234567890123456" }, viewer)).status).toBe(403);
    // ...but can read (analytics permission) the owner's links
    expect((await api("GET", "/links", undefined, viewer)).status).toBe(200);
  });
});

describe("tracked links", () => {
  let linkId = "";
  let code = "";

  it("creates a link with sanitised UTM fields and a unique short code", async () => {
    const r = await api("POST", "/links", { label: "IG bio", destinationType: "store", utmSource: "Instagram", utmMedium: "Social", utmCampaign: "Launch Week!" });
    expect(r.status).toBe(201);
    linkId = r.body.id; code = r.body.code;
    expect(code).toMatch(/^[a-z2-9]{8}$/);
    expect(r.body.utmCampaign).toBe("launch-week");
    expect(r.body.url).toContain(`/l/${code}`);
    const second = await api("POST", "/links", { destinationType: "store", utmSource: "tiktok", utmMedium: "social" });
    expect(second.body.code).not.toBe(code);
  });

  it("validates input and ownership of the destination", async () => {
    expect((await api("POST", "/links", { destinationType: "store", utmMedium: "x" })).status).toBe(400);
    expect((await api("POST", "/links", { destinationType: "product", destinationRef: "nope", utmSource: "a", utmMedium: "b" })).status).toBe(400);
    // seller A cannot point a link at seller B's product
    expect((await api("POST", "/links", { destinationType: "product", destinationRef: productB, utmSource: "a", utmMedium: "b" })).status).toBe(404);
    expect((await api("POST", "/links", { destinationType: "product", destinationRef: productA, utmSource: "a", utmMedium: "b" })).status).toBe(201);
    // bio destination needs a published bio page first
    expect((await api("POST", "/links", { destinationType: "bio", utmSource: "a", utmMedium: "b" })).status).toBe(409);
  });

  it("302s to the published store with UTM params and the link code, and logs a coarse click", async () => {
    const res = await get(`/l/${code}`, H(CHROME, { referer: "https://www.instagram.com/some/path?secret=1", "cf-ipcountry": "de" }));
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    // One store link: the store website, even when an older web store is published.
    expect(loc.pathname).toBe(`/@${usernameA}`);
    expect(loc.searchParams.get("utm_source")).toBe("instagram");
    expect(loc.searchParams.get("utm_medium")).toBe("social");
    expect(loc.searchParams.get("utm_campaign")).toBe("launch-week");
    expect(loc.searchParams.get("bt_lc")).toBe(code);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const clicks = await db.select().from(linkClicks).where(eq(linkClicks.linkId, linkId));
    expect(clicks).toHaveLength(1);
    expect(clicks[0].country).toBe("DE");
    expect(clicks[0].referrerHost).toBe("instagram.com");
    // Nothing that could be an IP address or a full URL is stored on the row.
    expect(Object.keys(clicks[0]).sort()).toEqual(["country", "createdAt", "id", "linkId", "referrerHost", "sellerId"]);
    expect(JSON.stringify(clicks[0])).not.toMatch(/127\.0\.0\.1|secret/);
  });

  it("still redirects but does not count bots / prefetches, and rate-limits repeat clicks", async () => {
    const before = (await db.select().from(linkClicks).where(eq(linkClicks.linkId, linkId))).length;
    for (const headers of [H("Googlebot/2.1 (+http://www.google.com/bot.html)"), H("facebookexternalhit/1.1"), H(CHROME, { purpose: "prefetch" }), H("")]) {
      const r = await get(`/l/${code}`, headers);
      expect(r.status).toBe(302);
    }
    expect((await db.select().from(linkClicks).where(eq(linkClicks.linkId, linkId))).length).toBe(before);

    const ua = `${CHROME} RepeatVisitor/${suffix}`;
    for (let i = 0; i < 6; i++) expect((await get(`/l/${code}`, H(ua))).status).toBe(302);
    const after = (await db.select().from(linkClicks).where(eq(linkClicks.linkId, linkId))).length;
    expect(after - before).toBe(3); // max 3 counted per visitor per window
  });

  it("404s unknown, malformed and archived codes", async () => {
    expect((await get("/l/zzzzzzzz")).status).toBe(404);
    expect((await get("/l/bad!")).status).toBe(404);
    const tmp = await api("POST", "/links", { destinationType: "store", utmSource: "x", utmMedium: "y" });
    expect((await api("DELETE", `/links/${tmp.body.id}`)).status).toBe(204);
    expect((await get(`/l/${tmp.body.code}`)).status).toBe(404);
  });

  it("product links redirect to the product URL", async () => {
    const r = await api("POST", "/links", { destinationType: "product", destinationRef: productA, utmSource: "email", utmMedium: "email" });
    const res = await get(`/l/${r.body.code}`);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe(`/store/product/${productA}`);
    expect(loc.searchParams.get("utm_source")).toBe("email");
  });

  it("seller isolation: another seller cannot see, read, edit or archive the link", async () => {
    expect((await api("GET", "/links", undefined, sellerB)).body.some((l: any) => l.id === linkId)).toBe(false);
    expect((await api("GET", `/links/${linkId}`, undefined, sellerB)).status).toBe(404);
    expect((await api("PATCH", `/links/${linkId}`, { label: "hijack" }, sellerB)).status).toBe(404);
    expect((await api("DELETE", `/links/${linkId}`, undefined, sellerB)).status).toBe(404);
    expect((await api("GET", `/links/${linkId}`)).body.label).toBe("IG bio");
  });

  it("attributes orders and revenue to the link without altering the orders table", async () => {
    const { recordCheckoutAttribution } = await import("../../lib/growth/attribution");
    const stripeA = `cs_test_a_${suffix}`, stripeC = `cs_test_c_${suffix}`, stripeX = `cs_test_x_${suffix}`;
    const inserted = await db.insert(orders).values([
      { ownerId: sellerA, orderNumber: `G-${suffix}-1`, status: "processing", totalCents: 6000, subtotalCents: 6000, stripeCheckoutSessionId: stripeA },
      { ownerId: sellerA, orderNumber: `G-${suffix}-2`, status: "cancelled", totalCents: 9000, subtotalCents: 9000, stripeCheckoutSessionId: stripeC },
      { ownerId: sellerA, orderNumber: `G-${suffix}-3`, status: "pending", totalCents: 1000, subtotalCents: 1000, stripeCheckoutSessionId: stripeX },
    ]).returning({ id: orders.id });
    orderIds.push(...inserted.map((o) => o.id));

    await recordCheckoutAttribution({ checkoutSessionId: crypto.randomUUID(), stripeSessionId: stripeA, sellerId: sellerA, attribution: { code } });
    await recordCheckoutAttribution({ checkoutSessionId: crypto.randomUUID(), stripeSessionId: stripeC, sellerId: sellerA, attribution: { code } });
    // Seller B's checkout cannot claim seller A's link; with no UTM either, nothing is recorded.
    const foreign = crypto.randomUUID();
    await recordCheckoutAttribution({ checkoutSessionId: foreign, stripeSessionId: stripeX, sellerId: sellerB, attribution: { code } });
    expect(await db.select().from(checkoutAttributions).where(eq(checkoutAttributions.checkoutSessionId, foreign))).toHaveLength(0);
    // Garbage never throws.
    await recordCheckoutAttribution({ checkoutSessionId: crypto.randomUUID(), stripeSessionId: null, sellerId: sellerA, attribution: "junk" });

    const detail = await api("GET", `/links/${linkId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.orders).toBe(1); // cancelled order excluded
    expect(detail.body.revenueCents).toBe(6000);
    expect(detail.body.clicks).toBe(4);
    expect(detail.body.conversionRate).toBeCloseTo(0.25);
    expect(detail.body.series).toHaveLength(30);
    expect(detail.body.series.reduce((n: number, d: any) => n + d.clicks, 0)).toBe(4);
    expect(detail.body.countries).toEqual(expect.arrayContaining([{ label: "DE", count: 1 }]));
    const list = await api("GET", "/links");
    const row = list.body.find((l: any) => l.id === linkId);
    expect([row.clicks, row.orders, row.revenueCents]).toEqual([4, 1, 6000]);
  });
});

describe("link in bio", () => {
  let slug = "";
  let linkA = "";

  it("prefills from the profile and does not persist until saved", async () => {
    const r = await api("GET", "/bio");
    expect(r.body.exists).toBe(false);
    expect(r.body.displayName).toBe("Acme Studio");
    expect(r.body.bio).toBe("Profile bio");
    expect(await db.select().from(bioPages).where(eq(bioPages.sellerId, sellerA))).toHaveLength(0);
  });

  it("saves the page with a stable slug derived from the username and validates fields", async () => {
    expect((await api("PUT", "/bio", { accentColor: "red" })).status).toBe(400);
    expect((await api("PUT", "/bio", { avatarUrl: "http://insecure.test/a.jpg" })).status).toBe(400);
    const r = await api("PUT", "/bio", {
      displayName: "Acme Studio", bio: "Made in Lisbon", avatarUrl: "https://cdn.test/a.jpg", theme: "dark",
      socials: { instagram: "@acme", website: "javascript:alert(1)" }, featuredProductIds: [productA, productB],
    });
    expect(r.status).toBe(200);
    slug = r.body.slug;
    expect(slug).toBe(usernameA);
    expect(r.body.socials).toEqual({ instagram: "https://www.instagram.com/acme" });
    expect(r.body.featuredProductIds).toEqual([productA]); // seller B's product dropped
    const again = await api("PUT", "/bio", { bio: "Updated" });
    expect(again.body.slug).toBe(slug);
  });

  it("manages links: add, validate, toggle, reorder", async () => {
    expect((await api("POST", "/bio/links", { title: "x", url: "javascript:alert(1)" })).status).toBe(400);
    expect((await api("POST", "/bio/links", { title: "", url: "https://a.test" })).status).toBe(400);
    const a = await api("POST", "/bio/links", { title: "Lookbook", url: "https://lookbook.test/ss26" });
    const b = await api("POST", "/bio/links", { title: "Press <b>kit</b>", url: "mailto:press@acme.test" });
    const c = await api("POST", "/bio/links", { title: "Hidden", url: "https://hidden.test" });
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    linkA = a.body.id;
    expect((await api("PATCH", `/bio/links/${c.body.id}`, { enabled: false })).body.enabled).toBe(false);
    const order = await api("PUT", "/bio/links/order", { ids: [b.body.id, a.body.id, c.body.id] });
    expect(order.body.map((l: any) => l.title)).toEqual(["Press <b>kit</b>", "Lookbook", "Hidden"]);
    // another seller's link ids cannot be reordered / edited / deleted
    expect((await api("PUT", "/bio/links/order", { ids: [a.body.id] }, sellerB)).status).toBe(404);
    expect((await api("PATCH", `/bio/links/${a.body.id}`, { title: "x" }, sellerB)).status).toBe(404);
    expect((await api("DELETE", `/bio/links/${a.body.id}`, undefined, sellerB)).status).toBe(404);
  });

  it("renders a server-side page with OG tags, escaped content and only enabled links", async () => {
    // The bio page now lives at the store website address.
    const old = await get(`/bio/${slug}?utm_source=ig`);
    expect(old.status).toBe(301);
    expect(old.headers.get("location")).toMatch(new RegExp(`/@${usernameA}\\?utm_source=ig$`));
    const res = await get(`/@${usernameA}`, H(CHROME, { "cf-ipcountry": "US" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain('property="og:title" content="Acme Studio"');
    expect(html).toMatch(/property="og:image" content="[^"]*\/@growtha[0-9a-f]+\/og\.png\?v=[0-9a-f]+"/);
    expect(html).toContain('src="https://cdn.test/a.jpg"');
    expect(html).toContain("Tee A");
    expect(html).toContain("$45.00");
    expect(html).toContain("Lookbook");
    expect(html).toContain("Press &lt;b&gt;kit&lt;/b&gt;");
    expect(html).not.toContain("Hidden");
    expect(html).not.toContain("Tee B");
    expect(html.match(/<script/gi)).toHaveLength(1); // only the share button script, allowed by hash in the CSP
    expect(html).not.toContain("lookbook.test"); // destination URLs only appear behind the tracked redirect
    expect((await get("/bio/nope-nope")).status).toBe(404);
  });

  it("tracks link, shop and product clicks and never redirects to disabled/foreign links", async () => {
    const r = await get(`/bio/${slug}/go/${linkA}`);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://lookbook.test/ss26");
    const shop = await get(`/bio/${slug}/shop`);
    expect(new URL(shop.headers.get("location")!).searchParams.get("utm_source")).toBe("brandthread_bio");
    const prod = await get(`/bio/${slug}/p/${productA}`);
    expect(new URL(prod.headers.get("location")!).pathname).toBe(`/store/product/${productA}`);
    expect((await get(`/bio/${slug}/p/${productB}`)).status).toBe(404);
    const hidden = await db.select().from(bioLinks).where(eq(bioLinks.enabled, false));
    const hiddenMine = hidden.find((h) => h.sellerId === sellerA)!;
    expect((await get(`/bio/${slug}/go/${hiddenMine.id}`)).status).toBe(404);
    // bot hits redirect but are not counted
    expect((await get(`/bio/${slug}/go/${linkA}`, H("Slackbot-LinkExpanding 1.0"))).status).toBe(302);

    const stats = await api("GET", "/bio/stats");
    expect(stats.body.views).toBe(1);
    expect(stats.body.shopClicks).toBe(1);
    expect(stats.body.productClicks).toBe(1);
    expect(stats.body.clicks).toBe(3);
    expect(stats.body.links).toEqual([expect.objectContaining({ id: linkA, clicks: 1 })]);
    const page = await api("GET", "/bio");
    expect(page.body.links.find((l: any) => l.id === linkA).clicks30).toBe(1);
    // seller B sees none of it
    expect((await api("GET", "/bio/stats", undefined, sellerB)).body.views).toBe(0);
  });

  it("a bio tracked link redirects to the bio page once published; unpublished pages 404", async () => {
    const t = await api("POST", "/links", { destinationType: "bio", utmSource: "tiktok", utmMedium: "social" });
    expect(t.status).toBe(201);
    const res = await get(`/l/${t.body.code}`);
    expect(new URL(res.headers.get("location")!).pathname).toBe(`/@${usernameA}`);
    await api("PUT", "/bio", { published: false });
    expect((await get(`/@${usernameA}`)).status).toBe(404);
    expect((await get(`/bio/${slug}`)).status).toBe(404);
    expect((await get(`/l/${t.body.code}`)).status).toBe(404);
    await api("PUT", "/bio", { published: true });
  });

  it("deleting a bio link removes it from the page", async () => {
    expect((await api("DELETE", `/bio/links/${linkA}`)).status).toBe(204);
    const html = await (await get(`/bio/${slug}`, H(`${CHROME} Second/${suffix}`))).text();
    expect(html).not.toContain("Lookbook");
  });
});

describe("store pixels", () => {
  const META = "1234567890123456";
  const TT = "C4ABCD1234567890ABCD";

  it("validates strictly and rejects script payloads", async () => {
    const bad = await api("PUT", "/pixels", { metaPixelId: `123");alert(1);//`, tiktokPixelId: "<script>" });
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toHaveProperty("metaPixelId");
    expect(bad.body.errors).toHaveProperty("tiktokPixelId");
    expect((await api("GET", "/pixels")).body).toEqual({ metaPixelId: null, tiktokPixelId: null });
    // Nothing was persisted
    expect(await db.select().from(storePixels).where(eq(storePixels.sellerId, sellerA))).toHaveLength(0);
  });

  it("stores per store and injects the standard base code only on the public site", async () => {
    const saved = await api("PUT", "/pixels", { metaPixelId: ` ${META} `, tiktokPixelId: TT.toLowerCase() });
    expect(saved.body).toEqual({ metaPixelId: META, tiktokPixelId: TT });
    expect((await api("GET", "/pixels", undefined, sellerB)).body).toEqual({ metaPixelId: null, tiktokPixelId: null });

    const site = await fetch(`${base}/api/store/site/${storeSlug}`);
    expect(site.status).toBe(200);
    expect(site.headers.get("vary")).toContain("Sec-GPC");
    const html = await site.text();
    expect(html).toContain(`fbq("init","${META}")`);
    expect(html).toContain(`ttq.load("${TT}")`);
    expect(html).toContain("window.btPixel");
    expect(html).toContain("attribution: window.__btAttribution");
  });

  it("injects nothing when the visitor sends Sec-GPC or DNT", async () => {
    for (const headers of [{ "sec-gpc": "1" }, { dnt: "1" }]) {
      const html = await (await fetch(`${base}/api/store/site/${storeSlug}`, { headers })).text();
      expect(html).not.toContain("fbevents.js");
      expect(html).not.toContain("analytics.tiktok.com");
      expect(html).not.toContain("btPixel");
    }
  });

  it("clearing the IDs removes the injection", async () => {
    expect((await api("PUT", "/pixels", { metaPixelId: "", tiktokPixelId: null })).status).toBe(200);
    const html = await (await fetch(`${base}/api/store/site/${storeSlug}`)).text();
    expect(html).not.toContain("fbevents.js");
    expect(html).not.toContain("analytics.tiktok.com");
  });

  it("even a poisoned database value cannot be injected (defense in depth)", async () => {
    await db.insert(storePixels).values({ sellerId: sellerA, metaPixelId: `1");alert(1);//`, tiktokPixelId: "<script>alert(1)</script>" })
      .onConflictDoUpdate({ target: storePixels.sellerId, set: { metaPixelId: `1");alert(1);//`, tiktokPixelId: "<script>alert(1)</script>" } });
    const html = await (await fetch(`${base}/api/store/site/${storeSlug}`)).text();
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("fbevents.js");
  });
});
