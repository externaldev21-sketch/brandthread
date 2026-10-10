import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestContextualPushPermission, fakeApi } = vi.hoisted(() => ({
  requestContextualPushPermission: vi.fn(async () => {}),
  fakeApi: { push: { register: vi.fn() } },
}));

const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
    multiRemove: vi.fn(() => Promise.resolve()),
    getAllKeys: vi.fn(() => Promise.resolve(Array.from(store.keys()))),
  },
}));
vi.mock("@/lib/serviceConfig", () => ({ serviceRequest: vi.fn(async () => ({})) }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/lib/marketingPixels", () => ({ trackAndRelayConversionEvent: vi.fn(() => false) }));
vi.mock("@/lib/contextualPushPermission", () => ({ requestContextualPushPermission }));
vi.mock("@/lib/api", () => ({ api: fakeApi }));

import { addToCart, initCartService } from "./cartService";
import type { BuyerProduct, BuyerProductVariant } from "./cartTypes";

const product: BuyerProduct = {
  id: "p1", sellerId: "s1", sellerName: "Seller", sellerHandle: "@s", name: "Tee", description: "",
  priceCents: 2000, imageUris: [], category: "Apparel", isPreOrder: false, cancellationPolicy: "",
  refundPolicy: "", options: [], variants: [], isActive: true, tags: [],
};
const variant: BuyerProductVariant = {
  id: "v1", title: "Default", optionValues: [], priceCents: 2000, inventoryQuantity: 10, isAvailable: true,
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("add-to-cart push ask", () => {
  beforeEach(() => {
    store.clear();
    requestContextualPushPermission.mockClear();
  });

  it("asks a signed-in buyer after a successful add, with the real API client", async () => {
    initCartService("user_1");
    const result = await addToCart({ product, variant, quantity: 1 });
    await flush();
    expect(result.success).toBe(true);
    expect(requestContextualPushPermission).toHaveBeenCalledWith("user_1", fakeApi);
  });

  it("does not ask signed-out visitors", async () => {
    initCartService(null);
    await addToCart({ product, variant, quantity: 1 });
    await flush();
    expect(requestContextualPushPermission).not.toHaveBeenCalled();
  });

  it("does not ask when the add fails", async () => {
    initCartService("user_1");
    await addToCart({ product: { ...product, isActive: false }, variant, quantity: 1 });
    await flush();
    expect(requestContextualPushPermission).not.toHaveBeenCalled();
  });
});
