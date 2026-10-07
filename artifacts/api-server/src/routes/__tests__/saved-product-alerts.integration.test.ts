/**
 * Saved-product alerts end to end: a buyer saves a product through the real
 * /api/buyer/saved route, the seller restocks or reprices it through the real
 * inventory / products routes, and the buyer gets an Activity row
 * (notifications_feed) plus a push attempt — subject to the buyer's push
 * preference, the per-item alert toggles, blocks and the dedupe rules in
 * lib/savedProductAlerts.ts.
 *
 * Nothing in the push path is mocked except the network call to Expo's push
 * service, so preference / token handling in lib/push.ts runs for real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import {
  blocks, db, notificationDeliveries, notificationsFeed, productSaveAlertRuns, productVariants, products,
  pushTokens, savedItems, users,
} from "@workspace/db";
import { drainSavedProductAlerts, qualifiesForPriceDrop } from "../../lib/savedProductAlerts";
import { notifyBackInStock } from "../../lib/stockNotifications";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.header("x-test-user");
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));

vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../lib/planAccess", () => ({
  getVerifiedPlanAccess: async () => ({ planId: "growth", limits: { products: null } }),
  sendPlanLimitReached: vi.fn(),
  sendPlanLookupUnavailable: vi.fn(),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `spa-seller-${suffix}`;
const buyerA = `spa-a-${suffix}`;        // opted in, has a device
const buyerOptOut = `spa-b-${suffix}`;   // "Price & stock alerts" push pref off
const buyerItemOff = `spa-c-${suffix}`;  // per-item alerts off
const buyerBlocked = `spa-d-${suffix}`;  // blocked the seller
const buyerUnsaved = `spa-e-${suffix}`;  // saved, then unsaved
const allUsers = [seller, buyerA, buyerOptOut, buyerItemOff, buyerBlocked, buyerUnsaved];
const tokenOf = (user: string) => `ExponentPushToken[${user}]`;
const PRODUCT_IMAGE = `https://cdn.example.test/${suffix}/tee.jpg`;

let server: Server;
let base = "";
const createdProductIds: string[] = [];
const expoMessages: Array<{ to: string; title: string; body: string; data: Record<string, unknown> }> = [];

async function call(method: string, path: string, userId: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function createProduct(name: string, variants: Array<{ stock: number; priceCents: number }>) {
  const [product] = await db.insert(products).values({
    ownerId: seller, name, status: "active", images: [PRODUCT_IMAGE],
  }).returning({ id: products.id });
  createdProductIds.push(product.id);
  const rows = await db.insert(productVariants).values(variants.map((v, i) => ({
    productId: product.id, sku: `SPA-${suffix}-${createdProductIds.length}-${i}`, size: ["S", "M", "L"][i] ?? "XL",
    priceCents: v.priceCents, stock: v.stock,
  }))).returning({ id: productVariants.id, sku: productVariants.sku });
  return { productId: product.id, variants: rows };
}

/** Every buyer saves it through the real route; the per-item-off buyer then turns both alerts off. */
async function saveForEveryone(productId: string, name: string) {
  for (const buyer of [buyerA, buyerOptOut, buyerItemOff, buyerBlocked, buyerUnsaved]) {
    // Client sends a stale price; the server snapshots the live one.
    const saved = await call("POST", "/api/buyer/saved", buyer, { type: "product", targetId: productId, title: name, priceCents: 1 });
    expect(saved.status).toBe(201);
  }
  const off = await call("PATCH", `/api/buyer/saved/${productId}`, buyerItemOff, { notifyOnPriceDrop: false, notifyOnBackInStock: false });
  expect(off.status).toBe(200);
  expect(off.body).toMatchObject({ notifyOnPriceDrop: false, notifyOnBackInStock: false });
  const removed = await call("DELETE", `/api/buyer/saved/${productId}`, buyerUnsaved);
  expect(removed.status).toBe(200);
}

