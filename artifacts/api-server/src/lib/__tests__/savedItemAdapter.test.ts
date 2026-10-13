/**
 * Saved items carry the brand's seller id (less-AI item 136: the brand name
 * on a Saved card links to the store) next to the existing price-drop badge
 * data (item 137).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({}));
vi.mock("../savedProductBadges", () => ({
  fetchProductBadgeInfo: vi.fn(async () => new Map([
    ["prod_1", { image: "a.jpg", brand: "Northline Studio", sellerId: "user_seller_1", priceCents: 8000, inStock: true, lowStock: false, soldOut: false }],
  ])),
  isBackInStockRecent: () => false,
}));

import { adaptSavedRows } from "../savedItemAdapter";

const row = (over: Record<string, unknown> = {}) => ({
  id: "s1", itemType: "product", targetId: "prod_1", title: "Hoodie", subtitle: null, accentColor: null,
  collectionId: null, createdAt: new Date("2026-10-01T00:00:00Z"), notifyOnPriceDrop: true,
  savedPriceCents: 9800, backInStockAt: null, ...over,
}) as any;

describe("adaptSavedRows", () => {
  it("adds the brand's sellerId alongside the brand name and keeps the price drop", async () => {
    const [item] = await adaptSavedRows([row()]);
    expect(item).toMatchObject({ brand: "Northline Studio", sellerId: "user_seller_1", priceCents: 8000, oldPriceCents: 9800, priceDropped: true });
  });

  it("leaves sellerId undefined for items with no product badge data", async () => {
    const [item] = await adaptSavedRows([row({ itemType: "store", targetId: "store_1" })]);
    expect(item.sellerId).toBeUndefined();
    expect(item.priceDropped).toBe(false);
  });
});
