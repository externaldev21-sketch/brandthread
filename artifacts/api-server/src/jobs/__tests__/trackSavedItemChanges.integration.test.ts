import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, products, productVariants, savedItems, notificationsFeed, users } from "@workspace/db";

const sendPushToUser = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../../lib/push", async () => {
  const actual = await vi.importActual<typeof import("../../lib/push")>("../../lib/push");
  return { ...actual, sendPushToUser };
});

import { runTrackSavedItemChanges } from "../trackSavedItemChanges";

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `track-saved-seller-${suffix}`;
const buyer = `track-saved-buyer-${suffix}`;
const productIds: string[] = [];
const savedItemIds: string[] = [];

async function addProduct(priceCents: number, stock: number) {
  const [product] = await db.insert(products).values({
    ownerId: seller,
    name: "Track Jacket",
    category: "apparel",
    status: "active",
  }).returning();
  productIds.push(product.id);
  await db.insert(productVariants).values({
    productId: product.id,
    sku: `${suffix}-${productIds.length}`,
    priceCents,
    stock,
  });
  return product;
}

beforeAll(async () => {
  await db.insert(users).values({
    clerkId: seller,
    email: `${seller}@test.local`,
    name: "Track Seller",
    role: "seller",
    accountType: "seller",
  });
});

afterEach(async () => {
  sendPushToUser.mockClear();
  if (savedItemIds.length) await db.delete(savedItems).where(inArray(savedItems.id, savedItemIds.splice(0)));
  if (productIds.length) {
    await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, buyer));
    await db.delete(productVariants).where(inArray(productVariants.productId, productIds));
    await db.delete(products).where(inArray(products.id, productIds.splice(0)));
  }
});

afterAll(async () => {
  await db.delete(users).where(eq(users.clerkId, seller));
});

describe("trackSavedItemChanges job", () => {
  it("fires a price-drop notification once the live price falls below the saved baseline", async () => {
    const product = await addProduct(5_000, 10);
    const [saved] = await db.insert(savedItems).values({
      userId: buyer,
      itemType: "product",
      targetId: product.id,
      title: "Track Jacket",
      savedPriceCents: 5_000,
      lastNotifiedPriceCents: 5_000,
    }).returning();
    savedItemIds.push(saved.id);

    // No change yet — nothing fires.
    const noChange = await runTrackSavedItemChanges();
    expect(noChange.priceDrops).toBe(0);
    expect(sendPushToUser).not.toHaveBeenCalled();

    // Price drops.
    await db.update(productVariants).set({ priceCents: 4_000 }).where(eq(productVariants.productId, product.id));

    const result = await runTrackSavedItemChanges();
    expect(result.priceDrops).toBe(1);
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).toHaveBeenCalledWith(buyer, expect.objectContaining({
      title: "Price drop!",
    }), "order");

    const [updated] = await db.select().from(savedItems).where(eq(savedItems.id, saved.id));
    expect(updated.lastNotifiedPriceCents).toBe(4_000);

    const [feedRow] = await db.select().from(notificationsFeed)
      .where(eq(notificationsFeed.userId, buyer));
    expect(feedRow.type).toBe("price_drop");

    // Running again with no further drop does not re-notify.
    sendPushToUser.mockClear();
    const again = await runTrackSavedItemChanges();
    expect(again.priceDrops).toBe(0);
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("fires a back-in-stock notification on the zero-to-available transition", async () => {
    const product = await addProduct(3_000, 0);
    const [saved] = await db.insert(savedItems).values({
      userId: buyer,
      itemType: "product",
      targetId: product.id,
      title: "Track Jacket",
      wasOutOfStock: false, // job hasn't observed the zero-stock state yet
    }).returning();
    savedItemIds.push(saved.id);

    const firstPass = await runTrackSavedItemChanges();
    expect(firstPass.backInStock).toBe(0);
    const [afterFirstPass] = await db.select().from(savedItems).where(eq(savedItems.id, saved.id));
    expect(afterFirstPass.wasOutOfStock).toBe(true); // now flagged out-of-stock
    expect(sendPushToUser).not.toHaveBeenCalled();

    await db.update(productVariants).set({ stock: 5 }).where(eq(productVariants.productId, product.id));

    const secondPass = await runTrackSavedItemChanges();
    expect(secondPass.backInStock).toBe(1);
    expect(sendPushToUser).toHaveBeenCalledWith(buyer, expect.objectContaining({
      title: "Back in stock!",
    }), "order");

    const [afterRestock] = await db.select().from(savedItems).where(eq(savedItems.id, saved.id));
    expect(afterRestock.wasOutOfStock).toBe(false);
    expect(afterRestock.backInStockAt).toBeInstanceOf(Date);
  });
});
