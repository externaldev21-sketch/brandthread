import { describe, expect, it } from "vitest";
import {
  PRIVATE_PROFILE_KEYS,
  toPublicPost,
  toPublicProduct,
  toPublicReview,
  toPublicSellerProfile,
  toPublicVariant,
} from "./publicProfile";

/** Every private key, set on a fake DB row, so a projection that spreads a row shows up. */
const leakyRow = () => ({
  ...Object.fromEntries(PRIVATE_PROFILE_KEYS.map((k) => [k, `secret-${k}`])),
  id: "id-1",
  clerkId: "user_1",
  productId: "prod-1",
  ownerId: "user_1",
  userId: "user_1",
  name: "Name",
  displayName: "Display",
  brandName: "Brand",
  orderId: "order-1",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  rating: 5,
  priceCents: 1000,
  stock: 3,
  category: "apparel",
  status: "active",
  mediaUrl: "https://x/y.jpg",
  mediaType: "photo",
  aspectRatio: "1:1",
  visibility: { isPublic: true },
  postStatus: "published",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  verified: true,
  accountType: "seller",
});

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) { out.add(k); keysDeep(v, out); }
  }
  return out;
}

function expectNoPrivateKeys(payload: unknown) {
  const keys = keysDeep(payload);
  const leaked = PRIVATE_PROFILE_KEYS.filter((k) => keys.has(k));
  expect(leaked).toEqual([]);
  expect(JSON.stringify(payload)).not.toContain("secret-");
}

describe("public profile projections", () => {
  it("seller profile keeps the public header and drops plan / standing / policy / contact fields", () => {
    const out = toPublicSellerProfile(leakyRow());
    expect(out).toMatchObject({ clerkId: "user_1", displayName: "Display", brandName: "Brand", verified: true });
    expectNoPrivateKeys(out);
  });

  it("variants drop sku and low-stock threshold but keep price and stock", () => {
    const out = toPublicVariant(leakyRow());
    expect(out).toMatchObject({ priceCents: 1000, stock: 3 });
    expectNoPrivateKeys(out);
  });

  it("products are allow-listed and carry only public variants", () => {
    const out = toPublicProduct(leakyRow(), [leakyRow()]);
    expect(out.variants).toHaveLength(1);
    expectNoPrivateKeys(out);
  });

  it("posts drop moderation and scheduling internals", () => {
    expectNoPrivateKeys(toPublicPost(leakyRow(), []));
  });

  it("reviews never expose the order id", () => {
    const out = toPublicReview({ ...leakyRow(), buyer_name: "Pat", buyer_avatar: null });
    expect(out).not.toHaveProperty("orderId");
    expect(out).toMatchObject({ rating: 5, buyer_name: "Pat" });
    expectNoPrivateKeys(out);
  });

  it("reviews accept raw snake_case SQL rows and still omit order_id", () => {
    const out = toPublicReview({ id: "r", buyer_id: "b", seller_id: "s", order_id: "o", rating: 4, created_at: "t" });
    expect(out).not.toHaveProperty("order_id");
    expect(out).not.toHaveProperty("orderId");
    expect(out.buyerId).toBe("b");
  });
});
