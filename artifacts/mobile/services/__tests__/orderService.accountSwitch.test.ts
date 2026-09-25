/**
 * Regression test for a bug where switching signed-in accounts on the same
 * device could still show the previous seller's orders, because the
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

import { getOrders, initOrderService, markProcessing } from "../orderService";

function seedOrder(key: string, orderId: string, orderNumber: string) {
  storage.set(
    key,
    JSON.stringify([
      {
        id: orderId,
        orderNumber,
        status: "new",
        fulfillmentStatus: "unfulfilled",
        paymentStatus: "paid",
        customer: { name: "Test Buyer", email: "buyer@example.com" },
        lineItems: [],
        shipments: [],
        returns: [],
        timeline: [],
        fulfillment: { isPicked: false, isPacked: false, groups: [] },
        payment: { totalCents: 1000 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]),
  );
}

describe("orderService account switching", () => {
  beforeEach(() => {
    storage.clear();
    // Force a real re-init regardless of which account a previous test in
    // this file left active — initOrderService() is a no-op when the
    // requested id already matches the current one.
    initOrderService(null);
  });

  it("never shows seller A's orders after switching to seller B", async () => {
    seedOrder("orders:seller-a:v1", "order_a1", "A-1001");
    initOrderService("seller-a");
    expect((await getOrders()).map((o) => o.orderNumber)).toEqual(["A-1001"]);

    // Switch accounts, as ServiceConfigurer does in app/_layout.tsx on a
    // Clerk user-id change (sign-out+sign-in as a different account).
    initOrderService("seller-b");
    expect(await getOrders()).toEqual([]);
  });

  it("cannot mutate seller A's order while scoped to seller B", async () => {
    seedOrder("orders:seller-a:v1", "order_a1", "A-1001");
    initOrderService("seller-a");
    await getOrders(); // hydrate the in-memory cache for seller A

    initOrderService("seller-b");
    const result = await markProcessing("order_a1");
    expect(result).toBeUndefined();
  });

  it("migrates a single pre-existing device's legacy unscoped orders into the first account that signs in", async () => {
    seedOrder("orders:v1", "order_legacy", "LEGACY-1");

    initOrderService("seller-a");
    expect((await getOrders()).map((o) => o.orderNumber)).toEqual(["LEGACY-1"]);

    // The legacy key must be gone so a second account can never inherit it.
    expect(storage.has("orders:v1")).toBe(false);

    initOrderService("seller-b");
    expect(await getOrders()).toEqual([]);
  });
});