async function feed(userId: string, type: string, productId: string) {
  return db.select().from(notificationsFeed).where(and(
    eq(notificationsFeed.userId, userId), eq(notificationsFeed.type, type), eq(notificationsFeed.targetId, productId),
  ));
}

function pushedTo(type: string, productId: string) {
  return expoMessages
    .filter((m) => m.data.type === type && m.data.targetId === productId)
    .map((m) => m.to);
}

async function settle() {
  await drainSavedProductAlerts();
}

async function expectAlertReachedOnlyEligible(type: "back_in_stock" | "price_drop", productId: string) {
  const [rowA] = await feed(buyerA, type, productId);
  expect(rowA).toMatchObject({ category: "stock", targetType: "product", targetImageUrl: PRODUCT_IMAGE, cta: "Shop now" });
  expect(await feed(buyerOptOut, type, productId)).toHaveLength(1); // Activity row still written
  expect(await feed(buyerItemOff, type, productId)).toHaveLength(0);
  expect(await feed(buyerBlocked, type, productId)).toHaveLength(0);
  expect(await feed(buyerUnsaved, type, productId)).toHaveLength(0);
  expect(await feed(seller, type, productId)).toHaveLength(0);
  const pushed = pushedTo(type, productId);
  expect(pushed).toEqual([tokenOf(buyerA)]); // opted-out buyer's device never contacted
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@test.local`, name: "Seller", brandName: "North Loom", accountType: "seller", role: "owner" },
    ...[buyerA, buyerOptOut, buyerItemOff, buyerBlocked, buyerUnsaved].map((id) => ({
      clerkId: id, email: `${id}@test.local`, name: id, displayName: id, username: id.replace(/-/g, "_"),
      accountType: "buyer", role: "buyer",
      notificationPreferences: id === buyerOptOut ? { price_alerts: false } : undefined,
    })),
  ]);
  await db.insert(pushTokens).values([buyerA, buyerOptOut].map((id) => ({ userId: id, token: tokenOf(id), platform: "ios" })));
  await db.insert(blocks).values({ blockerId: buyerBlocked, blockedId: seller });

  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://exp.host/")) {
      const messages = JSON.parse(String(init?.body ?? "[]"));
      expoMessages.push(...messages);
      return new Response(JSON.stringify({ data: messages.map(() => ({ status: "ok", id: crypto.randomUUID() })) }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  });

  const { default: notificationsRouter } = await import("../notifications-feed");
  const { default: savedRouter } = await import("../saved");
  const { default: productsRouter } = await import("../products");
  const { default: inventoryRouter } = await import("../inventory");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api/buyer/saved", savedRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/inventory", inventoryRouter);
  app.use("/api/buyer/notifications", notificationsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  expoMessages.length = 0;
});

afterAll(async () => {
  await settle();
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  if (createdProductIds.length) {
    await db.delete(savedItems).where(inArray(savedItems.targetId, createdProductIds));
    await db.delete(productSaveAlertRuns).where(inArray(productSaveAlertRuns.productId, createdProductIds));
    await db.delete(products).where(inArray(products.id, createdProductIds));
  }
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, allUsers));
  await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.userId, allUsers));
  await db.delete(pushTokens).where(inArray(pushTokens.userId, allUsers));
  await db.delete(blocks).where(eq(blocks.blockerId, buyerBlocked));
  await db.delete(users).where(inArray(users.clerkId, allUsers));
});

describe("price-drop threshold", () => {
  it("needs at least 5% and at least $1 below the reference", () => {
    expect(qualifiesForPriceDrop(5000, 4900)).toBe(false); // $1, 2%
    expect(qualifiesForPriceDrop(5000, 4750)).toBe(true);  // $2.50, 5%
    expect(qualifiesForPriceDrop(1500, 1420)).toBe(false); // 5.3% but only 80¢
    expect(qualifiesForPriceDrop(null, 100)).toBe(false);
  });
});

describe("saving a product", () => {
  it("snapshots the live lowest price server-side and exposes both alert toggles", async () => {
    const { productId } = await createProduct("Snapshot Tee", [{ stock: 2, priceCents: 6400 }, { stock: 0, priceCents: 5900 }]);
    const saved = await call("POST", "/api/buyer/saved", buyerA, { type: "product", targetId: productId, title: "Snapshot Tee", priceCents: 1 });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ type: "product", targetId: productId, priceCents: 5900, notifyOnPriceDrop: true, notifyOnBackInStock: true });
    const [row] = await db.select().from(savedItems).where(and(eq(savedItems.userId, buyerA), eq(savedItems.targetId, productId)));
    expect(row.savedPriceCents).toBe(5900);
    expect(row.lastNotifiedPriceCents).toBe(5900);

    const bad = await call("PATCH", `/api/buyer/saved/${productId}`, buyerA, { notifyOnPriceDrop: "no" });
    expect(bad.status).toBe(400);
    // Toggling alerts never un-files the item from its collection.
    const toggled = await call("PATCH", `/api/buyer/saved/${productId}`, buyerA, { notifyOnBackInStock: false });
    expect(toggled.body).toMatchObject({ notifyOnPriceDrop: true, notifyOnBackInStock: false });
  });
});

describe("back in stock", () => {
  it("inventory quick adjust 0 -> 3 alerts eligible savers (Activity + push), nobody else", async () => {
    const { productId, variants } = await createProduct("Restock Tee", [{ stock: 0, priceCents: 5000 }, { stock: 0, priceCents: 5000 }]);
    await saveForEveryone(productId, "Restock Tee");

    const adjusted = await call("PATCH", `/api/inventory/${variants[0].id}/adjust`, seller, { newStock: 3 });
    expect(adjusted.status).toBe(200);
    await settle();

    await expectAlertReachedOnlyEligible("back_in_stock", productId);
    const [row] = await feed(buyerA, "back_in_stock", productId);
    expect(row.body).toContain("Restock Tee is back in stock");
    const runs = await db.select().from(productSaveAlertRuns).where(eq(productSaveAlertRuns.productId, productId));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ kind: "back_in_stock", recipientCount: 2, ownerId: seller });

    // The seller sees saves + reach.
    const stats = await call("GET", `/api/products/${productId}/save-stats`, seller);
    expect(stats.body).toMatchObject({ saves: 4, priceAlertsOn: 3, restockAlertsOn: 3, backInStockReached: 2, priceDropReached: 0 });
    expect((await call("GET", `/api/products/${productId}/save-stats`, buyerA)).status).toBe(404);

    // The Saved screen shows the badge.
    const list = await call("GET", "/api/buyer/saved", buyerA);
    expect((list.body as any[]).find((i) => i.targetId === productId)).toMatchObject({ backInStock: true, inStock: true });

    // Another size restocking while the product is already in stock is not an alert.
    expoMessages.length = 0;
    await call("PATCH", `/api/inventory/${variants[1].id}/adjust`, seller, { newStock: 4 });
    await settle();
    expect(pushedTo("back_in_stock", productId)).toEqual([]);
    expect(await db.select().from(productSaveAlertRuns).where(eq(productSaveAlertRuns.productId, productId))).toHaveLength(1);

    // Selling out and restocking again inside the cooldown doesn't re-alert.
    await db.update(productVariants).set({ stock: 0 }).where(eq(productVariants.productId, productId));
    await call("PATCH", `/api/inventory/${variants[0].id}/adjust`, seller, { delta: 1 });
    await settle();
    expect(pushedTo("back_in_stock", productId)).toEqual([]);
  });

  it("variant edit 0 -> 2 alerts, and replaces the earlier Activity row once the cooldown passed", async () => {
    const { productId, variants } = await createProduct("Edit Restock Tee", [{ stock: 0, priceCents: 4000 }]);
    await saveForEveryone(productId, "Edit Restock Tee");

    const edited = await call("PATCH", `/api/products/${productId}/variants/${variants[0].id}`, seller, { stock: 2 });
    expect(edited.status).toBe(200);
    await settle();
    await expectAlertReachedOnlyEligible("back_in_stock", productId);

    // A day later it sold out and comes back: one fresh row, pushed again.
    await db.update(savedItems).set({ backInStockNotifiedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(savedItems.targetId, productId));
    await db.update(productVariants).set({ stock: 0 }).where(eq(productVariants.productId, productId));
    expoMessages.length = 0;
    await call("PATCH", `/api/products/${productId}/variants/${variants[0].id}`, seller, { stock: 5 });
    await settle();
    expect(await feed(buyerA, "back_in_stock", productId)).toHaveLength(1);
    expect(pushedTo("back_in_stock", productId)).toEqual([tokenOf(buyerA)]);
  });

  it("adding an in-stock size to a sold-out product is a restock", async () => {
    const { productId } = await createProduct("New Size Tee", [{ stock: 0, priceCents: 3000 }]);
    await saveForEveryone(productId, "New Size Tee");
    const added = await call("POST", `/api/products/${productId}/variants`, seller, { sku: `SPA-NEW-${suffix}`, size: "XL", priceCents: 3000, stock: 6 });
    expect(added.status).toBe(201);
    await settle();
    await expectAlertReachedOnlyEligible("back_in_stock", productId);
  });

  it("coalesces per-variant restocks of one product (order cancel/refund restock, PR #710's notifyStockRestored)", async () => {
    const { productId, variants } = await createProduct("Cancel Restock Tee", [{ stock: 0, priceCents: 3000 }, { stock: 0, priceCents: 3000 }]);
    await saveForEveryone(productId, "Cancel Restock Tee");
    // A cancelled order puts one unit of each size back, then notifies per variant.
    await db.update(productVariants).set({ stock: 1 }).where(inArray(productVariants.id, variants.map((v) => v.id)));
    for (const _variant of variants) {
      await notifyBackInStock({ productId, ownerId: seller, productName: "Cancel Restock Tee", previousStock: 0, newStock: 1 });
    }
    await settle();
    await expectAlertReachedOnlyEligible("back_in_stock", productId);
    expect(await db.select().from(productSaveAlertRuns).where(eq(productSaveAlertRuns.productId, productId))).toHaveLength(1);
  });

  it("product-level edit (PUT /api/products/:id with variants) restocks", async () => {
    const { productId, variants } = await createProduct("Editor Restock Tee", [{ stock: 0, priceCents: 3000 }]);
    await saveForEveryone(productId, "Editor Restock Tee");
    const put = await call("PUT", `/api/products/${productId}`, seller, { variants: [{ id: variants[0].id, stock: 7 }] });
    expect(put.status).toBe(200);
    await settle();
    await expectAlertReachedOnlyEligible("back_in_stock", productId);
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, variants[0].id));
    expect(variant.stock).toBe(7);
  });

  it("never alerts for an unpublished product or a suspended seller", async () => {
    const { productId, variants } = await createProduct("Hidden Tee", [{ stock: 0, priceCents: 3000 }]);
    await saveForEveryone(productId, "Hidden Tee");
    await db.update(products).set({ status: "draft" }).where(eq(products.id, productId));
    await call("PATCH", `/api/inventory/${variants[0].id}/adjust`, seller, { newStock: 2 });
    await settle();
    expect(await feed(buyerA, "back_in_stock", productId)).toHaveLength(0);

    await db.update(products).set({ status: "active" }).where(eq(products.id, productId));
    await db.update(productVariants).set({ stock: 0 }).where(eq(productVariants.productId, productId));
    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.clerkId, seller));
    try {
      await call("PATCH", `/api/inventory/${variants[0].id}/adjust`, seller, { newStock: 2 });
      await settle();
      expect(await feed(buyerA, "back_in_stock", productId)).toHaveLength(0);
      expect(expoMessages).toHaveLength(0);
    } finally {
      await db.update(users).set({ suspendedAt: null }).where(eq(users.clerkId, seller));
    }
  });
});

describe("price drop", () => {
  it("variant price edits alert opted-in savers once per real drop (>=5% and >=$1), deduped", async () => {
    const { productId, variants } = await createProduct("Drop Tee", [{ stock: 4, priceCents: 5000 }, { stock: 4, priceCents: 5000 }]);
    await saveForEveryone(productId, "Drop Tee");
    const edit = (variantId: string, priceCents: number) =>
      call("PATCH", `/api/products/${productId}/variants/${variantId}`, seller, { priceCents });

    // $1 off (2%) — too small.
    await edit(variants[0].id, 4900);
    await settle();
    expect(await feed(buyerA, "price_drop", productId)).toHaveLength(0);

    // Down to $40 (20% below the $50 saved price) — alert.
    await edit(variants[0].id, 4000);
    await settle();
    await expectAlertReachedOnlyEligible("price_drop", productId);
    const [row] = await feed(buyerA, "price_drop", productId);
    expect(row.body).toContain("Drop Tee just dropped to $40.00");
    const [saved] = await db.select().from(savedItems).where(and(eq(savedItems.userId, buyerA), eq(savedItems.targetId, productId)));
    expect(saved.lastNotifiedPriceCents).toBe(4000);
    expect(saved.savedPriceCents).toBe(5000); // the strike-through price never moves

    // Repeated small edits off the last alerted price: no spam.
    expoMessages.length = 0;
    await edit(variants[0].id, 3900); // 2.5% below $40
    await edit(variants[1].id, 3950);
    await settle();
    expect(pushedTo("price_drop", productId)).toEqual([]);

    // A raise then a drop back to an already-alerted level: nothing.
    await edit(variants[0].id, 4500);
    await edit(variants[0].id, 4000);
    await settle();
    expect(pushedTo("price_drop", productId)).toEqual([]);

    // Another real drop below the last alert: alert again, one Activity row.
    await edit(variants[0].id, 3600);
    await settle();
    expect(pushedTo("price_drop", productId)).toEqual([tokenOf(buyerA)]);
    expect(await feed(buyerA, "price_drop", productId)).toHaveLength(1);

    const list = await call("GET", "/api/buyer/saved", buyerA);
    expect((list.body as any[]).find((i) => i.targetId === productId)).toMatchObject({
      priceDropped: true, priceCents: 3600, oldPriceCents: 5000,
    });
    const stats = await call("GET", `/api/products/${productId}/save-stats`, seller);
    expect(stats.body).toMatchObject({ priceDropReached: 4 }); // two runs x (A + opted-out-push B)
  });

  it("product-level price edit (PUT with variants by sku) alerts", async () => {
    const { productId, variants } = await createProduct("Editor Drop Tee", [{ stock: 4, priceCents: 8000 }]);
    await saveForEveryone(productId, "Editor Drop Tee");
    const put = await call("PUT", `/api/products/${productId}`, seller, {
      name: "Editor Drop Tee", variants: [{ sku: variants[0].sku, priceCents: 6000 }, { sku: "NOT-A-REAL-SKU", priceCents: 10 }],
    });
    expect(put.status).toBe(200);
    await settle();
    await expectAlertReachedOnlyEligible("price_drop", productId);
    expect(await db.select().from(productVariants).where(eq(productVariants.productId, productId))).toHaveLength(1);

    const invalid = await call("PUT", `/api/products/${productId}`, seller, { variants: [{ sku: variants[0].sku, priceCents: -5 }] });
    expect(invalid.status).toBe(400);
  });

  it("turning the per-item price alert off mid-way stops further alerts for that buyer", async () => {
    const { productId, variants } = await createProduct("Toggle Tee", [{ stock: 1, priceCents: 10000 }]);
    await call("POST", "/api/buyer/saved", buyerA, { type: "product", targetId: productId, title: "Toggle Tee" });
    await call("PATCH", `/api/buyer/saved/${productId}`, buyerA, { notifyOnPriceDrop: false });
    await call("PATCH", `/api/products/${productId}/variants/${variants[0].id}`, seller, { priceCents: 5000 });
    await settle();
    expect(await feed(buyerA, "price_drop", productId)).toHaveLength(0);
    expect(expoMessages).toHaveLength(0);
  });
});
