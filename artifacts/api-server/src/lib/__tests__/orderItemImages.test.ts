import { beforeEach, describe, expect, it, vi } from "vitest";

// One queued result per query; every select records its joins + filter so the
// tests can assert a single query (no N+1) per call.
const state = vi.hoisted(() => ({
  results: [] as unknown[][],
  queries: [] as Array<{ joins: string[]; where: unknown; limit?: number }>,
  signed: [] as string[],
  failQuery: false,
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  inArray: (col: unknown, values: unknown[]) => ({ inArray: [col, values] }),
}));

vi.mock("@workspace/db", () => {
  const table = (name: string) => new Proxy({}, { get: (_t, key) => `${name}.${String(key)}` });
  const tableName = (t: unknown) => String((t as any).anyColumn).split(".")[0];
  const select = () => {
    const query: { joins: string[]; where: unknown; limit?: number } = { joins: [], where: null };
    const run = () => {
      if (state.failQuery) return Promise.reject(new Error("db down"));
      state.queries.push(query);
      return Promise.resolve(state.results.shift() ?? []);
    };
    const chain: any = {
      from: () => chain,
      leftJoin: (t: unknown) => { query.joins.push(`left:${tableName(t)}`); return chain; },
      innerJoin: (t: unknown) => { query.joins.push(`inner:${tableName(t)}`); return chain; },
      where: (w: unknown) => { query.where = w; return chain; },
      limit: (n: number) => { query.limit = n; return run(); },
      then: (resolve: any, reject: any) => run().then(resolve, reject),
    };
    return chain;
  };
  return {
    db: { select },
    orderItems: table("orderItems"),
    productVariants: table("productVariants"),
    products: table("products"),
  };
});

vi.mock("../objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) {
      state.signed.push(path);
      if (path.includes("broken")) throw new Error("missing object");
      return `https://signed.example${path}`;
    }
  },
}));

vi.mock("../logger", () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));
vi.mock("../activityEvents", () => ({
  productThumbnail: (images: unknown) =>
    Array.isArray(images) ? images.find((v) => typeof v === "string" && v.length > 0) ?? null : null,
}));

import {
  ORDER_LIST_THUMB_LIMIT,
  loadOrderListThumbs,
  orderThumbnailPath,
  signProductImage,
  withItemImages,
  withOrderImage,
} from "../orderItemImages";

beforeEach(() => {
  state.results = [];
  state.queries = [];
  state.signed = [];
  state.failQuery = false;
});

describe("signProductImage", () => {
  it("signs private object paths, passes public URLs through and drops anything else", async () => {
    expect(await signProductImage("/objects/uploads/a")).toBe("https://signed.example/objects/uploads/a");
    expect(await signProductImage("https://cdn.example/a.jpg")).toBe("https://cdn.example/a.jpg");
    expect(await signProductImage("file:///local.jpg")).toBeNull();
    expect(await signProductImage(null)).toBeNull();
    expect(await signProductImage("/objects/broken")).toBeNull();
  });
});

describe("withItemImages (order detail)", () => {
  it("adds productId and a signed first product image per line in one query", async () => {
    state.results.push([
      { id: "v1", productId: "p1", images: ["/objects/uploads/tee", "/objects/uploads/tee-back"] },
      { id: "v2", productId: "p2", images: [] },
    ]);
    const items = await withItemImages([
      { id: "l1", variantId: "v1", productName: "Tee" },
      { id: "l2", variantId: "v1", productName: "Tee again" },
      { id: "l3", variantId: "v2", productName: "No photo" },
      { id: "l4", variantId: null, productName: "Deleted variant" },
    ]);
    expect(items).toEqual([
      { id: "l1", variantId: "v1", productName: "Tee", productId: "p1", imageUrl: "https://signed.example/objects/uploads/tee" },
      { id: "l2", variantId: "v1", productName: "Tee again", productId: "p1", imageUrl: "https://signed.example/objects/uploads/tee" },
      { id: "l3", variantId: "v2", productName: "No photo", productId: "p2", imageUrl: null },
      { id: "l4", variantId: null, productName: "Deleted variant", productId: null, imageUrl: null },
    ]);
    expect(state.queries).toHaveLength(1);
    expect(state.queries[0].joins).toEqual(["left:products"]);
    // Each distinct image is signed once.
    expect(state.signed).toEqual(["/objects/uploads/tee"]);
  });

  it("skips the query when no line has a variant", async () => {
    expect(await withItemImages([{ id: "l1", variantId: null }])).toEqual([
      { id: "l1", variantId: null, productId: null, imageUrl: null },
    ]);
    expect(state.queries).toHaveLength(0);
  });
});

