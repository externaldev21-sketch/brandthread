/**
 * Regression test for a bug where switching signed-in accounts on the same
 * device could still show the previous seller's products, because the
 * in-memory cache and AsyncStorage key were global instead of per-account.
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

import { createProduct, getProducts, initProductService } from "../productService";

describe("productService account switching", () => {
  beforeEach(() => {
    storage.clear();
    // Force a real re-init regardless of which account a previous test in
    // this file left active — initProductService() is a no-op when the
    // requested id already matches the current one.
    initProductService(null);
  });

  it("never shows seller A's products after switching to seller B", async () => {
    initProductService("seller-a");
    await createProduct({ name: "Seller A hoodie" });
    expect((await getProducts()).map((p) => p.name)).toEqual(["Seller A hoodie"]);

    // Switch accounts, as ServiceConfigurer does in app/_layout.tsx on a
    // Clerk user-id change (sign-out+sign-in as a different account).
    initProductService("seller-b");
    expect(await getProducts()).toEqual([]);

    await createProduct({ name: "Seller B tee" });
    expect((await getProducts()).map((p) => p.name)).toEqual(["Seller B tee"]);
  });

  it("keeps each account's catalog intact when switching back and forth", async () => {
    initProductService("seller-a");
    await createProduct({ name: "Seller A hoodie" });

    initProductService("seller-b");
    await createProduct({ name: "Seller B tee" });

    initProductService("seller-a");
    expect((await getProducts()).map((p) => p.name)).toEqual(["Seller A hoodie"]);

    initProductService("seller-b");
    expect((await getProducts()).map((p) => p.name)).toEqual(["Seller B tee"]);
  });

  it("clears the catalog on sign-out (null userId) so a guest never sees it", async () => {
    initProductService("seller-a");
    await createProduct({ name: "Seller A hoodie" });

    initProductService(null);
    expect(await getProducts()).toEqual([]);
  });

  it("migrates a single pre-existing device's legacy unscoped catalog into the first account that signs in", async () => {
    // Simulate data written before per-account scoping existed.
    storage.set(
      "@brandthread/products",
      JSON.stringify([{ id: "prod_legacy", name: "Legacy product", status: "active" }]),
    );

    initProductService("seller-a");
    const products = await getProducts();
    expect(products.map((p) => p.name)).toEqual(["Legacy product"]);

    // The legacy key must be gone so a second account can never inherit it.
    expect(storage.has("@brandthread/products")).toBe(false);

    initProductService("seller-b");
    expect(await getProducts()).toEqual([]);
  });
});
