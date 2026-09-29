/**
 * Coverage for folding Inventory into Products: per-variant stock edits
 * (adjustVariantStock / setVariantStock) and the ?bt_preview=seller&demo=1
 * seeded-catalog overlay (getProducts/getProduct/getProductStats), which
 * must never touch AsyncStorage.
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

import {
  createProduct, getProducts, getProduct, getProductStats, initProductService,
  adjustVariantStock, setVariantStock, adjustInventory,
} from "../productService";
import type { ProductVariant } from "../productTypes";

function variant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  const now = new Date().toISOString();
  return {
    id: "variant-1", productId: "prod-1", title: "M / Black",
    optionValues: [], sku: "SKU-1", inventoryQuantity: 10,
    reservedQuantity: 0, incomingQuantity: 0, status: "active",
    requiresShipping: true, taxable: true, createdAt: now, updatedAt: now,
    ...overrides,
  };
}

describe("productService stock editing", () => {
  beforeEach(() => {
    storage.clear();
    isPreviewDemoModeMock.mockReturnValue(false);
    initProductService(null);
    initProductService("seller-a");
  });

  it("adjustVariantStock increases and decreases a single variant, keeping the product total in sync", async () => {
    const v = variant({ id: "v1", inventoryQuantity: 10 });
    const product = await createProduct({
      name: "Tee", variants: [v],
      inventory: { productId: "", trackQuantity: true, allowOverselling: false, policy: "deny", lowStockThreshold: 5, totalStock: 10, availableStock: 10, reservedStock: 0, incomingStock: 0, locationStock: [], variantStock: [{ variantId: "v1", quantity: 10 }] },
    });

    const adj = await adjustVariantStock(product.id, "v1", 5, "Restock");
    expect(adj?.delta).toBe(5);
    const afterAdd = await getProduct(product.id);
    expect(afterAdd?.variants[0].inventoryQuantity).toBe(15);
    expect(afterAdd?.inventory.totalStock).toBe(15);
    expect(afterAdd?.inventory.variantStock).toEqual([{ variantId: "v1", quantity: 15 }]);

    await adjustVariantStock(product.id, "v1", -20, "Big sale");
    const afterRemove = await getProduct(product.id);
    // Never goes negative — clamped at 0, and the returned adjustment
    // records the *actual* applied delta (for an accurate undo), not the
    // requested one.
    expect(afterRemove?.variants[0].inventoryQuantity).toBe(0);
    expect(afterRemove?.inventory.totalStock).toBe(0);
  });

  it("setVariantStock (direct entry) sets an exact quantity via the equivalent delta", async () => {
    const v = variant({ id: "v1", inventoryQuantity: 10 });
    const product = await createProduct({ name: "Hoodie", variants: [v] });

    const adj = await setVariantStock(product.id, "v1", 3, "Set exact quantity");
    expect(adj?.delta).toBe(-7);
    const after = await getProduct(product.id);
    expect(after?.variants[0].inventoryQuantity).toBe(3);
  });

  it("adjustVariantStock keeps other variants' quantities untouched", async () => {
    const v1 = variant({ id: "v1", title: "S", inventoryQuantity: 4 });
    const v2 = variant({ id: "v2", title: "M", inventoryQuantity: 6 });
    const product = await createProduct({ name: "Denim", variants: [v1, v2] });

    await adjustVariantStock(product.id, "v2", 4, "Restock M");
    const after = await getProduct(product.id);
    expect(after?.variants.find(v => v.id === "v1")?.inventoryQuantity).toBe(4);
    expect(after?.variants.find(v => v.id === "v2")?.inventoryQuantity).toBe(10);
    expect(after?.inventory.totalStock).toBe(14);
  });

  it("adjustVariantStock/setVariantStock return undefined for an unknown product or variant", async () => {
    expect(await adjustVariantStock("nope", "v1", 1, "x")).toBeUndefined();
    const product = await createProduct({ name: "Tee", variants: [variant({ id: "v1" })] });
    expect(await adjustVariantStock(product.id, "nope", 1, "x")).toBeUndefined();
  });

  it("adjustInventory still works for a product with no variants (single stock count)", async () => {
    const product = await createProduct({ name: "Sweatpants", variants: [] });
    await adjustInventory(product.id, undefined, 47, "Initial stock");
    const after = await getProduct(product.id);
    expect(after?.inventory.totalStock).toBe(47);
  });
});

describe("productService demo preview overlay (?bt_preview=seller&demo=1)", () => {
  beforeEach(() => {
    storage.clear();
    initProductService(null);
    initProductService("seller-a");
  });

  it("fresh state: no demo flag means an empty catalog, even though the seed exists", async () => {
    isPreviewDemoModeMock.mockReturnValue(false);
    expect(await getProducts()).toEqual([]);
    const stats = await getProductStats();
    expect(stats.total).toBe(0);
  });

  it("demo=1 overlays the seeded catalog alongside (never replacing) the real, empty store", async () => {
    isPreviewDemoModeMock.mockReturnValue(true);
    const seeded = await getProducts();
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every(p => p.id.startsWith("preview-product-"))).toBe(true);

    // A real product created meanwhile still shows up alongside the seed.
    await createProduct({ name: "My real product" });
    const merged = await getProducts();
    expect(merged.some(p => p.name === "My real product")).toBe(true);
    expect(merged.length).toBe(seeded.length + 1);
  });

  it("turning demo mode back off hides the seed again without having touched real storage", async () => {
    isPreviewDemoModeMock.mockReturnValue(true);
    await getProducts();
    isPreviewDemoModeMock.mockReturnValue(false);
    expect(await getProducts()).toEqual([]);
  });

  it("editing a demo product's stock mutates only the in-memory overlay, never AsyncStorage", async () => {
    isPreviewDemoModeMock.mockReturnValue(true);
    const [first] = await getProducts();
    const variantId = first.variants[0]?.id;
    expect(variantId).toBeTruthy();

    await adjustVariantStock(first.id, variantId!, 100, "Demo edit");
    const refreshed = await getProduct(first.id);
    expect(refreshed?.variants.find(v => v.id === variantId)?.inventoryQuantity)
      .toBe(first.variants[0].inventoryQuantity + 100);

    // Never persisted — no products key was ever written for this edit
    // (ensureInitialized's own bookkeeping keys are unrelated and fine).
    expect([...storage.keys()].some(k => k.startsWith('@brandthread/products'))).toBe(false);
  });
});
