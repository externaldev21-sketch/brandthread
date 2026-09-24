import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  or: (...conditions: unknown[]) => conditions,
  asc: (value: unknown) => value,
  desc: (value: unknown) => value,
  ne: (...values: unknown[]) => values,
  eq: (...values: unknown[]) => values,
  ilike: (...values: unknown[]) => values,
  inArray: (...values: unknown[]) => values,
  notInArray: (...values: unknown[]) => values,
  isNull: (value: unknown) => value,
  isNotNull: (value: unknown) => value,
  gte: (...values: unknown[]) => values,
  lte: (...values: unknown[]) => values,
  count: () => "count(*)",
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ kind: "sql", strings: Array.from(strings), values }),
    { raw: (s: string) => s },
  ),
}));

// A minimal thenable query-builder stand-in supporting whatever chain of
// join/where/groupBy/orderBy/limit/having calls a route makes; each fresh
// `db.select()` call consumes the next queued result set.
function chainable(rows: unknown[]) {
  const obj: any = {
    from: () => obj,
    innerJoin: () => obj,
    leftJoin: () => obj,
    where: () => obj,
    groupBy: () => obj,
    having: () => obj,
    orderBy: () => obj,
    limit: () => obj,
    offset: () => obj,
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
    catch: (reject: (e: unknown) => void) => Promise.resolve(rows).catch(reject),
  };
  return obj;
}

vi.mock("@workspace/db", () => {
  const table = (name: string) => ({ name });
  return {
    db: {
      select: () => chainable(state.selectQueue.shift() ?? []),
    },
    products:              table("products"),
    productVariants:       table("productVariants"),
    users:                 table("users"),
    drops:                 table("drops"),
    dropAlertSubscriptions: table("dropAlertSubscriptions"),
    posts:                 table("posts"),
    postTaggedProducts:    table("postTaggedProducts"),
    postComments:          table("postComments"),
    interactions:          table("interactions"),
    storefrontVisits:      table("storefrontVisits"),
    trendingCache:         table("trendingCache"),
    boosts:                table("boosts"),
    orders:                table("orders"),
    orderItems:            table("orderItems"),
    follows:               table("follows"),
    blocks:                table("blocks"),
    mutedWords:            table("mutedWords"),
    reports:               table("reports"),
  };
});

vi.mock("../../lib/contentModerator", () => ({
  matchesMutedWords: () => false,
}));

import publicRouter from "../public";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: (...args: unknown[]) => console.error(...args), info: () => {} };
    next();
  });
  app.use("/api/public", publicRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.selectQueue = [];
});

describe("search empty-state endpoints", () => {
  it("returns trending categories and brands", async () => {
    state.selectQueue = [
      [{ category: "apparel", count: 12 }, { category: "accessories", count: 4 }], // topCategories
      [{ sellerId: "seller-1", followerCount: 9 }], // topBrands
      [{ clerkId: "seller-1", displayName: "Seller One", brandName: "Brand One" }], // brandRows
    ];

    const response = await fetch(`${base}/api/public/search/trending?limit=5`);
    const body = await response.text();
    expect(response.status, body).toBe(200);
    const json = JSON.parse(body);
    expect(json.trending).toEqual(
      expect.arrayContaining([
        { term: "apparel", type: "category" },
        { term: "accessories", type: "category" },
        { term: "Brand One", type: "brand" },
      ]),
    );
  });

  it("returns an empty trending list gracefully when there is no data yet", async () => {
    state.selectQueue = [[], [], []];
    const response = await fetch(`${base}/api/public/search/trending`);
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(JSON.parse(body)).toEqual({ trending: [] });
  });

  it("rejects a non-positive limit", async () => {
    const response = await fetch(`${base}/api/public/search/trending?limit=0`);
    expect(response.status).toBe(400);
  });

  it("returns suggested brands and products for the empty search state", async () => {
    state.selectQueue = [
      [{ sellerId: "seller-1", followerCount: 20 }], // topBrands
      [{ id: "product-1", name: "New Jacket", ownerId: "seller-1", category: "apparel", images: ["img.jpg"], createdAt: new Date() }], // recentProducts
      [{ clerkId: "seller-1", displayName: "Seller One", brandName: "Brand One" }], // sellerRows
    ];

    const response = await fetch(`${base}/api/public/search/suggested?limit=6`);
    const body = await response.text();
    expect(response.status, body).toBe(200);
    const json = JSON.parse(body);
    expect(json.brands).toHaveLength(1);
    expect(json.brands[0]).toMatchObject({ sellerId: "seller-1", name: "Brand One", followerCount: 20 });
    expect(json.products).toHaveLength(1);
    expect(json.products[0]).toMatchObject({ id: "product-1", name: "New Jacket", brand: "Brand One", imageUri: "img.jpg" });
  });
});
