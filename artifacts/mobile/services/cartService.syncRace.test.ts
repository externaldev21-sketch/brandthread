/**
 * "Add to cart leaves the cart empty" (signed-in buyers): the cart read that
 * follows an add must never let the server's older copy replace a local
 * change the server has not acknowledged yet.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { serviceRequest } = vi.hoisted(() => ({ serviceRequest: vi.fn() }));

const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
    removeItem: vi.fn((key: string) => { store.delete(key); return Promise.resolve(); }),
    multiRemove: vi.fn((keys: string[]) => { keys.forEach(k => store.delete(k)); return Promise.resolve(); }),
    getAllKeys: vi.fn(() => Promise.resolve(Array.from(store.keys()))),
  },
}));
vi.mock("@/lib/serviceConfig", () => ({ serviceRequest }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/lib/marketingPixels", () => ({ trackAndRelayConversionEvent: vi.fn(() => false) }));

import { addToCart, getCartForScreen, initCartService, resolveRemoteCart } from "./cartService";
import type { BuyerProduct, BuyerProductVariant, Cart } from "./cartTypes";

function product(id: string): BuyerProduct {
  return {
    id, sellerId: `seller-${id}`, sellerName: `Seller ${id}`, sellerHandle: `@seller${id}`,
    name: `Product ${id}`, description: "", priceCents: 2000, imageUris: [], category: "Apparel",
    isPreOrder: false, cancellationPolicy: "", refundPolicy: "", options: [], variants: [], isActive: true, tags: [],
  };
}
function variant(id: string, priceCents = 2000): BuyerProductVariant {
  return { id: `variant-${id}`, title: "M", optionValues: [], priceCents, inventoryQuantity: 10, isAvailable: true };
}
const serverLine = (id: string) => ({
  id: `line-${id}`, productId: id, variantId: `variant-${id}`, productName: `Product ${id}`, variantTitle: "M",
  sellerId: "seller-x", sellerName: "Seller X", priceCents: 1500, quantity: 1, maxQuantity: 5,
  isPreOrder: false, inventoryPolicy: "deny", isAvailable: true, addedAt: "2026-01-01T00:00:00.000Z",
});

/** A fake /api/buyer/cart that behaves like api-server/src/routes/cart-db.ts. */
function fakeServer(initial: { items: any[]; savedItems: any[] }, opts: { syncFails?: boolean; syncDelayMs?: number } = {}) {
  let state = initial;
  serviceRequest.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path === "/api/buyer/cart/sync") {
      if (opts.syncDelayMs) await new Promise(r => setTimeout(r, opts.syncDelayMs));
      if (opts.syncFails) throw new Error("API 500: sync failed");
      state = JSON.parse(init!.body!);
      return { ok: true };
    }
    if (path === "/api/buyer/cart") return state;
    throw new Error(`unexpected ${path}`);
  });
  return { get state() { return state; } };
}

describe("cart write-through sync — the added line survives the next read", () => {
  beforeEach(() => {
    store.clear();
    serviceRequest.mockReset();
    initCartService("sync-race-user");
  });

  it("keeps the added item when the cart screen loads while the sync is still in flight", async () => {
    const server = fakeServer({ items: [serverLine("old")], savedItems: [] }, { syncDelayMs: 30 });
    await addToCart({ product: product("new"), variant: variant("new", 4200), quantity: 2 });
    // "View bag" — read immediately, before the sync has landed.
    const { cart, loadError } = await getCartForScreen();
    expect(loadError).toBe(false);
    expect(cart.items.map(i => i.productId).sort()).toEqual(["new", "old"]);
    const added = cart.items.find(i => i.productId === "new")!;
    expect(added.quantity).toBe(2);
    expect(added.priceCents).toBe(4200);
    expect(server.state.items.map((i: any) => i.productId).sort()).toEqual(["new", "old"]);
  });

  it("keeps the added item when the sync failed and the server still has an older cart", async () => {
    fakeServer({ items: [serverLine("old")], savedItems: [] }, { syncFails: true });
    await addToCart({ product: product("new"), variant: variant("new"), quantity: 1 });
    const { cart } = await getCartForScreen();
    expect(cart.items.map(i => i.productId).sort()).toEqual(["new", "old"]);
    expect(cart.syncPending).toBe(true);
  });

  it("re-pushes a pending local cart on the next read instead of adopting the server copy", async () => {
    fakeServer({ items: [serverLine("old")], savedItems: [] }, { syncFails: true });
    await addToCart({ product: product("new"), variant: variant("new"), quantity: 1 });
    const server = fakeServer({ items: [serverLine("old")], savedItems: [] });
    await getCartForScreen();
    await getCartForScreen(); // waits for the queued re-push
    expect(server.state.items.map((i: any) => i.productId).sort()).toEqual(["new", "old"]);
  });

  it("does not lose the added item when every server row is a legacy pre-cents line", async () => {
    const legacy = { ...serverLine("legacy"), priceCents: undefined, price: 15 };
    fakeServer({ items: [legacy], savedItems: [] }, { syncFails: true });
    await addToCart({ product: product("new"), variant: variant("new"), quantity: 1 });
    const { cart } = await getCartForScreen();
    expect(cart.items.map(i => i.productId)).toEqual(["new"]);
  });

  it("still adopts the server cart (another device) once local changes are acknowledged", async () => {
    const server = fakeServer({ items: [], savedItems: [] });
    await addToCart({ product: product("a"), variant: variant("a"), quantity: 1 });
    await getCartForScreen();
    // Another device replaced the cart on the server.
    fakeServer({ items: [serverLine("other-device")], savedItems: [] });
    void server;
    const { cart } = await getCartForScreen();
    expect(cart.items.map(i => i.productId)).toEqual(["other-device"]);
  });
});

describe("resolveRemoteCart", () => {
  const local: Cart = { id: "c", items: [], savedItems: [], updatedAt: "t" };
  it("never adopts the server copy over a pending local cart", () => {
    expect(resolveRemoteCart({ ...local, syncPending: true }, { items: [serverLine("x")], savedItems: [] }).adoptedRemote).toBe(false);
  });
  it("adopts a non-empty server copy over an acknowledged local cart", () => {
    const r = resolveRemoteCart(local, { items: [serverLine("x")], savedItems: [] });
    expect(r.adoptedRemote).toBe(true);
    expect(r.cart.items).toHaveLength(1);
  });
  it("keeps the local cart when the server is empty", () => {
    expect(resolveRemoteCart(local, { items: [], savedItems: [] }).adoptedRemote).toBe(false);
  });
});
