import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, products, productVariants } from "@workspace/db";
import { withItemProductIds } from "../orderItemProducts";

const suffix = crypto.randomBytes(6).toString("hex");
let productId = "";
let variantId = "";

beforeAll(async () => {
  const [product] = await db.insert(products).values({
    ownerId: `oip-seller-${suffix}`, name: "Order Item Tee", status: "active",
  }).returning({ id: products.id });
  productId = product.id;
  const [variant] = await db.insert(productVariants).values({
    productId, sku: `oip-${suffix}`, priceCents: 1_000, stock: 1,
  }).returning({ id: productVariants.id });
  variantId = variant.id;
});

afterAll(async () => {
  await db.delete(products).where(eq(products.id, productId));
});

describe("withItemProductIds", () => {
  it("adds each line's product id (so order detail can link to the product) and null when the variant is gone", async () => {
    const items = await withItemProductIds([
      { id: "line-1", variantId, productName: "Order Item Tee" },
      { id: "line-2", variantId: null, productName: "Deleted variant" },
      { id: "line-3", variantId: crypto.randomUUID(), productName: "Unknown variant" },
    ]);
    expect(items.map((item) => item.productId)).toEqual([productId, null, null]);
    expect(items[0]).toMatchObject({ id: "line-1", productName: "Order Item Tee" });
  });

  it("returns an empty list unchanged", async () => {
    expect(await withItemProductIds([])).toEqual([]);
  });
});
