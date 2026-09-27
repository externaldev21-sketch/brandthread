import { beforeEach, describe, expect, it, vi } from "vitest";

// Simulates AsyncStorage's real web backend throwing on every call — the
// failure mode a sandboxed/cross-origin preview iframe, Safari ITP, or a
// full storage quota can all produce (see lib/safeAsyncStorage.ts). Real
// AsyncStorage on web is a bare wrapper over window.localStorage with no
// try/catch of its own, so this is what "localStorage is blocked" looks
// like from cartService's point of view.
const { serviceRequest, storageState } = vi.hoisted(() => ({
  serviceRequest: vi.fn(),
  storageState: { blocked: false },
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(() =>
      storageState.blocked
        ? Promise.reject(new DOMException("Access is denied for this document.", "SecurityError"))
        : Promise.resolve(null)),
    setItem: vi.fn(() =>
      storageState.blocked
        ? Promise.reject(new DOMException("Access is denied for this document.", "SecurityError"))
        : Promise.resolve()),
    removeItem: vi.fn(() => Promise.resolve()),
    multiRemove: vi.fn(() => Promise.resolve()),
    getAllKeys: vi.fn(() => Promise.resolve([])),
  },
}));

vi.mock("@/lib/serviceConfig", () => ({
  serviceRequest,
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/lib/marketingPixels", () => ({
  trackAndRelayConversionEvent: vi.fn(() => false),
}));

import { addToCart, getCartForScreen, initCartService } from "./cartService";
import { __resetSafeStorageForTests } from "@/lib/safeAsyncStorage";
import type { BuyerProduct, BuyerProductVariant } from "./cartTypes";

function product(id: string): BuyerProduct {
  return {
    id,
    sellerId: `seller-${id}`,
    sellerName: `Seller ${id}`,
    sellerHandle: `@seller${id}`,
    name: `Product ${id}`,
    description: "",
    priceCents: 4800,
    imageUris: [],
    category: "Apparel",
    isPreOrder: false,
    cancellationPolicy: "",
    refundPolicy: "",
    options: [],
    variants: [],
    isActive: true,
    tags: [],
  };
}

function variant(id: string): BuyerProductVariant {
  return {
    id: `variant-${id}`,
    title: "M",
    optionValues: [],
    priceCents: 4800,
    inventoryQuantity: 7,
    isAvailable: true,
  };
}

describe("Cart persistence when the browser's storage throws (blocked/sandboxed web embedding)", () => {
  beforeEach(() => {
    storageState.blocked = true;
    __resetSafeStorageForTests();
    serviceRequest.mockReset();
    serviceRequest.mockResolvedValue({ items: [], savedItems: [] });
    // Matches the reported repro: a signed-in buyer, addToCart() from Shop
    // the Post on a web preview whose persistent storage is unavailable.
    initCartService("storage-blocked-test-user");
  });

  it("Add to cart still succeeds — the write never silently disappears", async () => {
    const result = await addToCart({ product: product("coat"), variant: variant("coat"), quantity: 1 });

    expect(result.success).toBe(true);
    expect(result.cart.items).toHaveLength(1);
    expect(result.cart.items[0].productName).toBe("Product coat");
  });

  it("the Cart screen's own read (getCartForScreen) sees the item that was just added", async () => {
    await addToCart({ product: product("coat"), variant: variant("coat"), quantity: 1 });

    const { cart, loadError } = await getCartForScreen();

    expect(loadError).toBe(false);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].productName).toBe("Product coat");
  });

  it("keeps working across multiple adds within the same tab, not just the first call", async () => {
    await addToCart({ product: product("coat"), variant: variant("coat"), quantity: 1 });
    await addToCart({ product: product("dress"), variant: variant("dress"), quantity: 1 });

    const { cart } = await getCartForScreen();

    expect(cart.items.map(i => i.productName).sort()).toEqual(["Product coat", "Product dress"]);
  });
});
