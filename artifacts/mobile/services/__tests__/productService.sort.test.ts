/**
 * The Products tab's sort sheet is wired to the real product query: each
 * option's sortBy / sortDir (lib/sellerLists/productSort.ts) must come back
 * from getProducts in that order. Mocks mirror productService.stock.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storage } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    multiGet: vi.fn(async (keys: string[]) =>
      keys.map((key) => [key, storage.get(key) ?? null] as [string, string | null]),
    ),
    multiSet: vi.fn(async (pairs: [string, string][]) => {
      pairs.forEach(([key, value]) => storage.set(key, value));
    }),
    multiRemove: vi.fn(async (keys: string[]) => {
      keys.forEach((key) => storage.delete(key));
    }),
    getAllKeys: vi.fn(async () => [...storage.keys()]),
  },
}));

vi.mock("@/lib/serviceConfig", () => ({
  serviceRequest: vi.fn(),
}));

const { isPreviewDemoModeMock } = vi.hoisted(() => ({
  isPreviewDemoModeMock: vi.fn(() => false),
}));

vi.mock("@/lib/devPreview", () => ({
  isPreviewDemoMode: isPreviewDemoModeMock,
}));

// The real module pulls in expo-asset + bundled image requires (fine on
// device, unavailable in this test environment) — stand in with plain
// fixture products carrying the same `preview-product-` id convention.
vi.mock("@/lib/previewSellerProducts", () => ({
  getPreviewSellerProducts: () => [
    {
      id: "preview-product-1", sellerId: "preview-seller", name: "Seed Tee",
      description: "", category: "T-shirt", tags: [], media: [],
      pricing: { priceCents: 2000, currency: "USD" },
      options: [], variants: [{
        id: "preview-product-1-v1", productId: "preview-product-1", title: "M",
        optionValues: [], sku: "SEED-1", inventoryQuantity: 12, reservedQuantity: 0,
        incomingQuantity: 0, status: "active", requiresShipping: true, taxable: true,
        createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z",
      }],
      inventory: {
        productId: "preview-product-1", trackQuantity: true, allowOverselling: false,
        policy: "deny", lowStockThreshold: 5, totalStock: 12, availableStock: 12,
        reservedStock: 0, incomingStock: 0, locationStock: [],
        variantStock: [{ variantId: "preview-product-1-v1", quantity: 12 }],
      },
      salesModel: "pre-made", fulfillment: { type: "seller" }, manufacturing: { stage: "none" },
      storeSettings: { status: "active", collectionIds: [], featuredOnHomepage: false, relatedProductIds: [], seo: { searchVisible: true } },
      totalSales: 0, totalRevenueCents: 0, status: "active",
      createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z",
    },
  ],
}));

import { afterEach } from "vitest";
import { createProduct, getProducts, initProductService } from "../productService";
import { PRODUCT_SORT_OPTIONS, productSortQuery, type ProductSortKey } from "@/lib/sellerLists/productSort";

describe("getProducts honours the Products sort sheet", () => {
  beforeEach(async () => {
    storage.clear();
    isPreviewDemoModeMock.mockReturnValue(false);
    initProductService(null);
    initProductService("seller-sort");
    vi.useFakeTimers({ toFake: ["Date"] });
    // Created oldest → newest; price and sales deliberately not in that order.
    const seed = [
      { name: "A-old", priceCents: 3000, totalSales: 5, at: "2026-01-01T00:00:00.000Z" },
      { name: "B-mid", priceCents: 1000, totalSales: 40, at: "2026-02-01T00:00:00.000Z" },
      { name: "C-new", priceCents: 2000, totalSales: 12, at: "2026-03-01T00:00:00.000Z" },
    ];
    for (const p of seed) {
      vi.setSystemTime(new Date(p.at));
      await createProduct({ name: p.name, pricing: { priceCents: p.priceCents, currency: "USD" }, totalSales: p.totalSales });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const expected: Record<ProductSortKey, string[]> = {
    newest: ["C-new", "B-mid", "A-old"],
    oldest: ["A-old", "B-mid", "C-new"],
    price_desc: ["A-old", "C-new", "B-mid"],
    price_asc: ["B-mid", "C-new", "A-old"],
    sales: ["B-mid", "C-new", "A-old"],
  };

  for (const { key, label } of PRODUCT_SORT_OPTIONS) {
    it(`"${label}" returns products in ${key} order`, async () => {
      const list = await getProducts({ filter: "all", ...productSortQuery(key) });
      expect(list.map((p) => p.name)).toEqual(expected[key]);
    });
  }
});
