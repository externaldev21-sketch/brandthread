import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, follows, posts, products, productVariants, users } from "@workspace/db";
import { inArray, or } from "drizzle-orm";

// A random nonsense stem keeps these rows isolated from anything else in the
// shared test database: every query below only matches fixtures from this file.
const s = crypto.randomBytes(4).toString("hex");
const W = `qzx${s}`;
const id = (n: string) => `su-${n}-${s}`;
const sellerExact = id("seller-exact");
const sellerWord = id("seller-word");
const buyerPrefix = id("buyer-prefix");
const buyerContains = id("buyer-contains");
const fan = id("fan");
const productIds: string[] = [];
const postIds: string[] = [];
let server: Server;
let base = "";

async function addProduct(ownerId: string, name: string, extra: Partial<typeof products.$inferInsert> = {}) {
  const [p] = await db.insert(products).values({ ownerId, name, status: "active", ...extra }).returning();
  productIds.push(p.id);
  await db.insert(productVariants).values({ productId: p.id, sku: `${s}-${productIds.length}`, size: "M", color: "Black", priceCents: 4000, stock: 1 });
  return p;
}

const get = async (qs: string) => {
  const r = await fetch(`${base}/api/public/search/all?${qs}`);
  return { status: r.status, body: await r.json() as any };
};
const names = (items: any[]) => items.map((i) => i.name);

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: sellerExact, email: `${sellerExact}@test.local`, name: "A", displayName: "A", brandName: W, username: `${W}_official`, role: "seller", accountType: "seller" },
    { clerkId: sellerWord, email: `${sellerWord}@test.local`, name: "B", displayName: "B", brandName: `House of ${W}`, role: "seller", accountType: "seller" },
    { clerkId: buyerPrefix, email: `${buyerPrefix}@test.local`, name: `${W}lover`, displayName: `${W}lover`, username: `${W}lover`, role: "buyer", accountType: "buyer" },
    { clerkId: buyerContains, email: `${buyerContains}@test.local`, name: "C", displayName: `mega${W}fan`, role: "buyer", accountType: "buyer" },
    { clerkId: fan, email: `${fan}@test.local`, name: "Fan", displayName: "Fan", role: "buyer", accountType: "buyer" },
  ]);
  // House of W has a follower; tier must still keep the exact-name brand first.
  await db.insert(follows).values({ followerId: fan, followingId: sellerWord });

  await addProduct(sellerWord, `Washed ${W} Tee`, { styleTags: ["vintage"] });            // word
  await addProduct(sellerWord, `${W} Hoodie`, { styleTags: ["streetwear"] });             // prefix
  await addProduct(sellerExact, `Classic Pullover`, { description: `${W} heavyweight fleece`, tags: ["Streetwear"] }); // description only
  await addProduct(sellerExact, `Super${W} Cap`);                                         // contains (and accessories by keyword)
  for (let i = 0; i < 4; i++) await addProduct(sellerExact, `${W} Pack ${i}`);            // more prefix rows for paging

  const [p1] = await db.insert(posts).values({ userId: sellerWord, mediaUrl: "https://x.test/a.jpg", mediaType: "photo", caption: `Fit check #${W}` }).returning();
  const [p2] = await db.insert(posts).values({ userId: sellerExact, mediaUrl: "https://x.test/b.mp4", mediaType: "video", caption: `${W} drop is live` }).returning();
  postIds.push(p1.id, p2.id);

  const { default: router } = await import("../search-unified");
  const app = express();
  app.use((req, _res, next) => { (req as any).log = { error: console.error }; next(); });
  app.use("/api/public", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(posts).where(inArray(posts.id, postIds));
  await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(follows).where(or(inArray(follows.followerId, [fan]), inArray(follows.followingId, [sellerWord])));
  await db.delete(users).where(inArray(users.clerkId, [sellerExact, sellerWord, buyerPrefix, buyerContains, fan]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/public/search/all", () => {
  it("returns all four sections for type=top", async () => {
    const { status, body } = await get(`q=${W}`);
    expect(status).toBe(200);
    expect(Object.keys(body.sections).sort()).toEqual(["brands", "people", "posts", "products"]);
    expect(body.sections.products.items.length).toBe(6);
    expect(body.sections.products.hasMore).toBe(true);
    expect(body.order.length).toBe(4);
  });

  it("ranks products prefix > word > description > contains", async () => {
    const { body } = await get(`q=${W}&type=products&limit=50`);
    const list = names(body.sections.products.items);
    const tiers = body.sections.products.items.map((i: any) => i.tier);
    expect(tiers).toEqual([...tiers].sort((a: number, b: number) => a - b));
    expect(list.indexOf(`${W} Hoodie`)).toBeLessThan(list.indexOf(`Washed ${W} Tee`));
    expect(list.indexOf(`Washed ${W} Tee`)).toBeLessThanOrEqual(list.indexOf("Classic Pullover"));
    expect(list.at(-1)).toBe(`Super${W} Cap`);
    expect(body.sections.products.items.find((i: any) => i.name === `${W} Hoodie`)).toMatchObject({ priceCents: 4000, brand: `House of ${W}` });
  });

  it("ranks the exact brand name above a more-followed word match", async () => {
    const { body } = await get(`q=${W}&type=brands`);
    expect(names(body.sections.brands.items)).toEqual([W, `House of ${W}`]);
    expect(body.sections.brands.items[1]).toMatchObject({ followerCount: 1, productCount: 2 });
  });

  it("ranks people prefix above contains and finds them by display name", async () => {
    const { body } = await get(`q=${W}&type=people`);
    const ids = body.sections.people.items.map((p: any) => p.userId);
    expect(ids).toEqual([buyerPrefix, buyerContains]);
  });

  it("matches post captions of every media type, caption-start first", async () => {
    const { body } = await get(`q=${W}&type=posts`);
    expect(body.sections.posts.items.map((p: any) => p.postId)).toEqual([postIds[1], postIds[0]]);
    expect(body.sections.posts.items[1]).toMatchObject({ thumbnailUrl: "https://x.test/a.jpg", authorName: `House of ${W}` });
  });

  it("paginates without repeating or skipping", async () => {
    const first = await get(`q=${W}&type=products&limit=3&offset=0`);
    const second = await get(`q=${W}&type=products&limit=3&offset=${first.body.sections.products.nextOffset}`);
    const all = await get(`q=${W}&type=products&limit=50`);
    expect([...names(first.body.sections.products.items), ...names(second.body.sections.products.items)])
      .toEqual(names(all.body.sections.products.items).slice(0, 6));
    expect(first.body.sections.products.nextOffset).toBe(3);
  });

  it("filters products by a style chip (style_tags or free-text tags)", async () => {
    const { body } = await get(`q=${W}&type=products&style=streetwear`);
    expect(names(body.sections.products.items).sort()).toEqual(["Classic Pullover", `${W} Hoodie`].sort());
    const vintage = await get(`q=${W}&type=products&style=vintage`);
    expect(names(vintage.body.sections.products.items)).toEqual([`Washed ${W} Tee`]);
  });

  it("filters by the accessories category chip via taxonomy keywords", async () => {
    const { body } = await get(`q=${W}&type=products&style=accessories`);
    expect(names(body.sections.products.items)).toEqual([`Super${W} Cap`]);
  });

  it("chip filter leaves brands/people/posts untouched", async () => {
    const { body } = await get(`q=${W}&style=vintage`);
    expect(body.sections.products.items.length).toBe(1);
    expect(body.sections.brands.items.length).toBe(2);
  });

  it("applies the filter sheet's product filters alongside the chip", async () => {
    const all = await get(`q=${W}&type=products&limit=50`);
    expect((await get(`q=${W}&type=products&limit=50&size=M&color=black&inStock=1`)).body.sections.products.items.length)
      .toBe(all.body.sections.products.items.length);
    expect((await get(`q=${W}&type=products&size=XL`)).body.sections.products.items).toEqual([]);
    expect((await get(`q=${W}&type=products&minPriceCents=4001`)).body.sections.products.items).toEqual([]);
    expect(names((await get(`q=${W}&type=products&style=streetwear&maxPriceCents=4000`)).body.sections.products.items)).toHaveLength(2);
    expect((await get(`q=${W}&type=products&sort=newest`)).status).toBe(200);
    expect((await get(`q=${W}&type=products&sort=cheapest`)).status).toBe(400);
    expect((await get(`q=${W}&type=products&minPriceCents=9&maxPriceCents=1`)).status).toBe(400);
  });

  it("a chip with no query browses that style's products", async () => {
    const { status, body } = await get(`style=vintage&type=products&limit=50`);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(names(body.sections.products.items)).toContain(`Washed ${W} Tee`);
    expect(body.sections.brands).toBeUndefined();
  });

  it("validates input", async () => {
    expect((await get(`q=${W}&type=nope`)).status).toBe(400);
    expect((await get(`q=${W}&style=nope`)).status).toBe(400);
    expect((await get(`q=${W}&limit=-1`)).status).toBe(400);
    const short = await get("q=a");
    expect(short.status).toBe(200);
    expect(short.body.sections).toEqual({});
  });
});
