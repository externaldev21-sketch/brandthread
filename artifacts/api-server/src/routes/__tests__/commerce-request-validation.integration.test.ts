/**
 * Request-body schemas on the commerce routes: malformed bodies are refused
 * with 400 VALIDATION_ERROR before any handler logic runs, and the payloads
 * the mobile app actually sends (shapes copied from artifacts/mobile —
 * lib/api.ts, app/add-product.tsx, app/order-detail.tsx, services/*.ts, ...)
 * still get through to the handler.
 *
 * "Gets through" is asserted as "not a VALIDATION_ERROR": most good payloads
 * here target ids that don't exist, so the handler answers 404 without
 * writing anything; the few creates write rows owned by the seeded
 * @example.test user, which vitest.setup.ts's purge sweeps up.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, users, orders, orderItems, products, productVariants, discountCodes } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.headers["x-test-user"];
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => {
  const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return { teamContext: pass, requireRole: pass, requirePermission: pass, requirePayoutsRead: pass };
});
vi.mock("../notifications-feed", () => ({ publishNotification: vi.fn(async () => {}) }));

const suffix = crypto.randomBytes(6).toString("hex");
const SELLER = `valcom-seller-${suffix}`;
const MISSING = crypto.randomUUID();

let server: Server;
let base = "";

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": SELLER },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, body: json };
}

async function expectRejected(method: string, path: string, body: unknown) {
  const res = await call(method, path, body);
  expect(res.status, `${method} ${path} ${JSON.stringify(body).slice(0, 120)} → ${JSON.stringify(res.body)}`).toBe(400);
  expect(res.body?.code).toBe("VALIDATION_ERROR");
}

async function expectAccepted(method: string, path: string, body: unknown) {
  const res = await call(method, path, body);
  expect(res.body?.code, `${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`).not.toBe("VALIDATION_ERROR");
  return res;
}

beforeAll(async () => {
  await db.insert(users).values({
    clerkId: SELLER, email: `${SELLER}@example.test`, name: "Validation Seller",
    displayName: "Validation Seller", accountType: "seller", onboardingComplete: true,
  });

  const routers = await Promise.all([
    import("../orders"), import("../products"), import("../product-variants"), import("../product-bulk"),
    import("../store"), import("../returns"), import("../cart-db"), import("../saved"), import("../collections"),
    import("../product-qa"), import("../finance"), import("../connect"), import("../seller-profile"),
    import("../discount-codes"), import("../drops"), import("../sales"), import("../shipping-labels"),
    import("../return-labels"), import("../shipping-rates"), import("../shipping-zones"),
    import("../package-presets"), import("../reviews"),
  ]);
  const mounts = [
    "/api/orders", "/api/products", "/api/product-variants", "/api/product-bulk",
    "/api/store", "/api/returns", "/api/buyer/cart", "/api/buyer/saved", "/api/buyer/collections",
    "/api/product-qa", "/api/finance", "/api/seller/connect", "/api/seller",
    "/api/discount-codes", "/api/drops", "/api/sales", "/api/shipping-labels",
    "/api/return-labels", "/api/shipping-rates", "/api/shipping-zones",
    "/api/package-presets", "/api/reviews",
  ];
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  // Order matters as in routes/index.ts: the connect router before /api/seller.
  routers.forEach((mod, i) => app.use(mounts[i], mod.default));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  const orderRows = await db.select({ id: orders.id }).from(orders).where(eq(orders.ownerId, SELLER));
  if (orderRows.length) {
    await db.delete(orderItems).where(inArray(orderItems.orderId, orderRows.map((o) => o.id)));
    await db.delete(orders).where(eq(orders.ownerId, SELLER));
  }
  const productRows = await db.select({ id: products.id }).from(products).where(eq(products.ownerId, SELLER));
  if (productRows.length) {
    await db.delete(productVariants).where(inArray(productVariants.productId, productRows.map((p) => p.id)));
    await db.delete(products).where(eq(products.ownerId, SELLER));
  }
  await db.delete(discountCodes).where(eq(discountCodes.sellerId, SELLER));
  await db.delete(users).where(eq(users.clerkId, SELLER));
});

describe("orders", () => {
  it("status / tracking / items-tracking / checklist", async () => {
    const path = `/api/orders/${MISSING}`;
    await expectRejected("PATCH", `${path}/status`, { status: 5 });
    await expectRejected("PATCH", `${path}/status`, { status: "cancelled", reason: "other", notes: "x".repeat(2_001) });
    await expectAccepted("PATCH", `${path}/status`, { status: "cancelled", reason: "customer_request", notes: "Buyer asked" });
    await expectAccepted("PATCH", `${path}/status`, { status: "shipped" });

    await expectRejected("PATCH", `${path}/tracking`, { trackingNumber: 123 });
    await expectRejected("PATCH", `${path}/tracking`, { trackingNumber: "1Z", carrier: { name: "UPS" } });
    await expectAccepted("PATCH", `${path}/tracking`, { trackingNumber: "1Z999AA10123456784", carrier: "UPS" });
    await expectAccepted("PATCH", `${path}/tracking`, { trackingStatus: "in_transit", estimatedDelivery: null });

    await expectRejected("PATCH", `${path}/items-tracking`, { itemIds: "item-1", trackingNumber: "1Z" });
    await expectRejected("PATCH", `${path}/items-tracking`, {
      itemIds: Array.from({ length: 501 }, (_, i) => `item-${i}`), trackingNumber: "1Z",
    });
    await expectAccepted("PATCH", `${path}/items-tracking`, { itemIds: [crypto.randomUUID()], trackingNumber: "1Z", carrier: "USPS" });

    await expectRejected("PATCH", `${path}/fulfillment-checklist`, { isPicked: "yes" });
    await expectAccepted("PATCH", `${path}/fulfillment-checklist`, { isPicked: true });
  });

  it("seller manual order money fields are bounded integer cents", async () => {
    await expectRejected("POST", "/api/orders", { items: [{ productName: "Custom", quantity: 1, priceCents: -500 }] });
    await expectRejected("POST", "/api/orders", { items: [{ productName: "Custom", quantity: 1, priceCents: 1_000 }], shippingCents: "abc" });
    await expectRejected("POST", "/api/orders", { items: [{ productName: "Custom", quantity: 1, priceCents: 1_000 }], shippingCents: 1e12 });
    await expectRejected("POST", "/api/orders", { items: [{ productName: "Custom", quantity: 1.5, priceCents: 1_000 }] });
    await expectRejected("POST", "/api/orders", { items: "Custom" });
    const created = await expectAccepted("POST", "/api/orders", {
      items: [{ productName: "Custom piece", quantity: "2", priceCents: "1500" }],
      shippingCents: 500,
      notes: "Paid in person",
      shippingAddress: { name: "Buyer", street: "1 Test St", city: "Austin", state: "TX", zip: "78701", country: "US" },
    });
    expect(created.status).toBe(201);
    expect(created.body.totalCents).toBe(3_500);
  });

  it("rejects an oversized id param", async () => {
    await expectRejected("PATCH", `/api/orders/${"a".repeat(201)}/status`, { status: "shipped" });
  });
});

describe("products and variants", () => {
  it("create/update accept the add-product screen payloads", async () => {
    await expectRejected("POST", "/api/products", { name: "Tee", images: "https://img" });
    await expectRejected("POST", "/api/products", { name: "Tee", tags: [1, 2] });
    await expectRejected("POST", "/api/products", { name: "Tee", variants: [{ sku: "A", priceCents: "1000" }] });
    await expectRejected("POST", "/api/products", { name: "x".repeat(301) });
    // app/add-product.tsx serverCreatePayload
    await expectAccepted("POST", "/api/products", {
      name: `Validated Tee ${suffix}`,
      description: "Heavyweight cotton",
      category: "tops",
      status: "draft",
      images: ["/objects/uploads/abc.jpg"],
      tags: ["tee"],
      styleTags: ["streetwear"],
      variants: [{ size: "M", color: "Black", sku: `VT-${suffix}`, priceCents: 3_500, stock: 4, lowStockThreshold: 5, compareAtPriceCents: 4_000 }],
      isPreOrder: false,
    });
    await expectRejected("PUT", `/api/products/${MISSING}`, { compareAtPriceCents: "40" });
    // app/add-product.tsx serverUpdatePayload (+ seller-drop-create's dropId: null)
    await expectAccepted("PUT", `/api/products/${MISSING}`, {
      name: "Tee", description: null, category: "tops", status: "draft", images: [], tags: [], styleTags: [],
      sizeChartImageUrl: null, compareAtPriceCents: null, isPreOrder: false,
    });
    await expectAccepted("PUT", `/api/products/${MISSING}`, { dropId: null });

    await expectRejected("POST", `/api/products/${MISSING}/variants`, { sku: "A", priceCents: 10.5 });
    await expectAccepted("POST", `/api/products/${MISSING}/variants`, { sku: "A", priceCents: 1_000 });
    await expectRejected("PATCH", `/api/products/${MISSING}/variants/${MISSING}`, { priceCents: -1 });
    await expectAccepted("PATCH", `/api/products/${MISSING}/variants/${MISSING}`, { stock: 3, priceCents: 1_200 });

    await expectRejected("POST", "/api/products/import", { rows: "name,price" });
    await expectRejected("POST", "/api/products/import", { rows: [{ name: { first: "Tee" } }] });
  });

  it("variant matrix, bulk edits and stock rules", async () => {
    const p = `/api/product-variants/${MISSING}`;
    await expectRejected("PUT", `${p}/axes`, { axes: "Size" });
    await expectAccepted("PUT", `${p}/axes`, { axes: [{ name: "Size", values: ["S", "M"] }] });
    await expectRejected("POST", `${p}/generate`, { stock: "5" });
    await expectAccepted("POST", `${p}/generate`, { priceCents: 2_000, stock: 5 });
    await expectRejected("PATCH", `${p}/variants/bulk`, { updates: [{ variantId: 5 }] });
    await expectAccepted("PATCH", `${p}/variants/bulk`, { updates: [{ variantId: MISSING, priceCents: 1_500, stock: 2, sku: "A-1" }] });
    await expectRejected("PUT", `${p}/stock-rules`, { limitedQuantityEnabled: "yes" });
    await expectAccepted("PUT", `${p}/stock-rules`, {
      productId: MISSING, soldOutBehavior: "show", lowStockThresholdDefault: null, limitedQuantityEnabled: false,
      limitedQuantityTotal: null, showRemainingCounter: false, counterThreshold: null, applyLowStockToVariants: false,
    });

    await expectRejected("POST", "/api/product-bulk/price", { productIds: [MISSING], change: "10%" });
    await expectAccepted("POST", "/api/product-bulk/price", {
      productIds: [MISSING], change: { mode: "percent", direction: "decrease", value: 1_000 }, rounding: "end_99", compareAt: "previous", preview: true,
    });
    await expectRejected("POST", "/api/product-bulk/status", { productIds: MISSING, status: "draft" });
    await expectAccepted("POST", "/api/product-bulk/status", { productIds: [MISSING], status: "draft" });
    await expectRejected("POST", "/api/product-bulk/duplicate", { productIds: [MISSING], copyInventory: "yes" });
    await expectAccepted("POST", "/api/product-bulk/duplicate", { productIds: [MISSING], copyInventory: true });
  });
});

describe("storefront", () => {
  it("save, versions and domains", async () => {
    await expectRejected("PUT", "/api/store", { sections: "hero" });
    await expectRejected("PUT", "/api/store", { title: 5 });
    // services/storeService.ts saveStorefront + saveVersion payloads
    await expectAccepted("PUT", "/api/store", {
      title: "My Store", description: "My Store",
      theme: { primaryColor: "#000000", secondaryColor: "#ffffff", accentColor: "#111111", backgroundColor: "#fff", textColor: "#000", fontFamily: "Inter", borderRadius: 8 },
      branding: { tagline: "My Store", logoUrl: "", targetAudience: "" },
    });
    await expectAccepted("PUT", "/api/store", {
      sections: [{ id: "s1", type: "hero", visible: true, settings: { title: "Hi" } }],
      branding: { colors: { primary: "#000" }, typography: { headingFont: "Inter" } },
      theme: { themeId: "minimal" },
    });
    await expectRejected("POST", "/api/store/versions", { label: 5 });
    await expectAccepted("POST", "/api/store/versions", { label: "Applied theme: Minimal", snapshot: { themeSettings: { themeId: "minimal" } } });
    await expectRejected("POST", "/api/store/domains", { domain: `${"a".repeat(250)}.com` });
  });
});

describe("returns and labels", () => {
  it("buyer return request and seller decision", async () => {
    await expectRejected("POST", "/api/returns", { orderId: MISSING, reason: "Damaged", evidenceUrls: "/objects/a.jpg" });
    await expectRejected("POST", "/api/returns", { orderId: MISSING, reason: "x".repeat(501) });
    // services/cartService.ts return request
    const res = await expectAccepted("POST", "/api/returns", {
      orderId: MISSING, reason: "Damaged", notes: "Seam ripped", resolutionRequested: "refund", evidenceUrls: [],
      requestedItems: [{ lineItemId: MISSING, productName: "Tee", variantTitle: "M", quantity: 1, unitPriceCents: 2_500 }],
    });
    expect(res.status).toBe(404);

    await expectRejected("PATCH", `/api/returns/${MISSING}/status`, { status: "approved", refundAmountCents: -5 });
    await expectRejected("PATCH", `/api/returns/${MISSING}/status`, { status: "approved", refundAmountCents: 10.5 });
    await expectAccepted("PATCH", `/api/returns/${MISSING}/status`, { status: "approved", sellerResponse: "Sorry about that" });

    await expectRejected("POST", `/api/return-labels/${MISSING}`, { returnAddress: "1 Main St" });
    await expectAccepted("POST", `/api/return-labels/${MISSING}`, {
      returnAddress: { name: "Shop", street1: "1 Main St", city: "Austin", state: "TX", zip: "78701", country: "US" },
      parcel: { length: 10, width: 8, height: 4, weight: 1 },
    });

    await expectRejected("POST", `/api/shipping-labels/${MISSING}/rates`, { weight: { lb: 1 }, length: "10", width: "8", height: "4" });
    // services/orderService.ts getShippingRates / purchaseShippingLabel
    await expectAccepted("POST", `/api/shipping-labels/${MISSING}/rates`, {
      fromAddress: { name: "Shop", line1: "1 Main St", city: "Austin", state: "TX", zip: "78701", country: "US" },
      weight: "1", length: "10", width: "8", height: "4",
    });
    await expectRejected("POST", `/api/shipping-labels/${MISSING}/purchase`, { rateId: 5, idempotencyKey: "k" });
    await expectAccepted("POST", `/api/shipping-labels/${MISSING}/purchase`, { rateId: "rate_1", priceCents: 795, idempotencyKey: crypto.randomUUID() });
  });
});

describe("buyer cart, saves and boards", () => {
  it("cart sync, saved items and collections", async () => {
    await expectRejected("POST", "/api/buyer/cart/sync", { items: "x" });
    await expectRejected("POST", "/api/buyer/cart/sync", { items: [1, 2] });
    await expectRejected("POST", "/api/buyer/cart/sync", { items: Array.from({ length: 501 }, () => ({})) });
    await expectAccepted("POST", "/api/buyer/cart/sync", {
      items: [{ id: "line-1", variantId: MISSING, productId: MISSING, name: "Tee", quantity: 1, priceCents: 2_500, sellerId: "s" }],
      savedItems: [],
    });

    await expectRejected("POST", "/api/buyer/saved", { type: "product", targetId: MISSING, title: "Tee", priceCents: "cheap" });
    await expectRejected("POST", "/api/buyer/saved", { type: "product", targetId: MISSING, title: "Tee", collectionId: "board-1" });
    // services/socialService.ts saveItem
    await expectAccepted("POST", "/api/buyer/saved", {
      type: "product", targetId: MISSING, title: "Tee", subtitle: "Brand", accentColor: "#ffffff", collectionId: null, priceCents: 2_500,
    });
    await expectAccepted("PATCH", `/api/buyer/saved/${MISSING}`, { collectionId: null });

    await expectRejected("POST", "/api/buyer/collections", { name: 5 });
    const created = await expectAccepted("POST", "/api/buyer/collections", { name: "Fits" });
    expect(created.status).toBe(201);
    await expectRejected("PATCH", `/api/buyer/collections/${created.body.id}`, { isPublic: "yes" });
    await expectAccepted("PATCH", `/api/buyer/collections/${created.body.id}`, { name: "Fits 2", coverImageUrl: null, isPublic: true });
    await expectRejected("POST", "/api/buyer/collections/reorder", { orderedIds: created.body.id });
    await expectAccepted("POST", "/api/buyer/collections/reorder", { orderedIds: [created.body.id] });
  });

  it("product questions and reviews", async () => {
    await expectRejected("POST", `/api/product-qa/product/${MISSING}`, { body: 5 });
    await expectAccepted("POST", `/api/product-qa/product/${MISSING}`, { body: "Does this run small?" });
    await expectRejected("POST", `/api/product-qa/questions/${MISSING}/answer`, { body: ["yes"] });

    await expectRejected("POST", "/api/reviews", { orderId: MISSING, sellerId: "s", rating: 5, photos: "/objects/a.jpg" });
    await expectRejected("POST", "/api/reviews", { orderId: MISSING, sellerId: "s", rating: "5" });
    await expectAccepted("POST", "/api/reviews", {
      orderId: MISSING, sellerId: "seller", productId: MISSING, rating: 5, body: "Great fit", photos: [], fitNote: "True to size",
    });
    await expectRejected("POST", `/api/reviews/${MISSING}/reply`, { replyText: 5 });
    await expectAccepted("POST", `/api/reviews/${MISSING}/reply`, { replyText: "Thank you!" });
  });
});

describe("seller money and settings", () => {
  it("payout, schedule and connect onboarding", async () => {
    await expectRejected("POST", "/api/finance/payout", { amount: 5_000, currency: "usd", idempotencyKey: "k".repeat(201) });
    await expectRejected("POST", "/api/finance/payout", { amount: { value: 5_000 }, currency: "usd" });
    await expectAccepted("POST", "/api/finance/payout", { amount: 5_000, currency: "usd", idempotencyKey: crypto.randomUUID(), method: "standard" });
    await expectRejected("PATCH", "/api/finance/payout-schedule", { interval: 5 });
    await expectAccepted("PATCH", "/api/finance/payout-schedule", { interval: "weekly", weeklyAnchor: "friday" });

    await expectRejected("POST", "/api/seller/connect/onboard", { returnUrl: 5 });
    await expectAccepted("POST", "/api/seller/connect/onboard", {});
  });

  it("seller profile writes", async () => {
    await expectRejected("PUT", "/api/seller/identity", { brandName: { name: "Shop" }, handle: "shop" });
    await expectAccepted("PUT", "/api/seller/identity", { brandName: `Shop ${suffix}`, handle: `shop${suffix}` });
    await expectRejected("PUT", "/api/seller/profile/accent", { color: 5 });
    await expectAccepted("PUT", "/api/seller/profile/accent", { color: null });
    await expectRejected("PUT", "/api/seller/social-links", { tiktok: 5 });
    await expectAccepted("PUT", "/api/seller/social-links", { instagram: "@shop" });
    await expectRejected("PATCH", "/api/seller/policy", { returnPolicy: 30 });
    await expectAccepted("PATCH", "/api/seller/policy", { returnPolicy: "30-day returns", cancellationPolicy: "Before shipping" });
    await expectRejected("POST", "/api/seller/onboarding/data", { goals: "grow" });
    await expectAccepted("POST", "/api/seller/onboarding/data", { goals: ["grow"], brandStage: "starting", sellModel: "print_on_demand", styleInterests: ["street"] });
  });

  it("discount codes, sales and drops", async () => {
    await expectRejected("POST", "/api/discount-codes", { type: "fixed", value: -5 });
    await expectRejected("POST", "/api/discount-codes", { type: "percentage", value: 10, minOrderCents: -1 });
    await expectRejected("POST", "/api/discount-codes", { type: "percentage", value: 10, productIds: "p1" });
    // app/discounts.tsx payload
    const code = await expectAccepted("POST", "/api/discount-codes", {
      code: `VAL${suffix}`.toUpperCase().slice(0, 20), type: "percentage", value: 15, minOrderCents: 0,
      appliesTo: "entire_store", productIds: [], maxUses: null, singleUse: false, oneUsePerCustomer: false,
      firstOrderOnly: false, collectionIds: [], minQuantity: 0, startsAt: null, expiresAt: null,
    });
    expect(code.status).toBe(201);
    // A percentage code can no longer be edited past 100%.
    expect((await call("PATCH", `/api/discount-codes/${code.body.id}`, { value: 150 })).status).toBe(400);
    expect((await call("PATCH", `/api/discount-codes/${code.body.id}`, { value: 20 })).status).toBe(200);
    await expectRejected("PATCH", `/api/discount-codes/${code.body.id}`, { active: "no" });

    await expectRejected("POST", "/api/sales", { name: "Summer", discountType: "percent", value: "abc", scope: "store" });
    await expectRejected("POST", "/api/sales", { name: "Summer", discountType: "percent", value: 20, scope: "products", productIds: "p1" });
    await expectAccepted("PATCH", `/api/sales/${MISSING}`, { active: false });

    await expectRejected("POST", "/api/drops", { name: "Drop", type: "pre-made", earlyAccessMinutes: "10" });
    await expectRejected("POST", "/api/drops", { name: "x".repeat(301), type: "pre-made" });
    // app/seller-drop-create.tsx payload
    await expectAccepted("PATCH", `/api/drops/${MISSING}`, {
      name: "Drop", releaseAt: new Date(Date.now() + 86_400_000).toISOString(), endsAt: null,
      heroImageUrl: null, heroVideoUrl: null, launchTimezone: "America/New_York", earlyAccessMinutes: 0,
    });
    await expectAccepted("PATCH", `/api/drops/${MISSING}`, { scheduledBroadcastAt: null });
    await expectRejected("POST", `/api/drops/${MISSING}/cancel`, { confirm: "yes" });
    await expectAccepted("POST", `/api/drops/${MISSING}/cancel`, { confirm: true });
  });

  it("shipping rates, zones and package presets", async () => {
    await expectRejected("POST", "/api/shipping-rates", { flatRateCents: -1 });
    await expectRejected("POST", "/api/shipping-rates", { flatRateCents: 500, freeAboveCents: 1e12 });
    await expectAccepted("PATCH", `/api/shipping-rates/${MISSING}`, { name: "Standard", flatRateCents: 500, freeAboveCents: null, active: true });

    await expectRejected("POST", "/api/shipping-zones", { name: "US", zoneType: "country", countries: "US" });
    await expectAccepted("PATCH", `/api/shipping-zones/${MISSING}`, {
      name: "US", zoneType: "domestic", countries: [], pricingModel: "flat", flatRateCents: 500, freeAboveCents: null,
      processingDays: 2, carrierLabel: null, shipsInternationally: true, dutiesHandling: "dap", sortOrder: 0,
    });
    await expectRejected("PUT", `/api/shipping-zones/${MISSING}/weight-tiers`, { tiers: [{ minWeightGrams: 0, rateCents: -1 }] });
    await expectAccepted("PUT", `/api/shipping-zones/${MISSING}/weight-tiers`, { tiers: [{ minWeightGrams: 0, maxWeightGrams: null, rateCents: 500 }] });
    await expectRejected("PATCH", "/api/shipping-zones/settings", { shipFromCountry: 5 });

    await expectRejected("POST", "/api/package-presets", { name: "Small", weightOz: "heavy", lengthIn: 10, widthIn: 8, heightIn: 4 });
    await expectAccepted("PATCH", `/api/package-presets/${MISSING}`, { name: "Small", weightOz: 8, lengthIn: 10, widthIn: 8, heightIn: 4 });
  });
});