describe("loadOrderListThumbs (order lists)", () => {
  const row = (orderId: string, id: string, images: unknown, productId: string | null = `p-${id}`) => ({
    id, orderId, productName: `Item ${id}`, variantLabel: "M", quantity: 1, priceCents: 1500, productId, images,
  });

  it("groups compact lines per order with thumbnails on the first four, in one query", async () => {
    state.results.push([
      row("o1", "a", ["/objects/uploads/a"]),
      row("o1", "b", null, null),
      row("o1", "c", ["https://cdn.example/c.jpg"]),
      row("o1", "d", ["/objects/uploads/a"]),
      row("o1", "e", ["/objects/uploads/e"]),
      row("o2", "f", []),
    ]);
    const map = await loadOrderListThumbs(["o1", "o2", "o3"]);
    expect(state.queries).toHaveLength(1);

    const o1 = map.get("o1")!;
    expect(o1.items).toHaveLength(5);
    expect(o1.items.map((i) => i.imageUrl)).toEqual([
      "https://signed.example/objects/uploads/a",
      null,
      "https://cdn.example/c.jpg",
      "https://signed.example/objects/uploads/a",
      null, // fifth line: beyond ORDER_LIST_THUMB_LIMIT, never signed
    ]);
    expect(o1.items[0]).toEqual({
      id: "a", productId: "p-a", productName: "Item a", variantLabel: "M", quantity: 1, priceCents: 1500,
      imageUrl: "https://signed.example/objects/uploads/a",
    });
    expect(o1.thumbnailUrl).toBe("https://signed.example/objects/uploads/a");
    expect(state.signed).toEqual(["/objects/uploads/a"]);

    expect(map.get("o2")).toEqual({ items: [expect.objectContaining({ id: "f", imageUrl: null })], thumbnailUrl: null });
    expect(map.has("o3")).toBe(false);
    expect(ORDER_LIST_THUMB_LIMIT).toBe(4);
  });

  it("caps the returned lines when itemLimit is set", async () => {
    state.results.push([row("o1", "a", []), row("o1", "b", []), row("o1", "c", [])]);
    const map = await loadOrderListThumbs(["o1"], { itemLimit: 2 });
    expect(map.get("o1")!.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("returns an empty map for no orders", async () => {
    expect((await loadOrderListThumbs([])).size).toBe(0);
    expect(state.queries).toHaveLength(0);
  });
});

describe("notification thumbnails", () => {
  it("orderThumbnailPath returns the first raw product image (unsigned; the feed signs on read)", async () => {
    state.results.push([{ images: [] }, { images: ["/objects/uploads/hoodie"] }]);
    expect(await orderThumbnailPath("o1")).toBe("/objects/uploads/hoodie");
    expect(state.signed).toEqual([]);
    expect(state.queries[0].limit).toBe(ORDER_LIST_THUMB_LIMIT);
    expect(state.queries[0].joins).toEqual(["inner:productVariants", "inner:products"]);
  });

  it("orderThumbnailPath never throws", async () => {
    state.failQuery = true;
    await expect(orderThumbnailPath("o1")).resolves.toBeNull();
  });

  it("withOrderImage fills targetImageUrl and keeps an explicit one", async () => {
    const base = { userId: "b1", category: "orders", type: "order_shipped", title: "Shipped", targetId: "o1", targetType: "buyer_order" };
    state.results.push([{ images: ["/objects/uploads/tee"] }]);
    expect(await withOrderImage("o1", base)).toEqual({ ...base, targetImageUrl: "/objects/uploads/tee" });

    expect(await withOrderImage("o1", { ...base, targetImageUrl: "https://x/y.jpg" }))
      .toEqual({ ...base, targetImageUrl: "https://x/y.jpg" });

    state.results.push([]);
    expect(await withOrderImage("o1", base)).toEqual(base);
  });
});
