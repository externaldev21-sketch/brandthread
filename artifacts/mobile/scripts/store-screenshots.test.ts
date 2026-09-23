import { describe, expect, it } from "vitest";
import { DEVICES, pixelSize } from "./store-screenshots/devices.mjs";
import { SCREENS } from "./store-screenshots/capture.mjs";
import {
  CART,
  DEMO_NOW,
  PUBLIC_PRODUCTS,
  SELLER_PRODUCTS,
  checkoutSession,
  localStorageSeed,
  manySellerProducts,
  respond,
} from "./store-screenshots/demo-data.mjs";
import { clerkStubScript } from "./store-screenshots/clerk-stub.mjs";

const get = (path: string, role: "buyer" | "seller" = "buyer", options = {}) =>
  respond({ method: "GET", path, query: new URLSearchParams(), role, options });

describe("store screenshot sizes", () => {
  it("renders the exact pixel sizes App Store Connect and Play Console accept", () => {
    const sizes = Object.fromEntries(DEVICES.map((d: { id: string }) => [d.id, pixelSize(d)]));
    expect(sizes["iphone-6.9in"]).toEqual({ width: 1320, height: 2868 });
    expect(sizes["ipad-13in"]).toEqual({ width: 2064, height: 2752 });
    expect(sizes["android-phone"]).toEqual({ width: 1080, height: 1920 });
    for (const { width, height } of Object.values(sizes) as Array<{ width: number; height: number }>) {
      // Play: each side 320–3840 px, long side at most twice the short side.
      expect(Math.min(width, height)).toBeGreaterThanOrEqual(320);
      expect(Math.max(width, height)).toBeLessThanOrEqual(3840);
      expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(2.2);
    }
  });

  it("covers every screen the listing needs, with unique ids", () => {
    const ids = SCREENS.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining([
      "buyer-feed", "product-sheet", "discover", "cart", "checkout", "seller-dashboard", "manufacturer-hub", "theme-picker",
    ]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(SCREENS.length).toBeLessThanOrEqual(10); // App Store limit per device
  });
});

describe("demo data", () => {
  it("keeps every amount in integer cents (lib/money.ts throws otherwise)", () => {
    const amounts = [
      ...PUBLIC_PRODUCTS.flatMap((p: any) => [p.priceCents, p.currentPriceCents, ...p.variants.map((v: any) => v.priceCents)]),
      ...SELLER_PRODUCTS.map((p: any) => p.pricing.priceCents),
      ...CART.items.map((i: any) => i.priceCents),
      ...(get("/api/v1/orders", "seller") as any[]).map((o) => o.totalCents),
      (get("/api/v1/analytics/home", "seller") as any).totalCents,
      checkoutSession().summary.totalCents,
    ];
    for (const cents of amounts) expect(Number.isSafeInteger(cents)).toBe(true);
  });

  it("adds up the checkout summary from the cart", () => {
    const { summary, deliveryGroups } = checkoutSession();
    const subtotal = CART.items.reduce((sum: number, item: any) => sum + item.priceCents * item.quantity, 0);
    expect(summary.subtotalCents).toBe(subtotal);
    expect(summary.totalCents).toBe(subtotal + summary.shippingTotalCents);
    expect(deliveryGroups).toHaveLength(new Set(CART.items.map((i: any) => i.sellerId)).size);
  });

  it("answers every request the captured screens make", () => {
    for (const path of [
      "/api/v1/auth/me", "/api/v1/config/features", "/api/v1/public/products/high-demand", "/api/v1/public/products",
      "/api/v1/public/drops", "/api/v1/public/trending", "/api/v1/public/posts", "/api/v1/buyer/cart",
      `/api/v1/public/products/${PUBLIC_PRODUCTS[0].id}`, `/api/v1/public/products/${PUBLIC_PRODUCTS[0].id}/related`,
    ]) expect(get(path), path).toBeDefined();
    for (const path of [
      "/api/v1/analytics/home", "/api/v1/finance/balance", "/api/v1/orders", "/api/v1/conversations",
      "/api/v1/manufacturers/public", "/api/v1/manufacturers/threads", "/api/v1/seller-hub/quote-requests", "/api/v1/sample-orders",
    ]) expect(get(path, "seller"), path).toBeDefined();
    expect(get("/api/v1/something-new")).toBeUndefined();
  });

  it("uses canonical UUIDs for manufacturers (the hub rejects anything else)", () => {
    for (const m of get("/api/v1/manufacturers/public", "seller") as any[]) {
      expect(m.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
  });

  it("is pinned to one moment so every run produces identical screenshots", () => {
    const first = JSON.stringify(get("/api/v1/orders", "seller"));
    expect(JSON.stringify(get("/api/v1/orders", "seller"))).toBe(first);
    for (const order of get("/api/v1/orders", "seller") as any[]) expect(Date.parse(order.createdAt)).toBeLessThanOrEqual(DEMO_NOW);
  });

  it("scales lists for performance runs", () => {
    expect(manySellerProducts(400)).toHaveLength(400);
    expect(new Set(manySellerProducts(400).map((p: any) => p.id)).size).toBe(400);
    expect(get("/api/v1/orders", "seller", { orderCount: 400 })).toHaveLength(400);
    expect(JSON.parse(localStorageSeed("seller", { productCount: 50 })["@brandthread/products"])).toHaveLength(50);
  });

  it("seeds cookie consent so the banner never covers a screenshot", () => {
    for (const role of ["buyer", "seller"] as const) expect(localStorageSeed(role)).toHaveProperty("bt:cookie-consent");
  });
});

describe("Clerk stand-in", () => {
  it("never contains a real key or token", () => {
    const script = clerkStubScript({ id: "user_demo", firstName: "A", lastName: "B", username: "ab", email: "a@example.com", imageUrl: "" });
    expect(script).toContain("demo-token");
    expect(script).not.toMatch(/sk_(live|test)_|pk_live_/);
    expect(script).toContain("__internal_lastEmittedResources");
  });
});
