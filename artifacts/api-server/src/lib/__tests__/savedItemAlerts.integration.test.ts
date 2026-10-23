/**
 * Saved items alerts: restock and price-drop detection plus the 48-hour
 * per-buyer, per-product dedupe (lib/stockNotifications.ts).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, productVariants, products, savedItems } from "@workspace/db";

const published = vi.hoisted(() => [] as Array<{
  userId: string; type: string; title: string; body?: string; targetId?: string; targetType?: string; pushCategory?: string;
}>);

vi.mock("../../routes/notifications-feed", () => ({
  publishNotification: async (n: (typeof published)[number]) => { published.push(n); },
}));

const { notifyBackInStock, notifyPriceDrop } = await import("../stockNotifications");

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `saved-alert-seller-${suffix}`;
const buyerA = `saved-alert-buyer-a-${suffix}`;
const buyerB = `saved-alert-buyer-b-${suffix}`;
const buyerC = `saved-alert-buyer-c-${suffix}`;
const productIds: string[] = [];
const NAME = "Linen Overshirt";
const HOUR = 3600 * 1000;

async function makeProduct(variants: Array<{ priceCents: number; stock: number }>) {
  const [p] = await db.insert(products).values({ ownerId: seller, name: NAME, status: "active" }).returning({ id: products.id });
  productIds.push(p.id);
  const rows = await db.insert(productVariants).values(variants.map((v, i) => ({
    productId: p.id, size: `S${i}`, color: "Ecru", sku: `SA-${suffix}-${productIds.length}-${i}`, ...v,
  }))).returning({ id: productVariants.id });
  return { id: p.id, variantIds: rows.map((r) => r.id) };
}

async function save(productId: string, userId: string, values: Partial<typeof savedItems.$inferInsert> = {}) {
  await db.insert(savedItems).values({ userId, itemType: "product", targetId: productId, title: NAME, ...values });
}

async function setStock(variantId: string, stock: number) {
  await db.update(productVariants).set({ stock }).where(eq(productVariants.id, variantId));
}

async function setPrice(variantId: string, priceCents: number) {
  await db.update(productVariants).set({ priceCents }).where(eq(productVariants.id, variantId));
}

/** Moves every saved row's last-alert stamps back, as if `hours` had passed. */
async function rewind(productId: string, hours: number) {
  const rows = await db.select().from(savedItems).where(eq(savedItems.targetId, productId));
  for (const row of rows) {
    await db.update(savedItems).set({
      restockAlertedAt: row.restockAlertedAt ? new Date(row.restockAlertedAt.getTime() - hours * HOUR) : null,
      priceDropAlertedAt: row.priceDropAlertedAt ? new Date(row.priceDropAlertedAt.getTime() - hours * HOUR) : null,
    }).where(eq(savedItems.id, row.id));
  }
}

const sentTo = (type: string, productId: string) =>
  published.filter((p) => p.type === type && p.targetId === productId).map((p) => p.userId).sort();

beforeEach(() => { published.length = 0; });

afterAll(async () => {
  await db.delete(savedItems).where(inArray(savedItems.userId, [buyerA, buyerB, buyerC]));
  if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
});

describe("price drop", () => {
  it("alerts buyers who saved the product, quoting the new lowest price", async () => {
    const p = await makeProduct([{ priceCents: 5000, stock: 3 }, { priceCents: 6000, stock: 3 }]);
    await save(p.id, buyerA, { savedPriceCents: 5000, lastNotifiedPriceCents: 5000 });
    await save(p.id, buyerB, { savedPriceCents: 5000, lastNotifiedPriceCents: 5000, notifyOnPriceDrop: false });
    await save(p.id, buyerC); // saved without a price snapshot

    await setPrice(p.variantIds[0], 4000);
    await notifyPriceDrop({ productId: p.id, ownerId: seller, productName: NAME, previousPriceCents: 5000, newPriceCents: 4000 });

    expect(sentTo("price_drop", p.id)).toEqual([buyerA, buyerC].sort());
    const alert = published.find((n) => n.userId === buyerA)!;
    expect(alert.title).toBe(`Price drop: ${NAME} now $40.00`);
    expect(alert.targetType).toBe("product");
    expect(alert.pushCategory).toBe("saved");
  });

  it("ignores price increases and drops that leave the lowest price unchanged", async () => {
    const p = await makeProduct([{ priceCents: 5000, stock: 3 }, { priceCents: 8000, stock: 3 }]);
    await save(p.id, buyerA, { savedPriceCents: 5000, lastNotifiedPriceCents: 5000 });
    await save(p.id, buyerC);

    await setPrice(p.variantIds[0], 5500);
    await notifyPriceDrop({ productId: p.id, ownerId: seller, productName: NAME, previousPriceCents: 5000, newPriceCents: 5500 });
    await setPrice(p.variantIds[0], 5000);
    await setPrice(p.variantIds[1], 7000);
    await notifyPriceDrop({ productId: p.id, ownerId: seller, productName: NAME, previousPriceCents: 8000, newPriceCents: 7000 });

    expect(published).toHaveLength(0);
  });

  it("sends at most one price-drop alert per buyer per product per 48 hours", async () => {
    const p = await makeProduct([{ priceCents: 5000, stock: 3 }]);
    await save(p.id, buyerA, { savedPriceCents: 5000, lastNotifiedPriceCents: 5000 });
    const drop = async (from: number, to: number) => {
      await setPrice(p.variantIds[0], to);
      await notifyPriceDrop({ productId: p.id, ownerId: seller, productName: NAME, previousPriceCents: from, newPriceCents: to });
    };

    await drop(5000, 4500);
    await drop(4500, 4000); // inside the window
    expect(published.map((n) => n.title)).toEqual([`Price drop: ${NAME} now $45.00`]);

    await rewind(p.id, 47);
    await drop(4000, 3800); // still inside the window
    expect(published).toHaveLength(1);

    await rewind(p.id, 2); // 49 hours since the first alert
    await drop(3800, 3500);
    expect(published.map((n) => n.title)).toEqual([`Price drop: ${NAME} now $45.00`, `Price drop: ${NAME} now $35.00`]);
  });

  it("does not alert for an archived product", async () => {
    const p = await makeProduct([{ priceCents: 5000, stock: 3 }]);
    await save(p.id, buyerA, { savedPriceCents: 5000, lastNotifiedPriceCents: 5000 });
    await db.update(products).set({ status: "archived" }).where(eq(products.id, p.id));
    await setPrice(p.variantIds[0], 4000);
    await notifyPriceDrop({ productId: p.id, ownerId: seller, productName: NAME, previousPriceCents: 5000, newPriceCents: 4000 });
    expect(published).toHaveLength(0);
  });
});

