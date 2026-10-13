import { describe, expect, it, vi } from "vitest";

const dbRows = vi.hoisted(() => [] as { orderId: string; images: unknown }[]);

vi.mock("@workspace/db", () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: async () => dbRows,
  };
  return { db: chain, orderItems: {}, productVariants: {}, products: {} };
});
vi.mock("drizzle-orm", () => ({ asc: () => null, inArray: () => null, eq: () => null }));

import { firstItemImageByOrder, orderIdsMissingImage, storedOrOrderImage } from "./orderNotificationImages";

const O1 = "11111111-1111-4111-8111-111111111111";
const O2 = "22222222-2222-4222-8222-222222222222";

describe("order photos for Activity rows", () => {
  it("only looks up order rows that have no stored image", () => {
    expect(orderIdsMissingImage([
      { targetType: "buyer_order", targetId: O1, targetImageUrl: null },
      { targetType: "buyer_order", targetId: O1 },
      { targetType: "order", targetId: O2, targetImageUrl: "https://img/x.jpg" },
      { targetType: "post", targetId: O2 },
      { targetType: "order", targetId: "shopify-123" },
    ])).toEqual([O1]);
  });

  it("maps each order to its first item's first photo", async () => {
    dbRows.splice(0, dbRows.length,
      { orderId: O1, images: [] },
      { orderId: O1, images: ["/objects/a.jpg", "/objects/b.jpg"] },
      { orderId: O1, images: ["/objects/c.jpg"] },
      { orderId: O2, images: null },
    );
    const map = await firstItemImageByOrder([O1, O2]);
    expect(map.get(O1)).toBe("/objects/a.jpg");
    expect(map.has(O2)).toBe(false);
    expect(await firstItemImageByOrder([])).toEqual(new Map());
  });

  it("prefers the stored image, then the order photo, never for non-order rows", () => {
    const byOrder = new Map([[O1, "/objects/a.jpg"]]);
    expect(storedOrOrderImage({ targetType: "buyer_order", targetId: O1, targetImageUrl: "https://img/x.jpg" }, byOrder)).toBe("https://img/x.jpg");
    expect(storedOrOrderImage({ targetType: "buyer_order", targetId: O1 }, byOrder)).toBe("/objects/a.jpg");
    expect(storedOrOrderImage({ targetType: "post", targetId: O1 }, byOrder)).toBeNull();
  });
});
