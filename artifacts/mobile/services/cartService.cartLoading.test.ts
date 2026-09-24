import { beforeEach, describe, expect, it, vi } from "vitest";

const { serviceRequest } = vi.hoisted(() => ({
  serviceRequest: vi.fn(),
}));

// Minimal in-memory AsyncStorage so cart persistence round-trips for real
// within the test instead of being stubbed away.
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
    multiRemove: vi.fn((keys: string[]) => { keys.forEach(k => store.delete(k)); return Promise.resolve(); }),
    getAllKeys: vi.fn(() => Promise.resolve(Array.from(store.keys()))),
  },
}));

vi.mock("@/lib/serviceConfig", () => ({
  serviceRequest,
}));

import {
  initCartService, getCartForScreen, addToCart, removeCartItems,
} from "./cartService";
import type { BuyerProduct, BuyerProductVariant } from "./cartTypes";

function product(id: string): BuyerProduct {
  return {
    id,
    sellerId: `seller-${id}`,
    sellerName: `Seller ${id}`,
    sellerHandle: `@seller${id}`,
    name: `Product ${id}`,
    description: "",
    priceCents: 2000,
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
    title: "Default",
    optionValues: [],
    priceCents: 2000,
    inventoryQuantity: 10,
    isAvailable: true,
  };
}

describe("Cart loading — real empty vs. failed-to-confirm", () => {
  beforeEach(() => {
    store.clear();
    serviceRequest.mockReset();
    initCartService("cart-load-test-user");
  });

  it("reports loadError=false for a cart that is genuinely empty (server confirms no items)", async () => {
    serviceRequest.mockResolvedValue({ items: [], savedItems: [] });

    const { cart, loadError } = await getCartForScreen();

    expect(cart.items).toHaveLength(0);
    expect(loadError).toBe(false);
  });

  it("reports loadError=true when the local cache is empty and the server check itself fails", async () => {
    serviceRequest.mockRejectedValue(new Error("network down"));

    const { cart, loadError } = await getCartForScreen();

    // We genuinely don't know whether the cart is empty — never claim it is.
    expect(cart.items).toHaveLength(0);
    expect(loadError).toBe(true);
  });

  it("never reports loadError when local items already exist, even if the server check fails", async () => {
    serviceRequest.mockResolvedValue({ items: [], savedItems: [] });
    await addToCart({ product: product("a"), variant: variant("a"), quantity: 1 });

    serviceRequest.mockRejectedValueOnce(new Error("timeout"));
    const { cart, loadError } = await getCartForScreen();

    expect(cart.items).toHaveLength(1);
    expect(loadError).toBe(false);
  });
});

describe("removeCartItems — scoped removal after a partial or single-item purchase", () => {
  beforeEach(() => {
    store.clear();
    serviceRequest.mockReset();
    serviceRequest.mockResolvedValue({ items: [], savedItems: [] });
    initCartService("cart-remove-test-user");
  });

  it("removes only the given item IDs, leaving every other cart line untouched", async () => {
    const first = await addToCart({ product: product("a"), variant: variant("a"), quantity: 1 });
    const second = await addToCart({ product: product("b"), variant: variant("b"), quantity: 2 });
    expect(second.cart.items).toHaveLength(2);

    const boughtId = first.cart.items[0].id;
    const remaining = await removeCartItems([boughtId]);

    expect(remaining.items).toHaveLength(1);
    expect(remaining.items[0].productId).toBe("b");
  });

  it("is a no-op when none of the given IDs are in the cart (e.g. an ephemeral Buy Now item)", async () => {
    await addToCart({ product: product("a"), variant: variant("a"), quantity: 1 });
    const result = await removeCartItems(["not-a-real-cart-line"]);
    expect(result.items).toHaveLength(1);
  });
});
