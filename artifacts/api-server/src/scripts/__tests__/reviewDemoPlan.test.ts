import { describe, expect, it } from "vitest";
import {
  DEMO_ORDERS,
  DEMO_POSTS,
  buildProducts,
  checkRunGuard,
  orderTotals,
  parseFlags,
  readDemoEnv,
  renderNotes,
  summarize,
} from "../reviewDemo/plan";

const goodEnv = {
  REVIEW_DEMO_BUYER_EMAIL: "Buyer@Reviewers.Example.com",
  REVIEW_DEMO_BUYER_PASSWORD: "a-long-enough-pass-1",
  REVIEW_DEMO_SELLER_EMAIL: "seller@reviewers.example.com",
  REVIEW_DEMO_SELLER_PASSWORD: "another-long-pass-2",
};

describe("readDemoEnv", () => {
  it("accepts a complete env and lowercases emails", () => {
    const r = readDemoEnv(goodEnv);
    expect(r.ok).toBe(true);
    expect(r.env?.buyerEmail).toBe("buyer@reviewers.example.com");
    expect(r.env?.assetBaseUrl).toBeNull();
  });
  it("requires every secret and never defaults one", () => {
    const r = readDemoEnv({});
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });
  it("rejects short passwords, identical emails and reserved test TLDs", () => {
    expect(readDemoEnv({ ...goodEnv, REVIEW_DEMO_BUYER_PASSWORD: "short" }).ok).toBe(false);
    expect(readDemoEnv({ ...goodEnv, REVIEW_DEMO_SELLER_EMAIL: goodEnv.REVIEW_DEMO_BUYER_EMAIL }).ok).toBe(false);
    expect(readDemoEnv({ ...goodEnv, REVIEW_DEMO_SELLER_EMAIL: "x@foo.test" }).ok).toBe(false);
  });
  it("requires https asset base and trims trailing slashes", () => {
    expect(readDemoEnv({ ...goodEnv, REVIEW_DEMO_ASSET_BASE_URL: "http://x.com" }).ok).toBe(false);
    expect(readDemoEnv({ ...goodEnv, REVIEW_DEMO_ASSET_BASE_URL: "https://cdn.x.com/a/" }).env?.assetBaseUrl).toBe("https://cdn.x.com/a");
  });
});

describe("run guard", () => {
  it("refuses to write without --confirm-production", () => {
    expect(checkRunGuard(parseFlags([]))).toHaveProperty("error");
  });
  it("allows dry-run and confirmed runs", () => {
    expect(checkRunGuard(parseFlags(["--dry-run"]))).toEqual({ mode: "dry-run" });
    expect(checkRunGuard(parseFlags(["--confirm-production"]))).toEqual({ mode: "write" });
  });
  it("dry-run wins even alongside --confirm-production", () => {
    expect(checkRunGuard(parseFlags(["--dry-run", "--confirm-production"]))).toEqual({ mode: "dry-run" });
  });
});

describe("catalogue", () => {
  const products = buildProducts(null);
  it("has 8-12 products with images, prices and variants", () => {
    expect(products.length).toBeGreaterThanOrEqual(8);
    expect(products.length).toBeLessThanOrEqual(12);
    for (const p of products) {
      expect(p.images.length).toBeGreaterThan(0);
      expect(p.variants.length).toBeGreaterThan(0);
      for (const v of p.variants) expect(v.priceCents).toBeGreaterThan(0);
    }
  });
  it("has globally unique, deterministic SKUs (idempotency keys)", () => {
    const skus = products.flatMap((p) => p.variants.map((v) => v.sku));
    expect(new Set(skus).size).toBe(skus.length);
    expect(buildProducts(null).flatMap((p) => p.variants.map((v) => v.sku))).toEqual(skus);
  });
  it("uses the asset base URL when provided", () => {
    expect(buildProducts("https://cdn.x.com")[0].images[0]).toMatch(/^https:\/\/cdn\.x\.com\//);
  });
});

describe("orders and summary", () => {
  it("covers varied states with unique order numbers", () => {
    expect(new Set(DEMO_ORDERS.map((o) => o.status)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(DEMO_ORDERS.map((o) => o.orderNumber)).size).toBe(DEMO_ORDERS.length);
  });
  it("every order points at a real product and variant", () => {
    const byKey = new Map(buildProducts(null).map((p) => [p.key, p]));
    for (const o of DEMO_ORDERS) expect(byKey.get(o.productKey)?.variants[o.variantIndex]).toBeDefined();
  });
  it("only delivered orders carry reviews, and ratings are 1-5", () => {
    for (const o of DEMO_ORDERS.filter((x) => x.review)) {
      expect(o.status).toBe("fulfilled");
      expect(o.review!.rating).toBeGreaterThanOrEqual(1);
      expect(o.review!.rating).toBeLessThanOrEqual(5);
    }
  });
  it("computes totals and marks cancelled orders unpaid", () => {
    expect(orderTotals(1000, 2, "shipped")).toMatchObject({ subtotalCents: 2000, totalCents: 2600, paid: true });
    expect(orderTotals(1000, 1, "cancelled").paid).toBe(false);
  });
  it("summarizes the plan", () => {
    const s = summarize(null);
    expect(s).toMatchObject({ users: 2, orders: DEMO_ORDERS.length, posts: DEMO_POSTS.length, follows: 1 });
    expect(s.reviews).toBe(DEMO_ORDERS.filter((o) => o.review).length);
  });
});

describe("renderNotes", () => {
  it("fills credential placeholders and leaves unknown ones alone", () => {
    const env = readDemoEnv(goodEnv).env!;
    const out = renderNotes("{{REVIEW_DEMO_BUYER_EMAIL}} / {{REVIEW_DEMO_SELLER_PASSWORD}} / {{OTHER}}", env);
    expect(out).toBe("buyer@reviewers.example.com / another-long-pass-2 / {{OTHER}}");
  });
});
