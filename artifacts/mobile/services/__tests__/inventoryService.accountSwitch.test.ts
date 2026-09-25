/**
 * Regression test for a bug where switching signed-in accounts on the same
 * device could still show the previous seller's inventory, because the
 * in-memory cache and AsyncStorage keys were global instead of per-account.
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

vi.mock("../../lib/serviceConfig", () => ({
  serviceRequest: vi.fn(),
}));

import { addLocation, getLocations, initInventoryService } from "../inventoryService";

describe("inventoryService account switching", () => {
  beforeEach(() => {
    storage.clear();
    // Force a real re-init regardless of which account a previous test in
    // this file left active — initInventoryService() is a no-op when the
    // requested id already matches the current one.
    initInventoryService(null);
  });

  it("never shows seller A's locations/stock after switching to seller B", async () => {
    initInventoryService("seller-a");
    await addLocation({ name: "Seller A Warehouse", type: "warehouse" });
    expect((await getLocations()).map((l) => l.name)).toEqual(["Seller A Warehouse"]);

    // Switch accounts, as ServiceConfigurer does in app/_layout.tsx on a
    // Clerk user-id change (sign-out+sign-in as a different account).
    initInventoryService("seller-b");
    expect(await getLocations()).toEqual([]);

    await addLocation({ name: "Seller B Studio", type: "home_studio" });
    expect((await getLocations()).map((l) => l.name)).toEqual(["Seller B Studio"]);
  });

  it("keeps each account's inventory intact when switching back and forth", async () => {
    initInventoryService("seller-a");
    await addLocation({ name: "Seller A Warehouse", type: "warehouse" });

    initInventoryService("seller-b");
    await addLocation({ name: "Seller B Studio", type: "home_studio" });

    initInventoryService("seller-a");
    expect((await getLocations()).map((l) => l.name)).toEqual(["Seller A Warehouse"]);
  });

  it("migrates a single pre-existing device's legacy unscoped inventory into the first account that signs in", async () => {
    storage.set(
      "inv:locations:v1",
      JSON.stringify([{ id: "loc_legacy", name: "Legacy Warehouse", type: "warehouse", isArchived: false }]),
    );

    initInventoryService("seller-a");
    expect((await getLocations()).map((l) => l.name)).toEqual(["Legacy Warehouse"]);

    // The legacy key must be gone so a second account can never inherit it.
    expect(storage.has("inv:locations:v1")).toBe(false);

    initInventoryService("seller-b");
    expect(await getLocations()).toEqual([]);
  });
});