describe("restock", () => {
  async function sellOut(variantId: string, productId: string, from: number) {
    await setStock(variantId, 0);
    await notifyBackInStock({ productId, ownerId: seller, productName: NAME, previousStock: from, newStock: 0 });
  }
  async function restock(variantId: string, productId: string, to: number) {
    await setStock(variantId, to);
    await notifyBackInStock({ productId, ownerId: seller, productName: NAME, previousStock: 0, newStock: to, variantId });
  }

  it("alerts savers when the product goes from 0 to positive stock", async () => {
    const p = await makeProduct([{ priceCents: 5000, stock: 2 }]);
    await save(p.id, buyerA);
    await save(p.id, buyerB);

    await sellOut(p.variantIds[0], p.id, 2);
    expect(published).toHaveLength(0);
    await restock(p.variantIds[0], p.id, 5);

    expect(sentTo("back_in_stock", p.id)).toEqual([buyerA, buyerB].sort());
    expect(published[0].title).toBe(`Back in stock: ${NAME}`);
    expect(published[0].pushCategory).toBe("saved");
    const rows = await db.select().from(savedItems).where(eq(savedItems.targetId, p.id));
    expect(rows.every((r) => r.backInStockAt && !r.wasOutOfStock)).toBe(true);
  });

  it("does not alert when one variant restocks while the product was still in stock", async () => {
    const p = await makeProduct([{ priceCents: 5000, stock: 0 }, { priceCents: 5000, stock: 4 }]);
    await save(p.id, buyerA);
    await restock(p.variantIds[0], p.id, 3);
    expect(published).toHaveLength(0);
  });

  it("alerts once when several variants restock in the same edit", async () => {
    const p = await makeProduct([{ priceCents: 5000, stock: 1 }, { priceCents: 5000, stock: 1 }]);
    await save(p.id, buyerA);
    await sellOut(p.variantIds[0], p.id, 1);
    await sellOut(p.variantIds[1], p.id, 1);

    await setStock(p.variantIds[0], 4);
    await setStock(p.variantIds[1], 6);
    await notifyBackInStock({ productId: p.id, ownerId: seller, productName: NAME, previousStock: 0, newStock: 4, variantId: p.variantIds[0] });
    await notifyBackInStock({ productId: p.id, ownerId: seller, productName: NAME, previousStock: 0, newStock: 6, variantId: p.variantIds[1] });

    expect(sentTo("back_in_stock", p.id)).toEqual([buyerA]);
  });

  it("sends at most one restock alert per buyer per product per 48 hours", async () => {
    const p = await makeProduct([{ priceCents: 5000, stock: 1 }]);
    await save(p.id, buyerA);
    const cycle = async () => {
      await sellOut(p.variantIds[0], p.id, 3);
      await restock(p.variantIds[0], p.id, 3);
    };

    await cycle();
    await cycle(); // sold out and restocked again inside the window
    expect(sentTo("back_in_stock", p.id)).toEqual([buyerA]);

    await rewind(p.id, 49);
    await cycle();
    expect(sentTo("back_in_stock", p.id)).toEqual([buyerA, buyerA]);
  });

  it("alerts a buyer who saved the product while it was already sold out", async () => {
    const p = await makeProduct([{ priceCents: 5000, stock: 0 }]);
    // routes/saved.ts marks a row saved while sold out.
    await save(p.id, buyerC, { wasOutOfStock: true });
    await restock(p.variantIds[0], p.id, 2);
    expect(sentTo("back_in_stock", p.id)).toEqual([buyerC]);
  });
});
