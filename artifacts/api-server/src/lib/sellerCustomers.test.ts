import { describe, expect, it } from "vitest";
import {
  buyerKey,
  guestKey,
  matchesCustomerSearch,
  mergeSellerCustomers,
  publicCustomer,
  topCustomers,
  type OrderGroup,
} from "./sellerCustomers";

const d = (s: string) => new Date(s);
const group = (g: Partial<OrderGroup>): OrderGroup => ({
  buyerId: null, guestEmail: null, customerIds: [], orderCount: 1, spentCents: 1000,
  lastOrderAt: d("2026-09-01T00:00:00Z"), firstOrderAt: d("2026-09-01T00:00:00Z"), shippingName: null, ...g,
});

describe("mergeSellerCustomers", () => {
  it("keeps guests apart by email instead of collapsing them", () => {
    const list = mergeSellerCustomers([
      group({ guestEmail: "a@x.com", spentCents: 500 }),
      group({ guestEmail: "b@x.com", spentCents: 700 }),
    ], [], []);
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.id).sort()).toEqual([guestKey("a@x.com"), guestKey("b@x.com")].sort());
    expect(list.every((c) => c.kind === "guest")).toBe(true);
    expect(list.find((c) => c.email === "a@x.com")?.name).toBe("a");
  });

  it("folds a guest checkout into the signed-in buyer with that account email, without exposing the account email", () => {
    const list = mergeSellerCustomers([
      group({ buyerId: "user_1", orderCount: 2, spentCents: 3000, lastOrderAt: d("2026-09-02T00:00:00Z"), firstOrderAt: d("2026-08-01T00:00:00Z") }),
      group({ guestEmail: "sam@x.com", orderCount: 1, spentCents: 1000, lastOrderAt: d("2026-09-05T00:00:00Z"), firstOrderAt: d("2026-09-05T00:00:00Z") }),
    ], [{ clerkId: "user_1", displayName: "Sam Lee", username: "samlee", email: "Sam@X.com" }], []);
    expect(list).toHaveLength(1);
    const [c] = list;
    expect(c).toMatchObject({
      id: buyerKey("user_1"), kind: "account", name: "Sam Lee", handle: "@samlee",
      orderCount: 3, totalSpentCents: 4000,
      lastOrderAt: "2026-09-05T00:00:00.000Z", firstOrderAt: "2026-08-01T00:00:00.000Z",
      email: "sam@x.com", // the checkout email they typed, not pulled from the account
    });
    const noGuest = mergeSellerCustomers([group({ buyerId: "user_1" })],
      [{ clerkId: "user_1", displayName: null, username: "samlee", email: "private@x.com" }], []);
    expect(noGuest[0]!.email).toBe("");
    expect(JSON.stringify(noGuest.map(publicCustomer))).not.toContain("private@x.com");
  });

  it("merges a hand-entered row by email or customer id, keeping its tags/notes, and lists unmatched rows with $0", () => {
    const list = mergeSellerCustomers([
      group({ guestEmail: "vip@x.com", spentCents: 9000 }),
      group({ customerIds: ["c-2"], spentCents: 2500 }),
    ], [], [
      { id: "c-1", name: "Vip Person", email: "VIP@x.com", phone: "555", tags: ["VIP"], notes: "Loves hoodies", createdAt: d("2026-01-01T00:00:00Z") },
      { id: "c-2", name: "Phone Order", email: "phone@x.com", phone: null, tags: [], notes: null, createdAt: d("2026-01-01T00:00:00Z") },
      { id: "c-3", name: "No Orders", email: "none@x.com", phone: null, tags: [], notes: null, createdAt: d("2026-02-01T00:00:00Z") },
    ]);
    expect(list).toHaveLength(3);
    const vip = list.find((c) => c.customerRowId === "c-1")!;
    expect(vip).toMatchObject({ name: "Vip Person", tags: ["VIP"], notes: "Loves hoodies", phone: "555", totalSpentCents: 9000, kind: "guest" });
    const phone = list.find((c) => c.customerRowId === "c-2")!;
    expect(phone).toMatchObject({ id: "c-2", totalSpentCents: 2500, orderCount: 1, kind: "manual" });
    const none = list.find((c) => c.customerRowId === "c-3")!;
    expect(none).toMatchObject({ id: "c-3", totalSpentCents: 0, orderCount: 0, lastOrderAt: null, createdAt: "2026-02-01T00:00:00.000Z" });
  });

  it("joins seller-created orders to the guest who shares the manual row's email", () => {
    const list = mergeSellerCustomers([
      group({ guestEmail: "x@x.com", spentCents: 100 }),
      group({ customerIds: ["c-9"], spentCents: 200 }),
    ], [], [{ id: "c-9", name: "X", email: "x@x.com", phone: null, tags: [], notes: null, createdAt: d("2026-01-01T00:00:00Z") }]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ totalSpentCents: 300, orderCount: 2, customerRowId: "c-9" });
  });
});

describe("topCustomers / search", () => {
  const list = mergeSellerCustomers(
    Array.from({ length: 25 }, (_, i) => group({ guestEmail: `g${i}@x.com`, spentCents: i * 100 })),
    [], [{ id: "c-0", name: "Zero", email: "zero@x.com", phone: null, tags: ["wholesale"], notes: null, createdAt: d("2026-01-01T00:00:00Z") }],
  );
  it("returns the 20 highest lifetime spenders, excluding people with no orders", () => {
    const top = topCustomers(list, 20);
    expect(top).toHaveLength(20);
    expect(top[0]!.totalSpentCents).toBe(2400);
    expect(top[19]!.totalSpentCents).toBe(500);
    expect(top.some((c) => c.customerRowId === "c-0")).toBe(false);
  });
  it("matches name, email and tags case-insensitively", () => {
    expect(list.filter((c) => matchesCustomerSearch(c, "WHOLESALE"))).toHaveLength(1);
    expect(list.filter((c) => matchesCustomerSearch(c, "g1"))).toHaveLength(11); // g1, g10..g19
  });
});
