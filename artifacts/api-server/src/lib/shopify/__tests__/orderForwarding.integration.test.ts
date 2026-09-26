import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db, orders, orderItems, products, productVariants,
  shopifyConnections, shopifyProductLinks, shopifyOrderLinks,
} from "@workspace/db";

const createOrder = vi.fn(async () => ({ order: { id: 999888777, name: "#1001" } }));

vi.mock("../adminClient", () => ({
  ShopifyAdminClient: vi.fn().mockImplementation(function ShopifyAdminClientMock(this: any) {
    this.createOrder = createOrder;
  }),
}));

beforeAll(() => {
  process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
});

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `shopify-fwd-seller-${suffix}`;
let productId = "";
let variantId = "";
let orderId = "";

beforeAll(async () => {
  const { encryptSecret } = await import("../../shopifyCrypto");

  const [product] = await db.insert(products).values({
    ownerId: sellerId, name: "Fulfillment test tee", category: "apparel", status: "active",
  }).returning({ id: products.id });
  productId = product.id;

  const [variant] = await db.insert(productVariants).values({
    productId, sku: `SKU-${suffix}`, priceCents: 2000, stock: 10,
  }).returning({ id: productVariants.id });
  variantId = variant.id;

  await db.insert(shopifyConnections).values({
    ownerId: sellerId,
    shopDomain: "fwd-test.myshopify.com",
    accessTokenEncrypted: encryptSecret("shpat_test_token"),
    connectionType: "custom_app",
    scopes: "read_products,read_inventory,read_orders,write_orders,read_fulfillments",
    fulfillmentEnabled: true,
  });

  await db.insert(shopifyProductLinks).values({
    ownerId: sellerId,
    shopifyProductId: "111222333",
    brandthreadProductId: productId,
    variantMap: { [variantId]: "444555666" },
  });

  const [order] = await db.insert(orders).values({
    ownerId: sellerId,
    orderNumber: `SHOPFWD-${suffix}`,
    status: "pending",
    totalCents: 2000,
    subtotalCents: 2000,
    guestEmail: "buyer@example.com",
    stripeCheckoutSessionId: `cs_shopfwd_${suffix}`,
  }).returning({ id: orders.id });
  orderId = order.id;

  await db.insert(orderItems).values({
    orderId, variantId, productName: "Fulfillment test tee", quantity: 2, priceCents: 2000,
  });
});

afterAll(async () => {
  await db.delete(shopifyOrderLinks).where(eq(shopifyOrderLinks.brandthreadOrderId, orderId));
  await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
  await db.delete(orders).where(eq(orders.id, orderId));
  await db.delete(shopifyProductLinks).where(eq(shopifyProductLinks.ownerId, sellerId));
  await db.delete(shopifyConnections).where(eq(shopifyConnections.ownerId, sellerId));
  await db.delete(productVariants).where(eq(productVariants.productId, productId));
  await db.delete(products).where(eq(products.id, productId));
});

describe("forwardOrderToShopifyIfLinked", () => {
  it("creates exactly one Shopify order even when called twice (idempotent)", async () => {
    const { forwardOrderToShopifyIfLinked } = await import("../orderForwarding");

    await Promise.all([
      forwardOrderToShopifyIfLinked(orderId),
      forwardOrderToShopifyIfLinked(orderId),
    ]);
    await forwardOrderToShopifyIfLinked(orderId); // a later retry (e.g. a redelivered event) is also a no-op

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [{ variant_id: 444555666, quantity: 2 }],
      financial_status: "paid",
      note: expect.stringContaining(`Brandthread order #SHOPFWD-${suffix}`),
    }));

    const [link] = await db.select().from(shopifyOrderLinks).where(eq(shopifyOrderLinks.brandthreadOrderId, orderId));
    expect(link.status).toBe("sent");
    expect(link.shopifyOrderId).toBe("999888777");
  });
});
