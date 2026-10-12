/**
 * The store at brandthread.app/@handle (Stan Store layout) and My Store's
 * blocks API (/api/store-blocks, migration 276), against Postgres.
 *
 * Covers: every seller with a username has a store before opening My Store
 * (their active products as blocks), the first My Store visit saves that list
 * once, adding a catalog product (draft → edit → publish), price writes going
 * to the product's variants, hide / remove / reorder, pre-orders (ship date,
 * cap, drop held for the pre-order), the on-store checkout and confirmation
 * pages, older /p/ and /go/ links, the preview card, presets on
 * /api/growth/bio, and switching the store off.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import sharp from "sharp";
import {
  db, users, products, productVariants, productPreorderTerms, bioPages, bioLinks, bioEvents, drops, storeBlocks,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const suffix = crypto.randomBytes(5).toString("hex");
const seller = `site-seller-${suffix}`;
const fresh = `site-fresh-${suffix}`;
const buyer = `site-buyer-${suffix}`;
const handle = `maison${suffix}`;
const freshHandle = `fresh${suffix}`;
const buyerHandle = `buyer${suffix}`;
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const DAY = 86_400_000;

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
vi.mock("../../lib/activityEvents", () => ({ notifyNewProduct: vi.fn(async () => {}) }));

let server: Server;
let base = "";
const productIds: Record<string, string> = {};
const variantIds: Record<string, string> = {};

async function call(method: string, path: string, body?: unknown, as: string | null = seller) {
  authState.clerkUserId = as;
  const res = await fetch(`${base}/api${path}`, {
    method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const api = (method: string, path: string, body?: unknown, as: string | null = seller) => call(method, `/growth${path}`, body, as);
const blocksApi = (method: string, path: string, body?: unknown, as: string | null = seller) => call(method, `/store-blocks${path}`, body, as);
const get = (path: string, ua = CHROME) => fetch(`${base}${path}`, { redirect: "manual", headers: { "user-agent": ua } });
const page = async (path = `/@${handle}`) => (await get(path)).text();
const blockOf = async (name: string) => (await blocksApi("GET", "")).body.blocks.find((b: any) => b.productId === productIds[name]);

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@test.local`, name: "Seller", brandName: "Maison Noir", username: handle, bio: "Profile bio", role: "seller", accountType: "seller", socialLinks: { instagram: "maison.noir" } },
    { clerkId: fresh, email: `${fresh}@test.local`, name: "Fresh", displayName: "Fresh Label", username: freshHandle, role: "seller", accountType: "seller" },
    { clerkId: buyer, email: `${buyer}@test.local`, name: "Buyer", username: buyerHandle, role: "buyer", accountType: "buyer" },
  ]);
  const rows = await db.insert(products).values([
    { ownerId: seller, name: "Old tee", status: "active", images: ["https://cdn.test/old.jpg"], createdAt: new Date(Date.now() - DAY) },
    { ownerId: seller, name: "New knit", status: "active", images: ["https://cdn.test/knit.jpg"], description: "Merino" },
    { ownerId: seller, name: "Draft hoodie", status: "draft", images: ["https://cdn.test/hoodie.jpg"] },
    { ownerId: seller, name: "Deleted cap", status: "active", images: [], deletedAt: new Date() },
    // What POST /api/products makes for "Pre-order → create it right there".
    { ownerId: seller, name: "Field jacket", status: "draft", images: ["https://cdn.test/jacket.jpg"], isPreOrder: true, preOrderEstShipDate: new Date(Date.now() + 30 * DAY) },
    { ownerId: fresh, name: "Fresh tee", status: "active", images: [] },
  ]).returning({ id: products.id, name: products.name });
  for (const r of rows) productIds[r.name] = r.id;
  const variants = await db.insert(productVariants).values([
    { productId: productIds["Old tee"], sku: `ST-${suffix}-0`, priceCents: 2500, stock: 4 },
    { productId: productIds["New knit"], sku: `ST-${suffix}-1`, size: "M", color: "Black", priceCents: 12000, stock: 3 },
    { productId: productIds["New knit"], sku: `ST-${suffix}-2`, size: "L", color: "Black", priceCents: 9900, stock: 0 },
    { productId: productIds["Draft hoodie"], sku: `ST-${suffix}-3`, priceCents: 6000, stock: 5 },
    { productId: productIds["Field jacket"], sku: `ST-${suffix}-4`, priceCents: 18000, stock: 0 },
    { productId: productIds["Fresh tee"], sku: `ST-${suffix}-5`, priceCents: 3000, stock: 2 },
  ]).returning({ id: productVariants.id, sku: productVariants.sku, productId: productVariants.productId });
  for (const v of variants) variantIds[v.sku.split("-").pop()!] = v.id;

  const { default: growthRouter } = await import("../growth");
  const { default: storeBlocksRouter } = await import("../storeBlocks");
  const site = await import("../storeSite");
  const app = express();
  app.use(express.json());
  app.set("trust proxy", 1);
  app.use("/api/growth", growthRouter);
  app.use("/api/store-blocks", storeBlocksRouter);
  app.get("/@:handle", site.storeSiteHandler);
  app.get("/@:handle/c/:productId", site.storeSiteCheckoutHandler);
  app.get("/@:handle/c/:productId/done", site.storeSiteCheckoutDoneHandler);
  app.get("/@:handle/p/:productId", site.storeSiteProductHandler);
  app.get("/@:handle/go/:linkId", site.storeSiteLinkRedirect);
  app.get("/@:handle/og.png", site.storeSiteOgHandler);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const ids = [seller, fresh, buyer];
  const pids = Object.values(productIds);
  await db.delete(storeBlocks).where(inArray(storeBlocks.sellerId, ids));
  await db.delete(bioEvents).where(inArray(bioEvents.sellerId, ids));
  await db.delete(bioLinks).where(inArray(bioLinks.sellerId, ids));
  await db.delete(bioPages).where(inArray(bioPages.sellerId, ids));
  await db.delete(productPreorderTerms).where(inArray(productPreorderTerms.productId, pids));
  await db.delete(productVariants).where(inArray(productVariants.productId, pids));
  await db.delete(products).where(inArray(products.ownerId, ids));
  await db.delete(drops).where(inArray(drops.ownerId, ids));
  await db.delete(users).where(inArray(users.clerkId, ids));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("store before My Store is opened", () => {
  it("shows the profile, then active products as blocks (newest first)", async () => {
    const freshHtml = await page(`/@${freshHandle}`);
    expect(freshHtml).toContain("<title>Fresh Label</title>");
    expect(freshHtml).toContain("Fresh tee");

    const html = await page();
    expect(html).toContain("<title>Maison Noir</title>");
    expect(html).toContain("Profile bio");
    expect(html).toContain('href="https://www.instagram.com/maison.noir"');
    expect(html).toContain(`<a class="blk co" href="/@${handle}/c/${productIds["New knit"]}">`);
    expect(html.indexOf("New knit")).toBeLessThan(html.indexOf("Old tee"));
    expect(html).toContain("$99"); // the lowest option's price
    expect(html).toContain('<span class="btn cta">Buy now</span>');
    for (const gone of ["Draft hoodie", "Deleted cap", "Fresh tee", "Field jacket"]) expect(html).not.toContain(gone);
    // Looking at a store never writes blocks.
    expect(await db.select().from(storeBlocks).where(eq(storeBlocks.sellerId, seller))).toHaveLength(0);
  });

  it("featured products come first", async () => {
    expect((await api("PUT", "/bio", { featuredProductIds: [productIds["Old tee"]] })).status).toBe(200);
    const html = await page();
    expect(html.indexOf("Old tee")).toBeLessThan(html.indexOf("New knit"));
  });

  it("carries tracked-link attribution onto checkout links", async () => {
    const html = await page(`/@${handle}?utm_source=instagram&utm_medium=bio&evil=%22%3E`);
    expect(html).toContain(`/c/${productIds["Old tee"]}?utm_source=instagram&amp;utm_medium=bio"`);
    expect(html).not.toContain("evil");
  });

  it("redirects mixed-case handles; 404s unknown handles and buyers", async () => {
    const res = await get(`/@${handle.toUpperCase()}`);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`/@${handle}`);
    expect((await get(`/@nobody${suffix}`)).status).toBe(404);
    expect((await get(`/@${buyerHandle}`)).status).toBe(404);
    expect((await get("/@a")).status).toBe(404);
  });
});

describe("My Store blocks", () => {
  it("the first visit saves what the store already shows, once", async () => {
    const first = await blocksApi("GET", "");
    expect(first.status).toBe(200);
    expect(first.body.blocks.map((b: any) => b.product.name)).toEqual(["Old tee", "New knit"]);
    expect(first.body.blocks[0]).toMatchObject({ kind: "premade", style: "callout", status: "published", visible: true, buttonLabel: "Buy now", priceCents: 2500, stock: 4 });
    expect((await blocksApi("GET", "")).body.blocks).toHaveLength(2);
    expect(await db.select().from(storeBlocks).where(eq(storeBlocks.sellerId, seller))).toHaveLength(2);
  });

  it("the catalog offers products that aren't on the store yet", async () => {
    const r = await blocksApi("GET", "/catalog");
    expect(r.body.products.map((p: any) => p.name).sort()).toEqual(["Draft hoodie", "Field jacket"]);
    expect(r.body.products.find((p: any) => p.name === "Draft hoodie")).toMatchObject({ priceCents: 6000, stock: 5, isPreOrder: false });
  });

  it("Pre-made from your products: add → edit thumbnail and checkout page → publish", async () => {
    const added = await blocksApi("POST", "", { productId: productIds["Draft hoodie"] });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ kind: "premade", status: "draft", title: "Draft hoodie", buttonLabel: "Buy now" });
    expect((await blocksApi("POST", "", { productId: productIds["Draft hoodie"] })).status).toBe(409);
    expect(await page()).not.toContain("Draft hoodie"); // drafts aren't on the store

    const id = added.body.id;
    const saved = await blocksApi("PATCH", `/${id}`, {
      style: "callout", title: "Heavy hoodie", subtitle: "450gsm fleece", buttonText: "Get it",
      description: "Garment dyed.", priceCents: 4500, compareAtPriceCents: 6000,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ title: "Heavy hoodie", subtitle: "450gsm fleece", buttonLabel: "Get it", priceCents: 4500, compareAtPriceCents: 6000 });
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, variantIds["3"]));
    expect([variant.priceCents, variant.compareAtPriceCents]).toEqual([4500, 6000]);
    expect((await blocksApi("PATCH", `/${id}`, { compareAtPriceCents: 4000 })).status).toBe(400);
    expect((await blocksApi("PATCH", `/${id}`, { shipBy: "2026-12-01" })).body.field).toBe("shipBy");

    const live = await blocksApi("POST", `/${id}/publish`);
    expect(live.status).toBe(200);
    expect(live.body.status).toBe("published");
    const [prod] = await db.select({ status: products.status }).from(products).where(eq(products.id, productIds["Draft hoodie"]));
    expect(prod.status).toBe("active");
    const html = await page();
    expect(html).toContain("Heavy hoodie");
    expect(html).toContain("450gsm fleece");
    expect(html).toContain('<span class="pr">$45<s>$60</s></span>');
    expect(html).toContain('<span class="btn cta">Get it</span>');
  });

  it("Pre-order: ship date and cap open a held pre-order drop; the card says Pre-order and Ships by", async () => {
    const added = await blocksApi("POST", "", { productId: productIds["Field jacket"] });
    expect(added.body.kind).toBe("preorder");
    expect(added.body.buttonLabel).toBe("Pre-order");
    const id = added.body.id;
    const shipBy = new Date(Date.now() + 40 * DAY).toISOString().slice(0, 10);
    expect((await blocksApi("PATCH", `/${id}`, { shipBy: new Date(Date.now() + 400 * DAY).toISOString() })).status).toBe(200);
    const tooLate = await blocksApi("POST", `/${id}/publish`);
    expect(tooLate.status).toBe(400);
    expect(tooLate.body.field).toBe("shipBy");

    expect((await blocksApi("PATCH", `/${id}`, { shipBy, preorderCap: 20 })).status).toBe(200);
    const live = await blocksApi("POST", `/${id}/publish`);
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ status: "published", preorderCap: 20, stock: 20, preorderSold: 0 });

    const [prod] = await db.select().from(products).where(eq(products.id, productIds["Field jacket"]));
    expect(prod.status).toBe("active");
    expect(prod.isPreOrder).toBe(true);
    const [drop] = await db.select().from(drops).where(eq(drops.id, prod.dropId!));
    expect(drop).toMatchObject({ ownerId: seller, type: "pre-order", status: "active", escrowState: "collecting", payoutStatus: "held" });
    expect(drop.estimatedShipDate?.toISOString().slice(0, 10)).toBe(shipBy);
    expect(drop.fulfillmentDeadlineAt!.getTime()).toBeGreaterThan(new Date(shipBy).getTime());
    const [terms] = await db.select().from(productPreorderTerms).where(eq(productPreorderTerms.productId, prod.id));
    expect(terms.shipByDate.toISOString().slice(0, 10)).toBe(shipBy);

    const label = live.body.shipByLabel;
    expect(label).toMatch(/^Ships by [A-Z][a-z]{2} \d{1,2}/);
    const html = await page();
    expect(html).toContain('<span class="btn cta">Pre-order</span>');
    expect(html).toContain(`<span class="sb">${label}</span>`);

    // 3 sold, then the cap drops to 15: 12 left.
    await db.update(productVariants).set({ stock: 17 }).where(eq(productVariants.id, variantIds["4"]));
    const recapped = await blocksApi("PATCH", `/${id}`, { preorderCap: 15 });
    expect(recapped.body).toMatchObject({ preorderCap: 15, stock: 12, preorderSold: 3 });
    // Sold out at the cap: still shown, not tappable.
    await db.update(productVariants).set({ stock: 0 }).where(eq(productVariants.id, variantIds["4"]));
    expect(await page()).toContain('<div class="blk co off" aria-disabled="true">');
    expect((await get(`/@${handle}/c/${productIds["Field jacket"]}`)).status).toBe(200);
    expect(await page(`/@${handle}/c/${productIds["Field jacket"]}`)).not.toContain('<form id="co"');
    await db.update(productVariants).set({ stock: 12 }).where(eq(productVariants.id, variantIds["4"]));
  });

  it("hide / show per block", async () => {
    const knit = await blockOf("New knit");
    expect((await blocksApi("PATCH", `/${knit.id}`, { visible: false })).body.visible).toBe(false);
    expect(await page()).not.toContain("New knit");
    expect((await get(`/@${handle}/c/${productIds["New knit"]}`)).status).toBe(404);
    await blocksApi("PATCH", `/${knit.id}`, { visible: true });
    expect(await page()).toContain("New knit");
  });

  it("drag to reorder", async () => {
    const ids = (await blocksApi("GET", "")).body.blocks.map((b: any) => b.id);
    const reversed = [...ids].reverse();
    const r = await blocksApi("PUT", "/order", { ids: reversed });
    expect(r.status).toBe(200);
    expect(r.body.blocks.map((b: any) => b.id)).toEqual(reversed);
    const html = await page();
    expect(html.indexOf("Field jacket")).toBeLessThan(html.indexOf("Old tee"));
    expect((await blocksApi("PUT", "/order", { ids: reversed.slice(1) })).status).toBe(409);
  });

  it("removing a block takes it off the store, keeps the product, and never re-seeds", async () => {
    const tee = await blockOf("Old tee");
    expect((await blocksApi("DELETE", `/${tee.id}`)).status).toBe(204);
    expect(await page()).not.toContain("Old tee");
    expect((await blocksApi("GET", "")).body.blocks.map((b: any) => b.product.name)).not.toContain("Old tee");
    const [prod] = await db.select({ status: products.status }).from(products).where(eq(products.id, productIds["Old tee"]));
    expect(prod.status).toBe("active");
    expect((await blocksApi("GET", "/catalog")).body.products.map((p: any) => p.name)).toContain("Old tee");
    const back = await blocksApi("POST", "", { productId: productIds["Old tee"] });
    expect(back.status).toBe(201);
    expect(back.body.id).toBe(tee.id);
    expect(back.body.status).toBe("draft");
  });

  it("only the seller's own products and blocks", async () => {
    expect((await blocksApi("POST", "", { productId: productIds["Fresh tee"] })).status).toBe(404);
    const knit = await blockOf("New knit");
    expect((await blocksApi("PATCH", `/${knit.id}`, { title: "Mine" }, fresh)).status).toBe(404);
    expect((await blocksApi("GET", "", undefined, null)).status).toBe(401);
  });
});

describe("checkout on the store", () => {
  it("opens on the store with image, price, options and the buyer's details", async () => {
    const id = productIds["New knit"];
    const res = await get(`/@${handle}/c/${id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>New knit</h1>");
    expect(html).toContain("Merino");
    expect(html).toContain(`data-product="${id}"`);
    expect(html).toContain(`data-done="/@${handle}/c/${id}/done"`);
    expect(html).toContain(`<option value="${variantIds["2"]}" disabled>L / Black · $99 · Sold out</option>`);
    expect(html).toContain(`href="/@${handle}" aria-label="Back to Maison Noir"`);
    expect(res.headers.get("content-security-policy")).not.toContain("stripe.com");
    expect(html).not.toContain("js.stripe.com");
  });

  it("embeds Stripe's payment form when a publishable key is set", async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_1234567890abcdef";
    try {
      const res = await get(`/@${handle}/c/${productIds["New knit"]}`);
      expect(res.headers.get("content-security-policy")).toContain("https://js.stripe.com");
      expect(await res.text()).toContain('data-pk="pk_test_1234567890abcdef"');
    } finally {
      delete process.env.STRIPE_PUBLISHABLE_KEY;
    }
  });

  it("pre-order checkout shows the ship date", async () => {
    const html = await page(`/@${handle}/c/${productIds["Field jacket"]}`);
    expect(html).toMatch(/<p class="sb">Ships by [A-Z][a-z]{2} \d{1,2}/);
    expect(html).toContain("Continue to pre-order");
  });

  it("confirmation page", async () => {
    const res = await get(`/@${handle}/c/${productIds["New knit"]}/done?session_id=cs_test_1`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("Thank you!");
    expect(html).toContain(`<a class="btn" href="/@${handle}">Back to Maison Noir</a>`);
  });

  it("404s products that aren't on this store", async () => {
    expect((await get(`/@${handle}/c/${productIds["Fresh tee"]}`)).status).toBe(404);
    expect((await get(`/@${handle}/c/${productIds["Deleted cap"]}`)).status).toBe(404);
    expect((await get(`/@${handle}/c/not-a-uuid`)).status).toBe(404);
  });

  it("older /p/ product links open the checkout", async () => {
    const id = productIds["New knit"];
    const res = await get(`/@${handle}/p/${id}`);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`/@${handle}/c/${id}`);
    expect((await get(`/@${handle}/p/${productIds["Fresh tee"]}`)).headers.get("location")).toBe(`/@${handle}`);
  });
});

describe("store extras", () => {
  it("older link buttons still redirect, but the store no longer shows them", async () => {
    expect((await api("POST", "/bio/links", { title: "Waitlist", url: "https://l1.test" })).status).toBe(201);
    const first = (await api("GET", "/bio")).body.links[0];
    expect(await page()).not.toContain("/go/");
    const go = await get(`/@${handle}/go/${first.id}`);
    expect(go.status).toBe(302);
    expect(go.headers.get("location")).toBe("https://l1.test/");
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

describe("Design presets on /api/growth/bio", () => {
  it("returns the store link, presets and the blocks the store shows", async () => {
    const r = await api("GET", "/bio");
    expect(r.status).toBe(200);
    expect(r.body.siteUrl).toMatch(new RegExp(`/@${handle}$`));
    expect(r.body.siteTheme).toBe("black");
    expect(r.body.themes.map((t: any) => t.key)).toEqual(["black", "white", "silver", "graphite", "onyx"]);
    expect(r.body.products.map((p: any) => p.name)).toEqual(["Field jacket", "Heavy hoodie", "New knit"]);
  });

  it("saves a preset; the page uses its background and accent", async () => {
    expect((await api("PUT", "/bio", { siteTheme: "navy" })).status).toBe(400);
    const r = await api("PUT", "/bio", { siteTheme: "silver", displayName: "Maison", bio: "Knitwear" });
    expect(r.status).toBe(200);
    expect(r.body.siteTheme).toBe("silver");
    const html = await page();
    expect(html).toContain("background:#D1D1D6");
    expect(html).toContain("<title>Maison</title>");
  });

  it("the older link-in-bio screen's light/dark save keeps a preset of the same lightness", async () => {
    expect((await api("PUT", "/bio", { theme: "mono", bio: "Still knitwear" })).body.siteTheme).toBe("silver");
    expect((await api("PUT", "/bio", { theme: "dark" })).body.siteTheme).toBe("black");
  });

  it("switching the store off takes the store and its checkout down", async () => {
    await api("PUT", "/bio", { published: false });
    expect((await get(`/@${handle}`)).status).toBe(404);
    expect((await get(`/@${handle}/c/${productIds["New knit"]}`)).status).toBe(404);
    await api("PUT", "/bio", { published: true });
    expect((await get(`/@${handle}`)).status).toBe(200);
  });

  it("buyers get no store link", async () => {
    const r = await api("GET", "/bio", undefined, buyer);
    expect(r.body.siteUrl).toBeNull();
  });
});
