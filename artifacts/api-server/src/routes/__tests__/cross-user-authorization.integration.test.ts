/**
 * Cross-user authorization: user B must never read or change user A's orders,
 * products/variants, messages, saved boards or drops.
 *
 * Real Express routers + real Postgres. Only the identity layer is stubbed:
 * `requireAuth` reads the caller from the x-test-user header (the substitution
 * every route integration test here uses), and team context is a pass-through
 * so each caller acts as their own store.
 *
 * Seeded users use @example.test emails and every other row hangs off their
 * clerk ids (owner_id / buyer_id / user_id / sender_id), so the shared
 * purgeTestData hook in vitest.setup.ts also sweeps anything left behind.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  users,
  orders,
  orderItems,
  products,
  productVariants,
  customers,
  drops,
  conversations,
  conversationParticipants,
  messages,
  messageReactions,
  savedCollections,
  savedItems,
} from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.headers["x-test-user"];
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));

vi.mock("../../middlewares/requireRole", () => {
  const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return { teamContext: pass, requireRole: pass, requirePermission: pass };
});

vi.mock("../notifications-feed", () => ({ publishNotification: vi.fn(async () => {}) }));

const suffix = crypto.randomBytes(6).toString("hex");
const ALICE = `xuser-alice-${suffix}`; // seller A (and buyer of nothing)
const BOB = `xuser-bob-${suffix}`; // seller B / the attacker
const CAROL = `xuser-carol-${suffix}`; // buyer of Alice's order, Alice's DM partner

let server: Server;
let base = "";

const fixture = {
  orderId: "",
  orderItemId: "",
  productId: "",
  variantId: "",
  customerId: "",
  dropId: "",
  bobProductId: "",
  conversationId: "",
  messageId: "",
  collectionId: "",
};

async function call(user: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": user },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, body: json };
}

beforeAll(async () => {
  await db.insert(users).values([ALICE, BOB, CAROL].map((clerkId) => ({
    clerkId,
    email: `${clerkId}@example.test`,
    name: clerkId,
    displayName: clerkId,
    accountType: clerkId === CAROL ? "buyer" : "seller",
    onboardingComplete: true,
  })));

  const [product] = await db.insert(products).values({
    ownerId: ALICE, name: `Alice Tee ${suffix}`, status: "active",
  }).returning({ id: products.id });
  fixture.productId = product.id;
  const [variant] = await db.insert(productVariants).values({
    productId: product.id, sku: `XU-${suffix}`, priceCents: 2_500, stock: 7,
  }).returning({ id: productVariants.id });
  fixture.variantId = variant.id;

  const [bobProduct] = await db.insert(products).values({
    ownerId: BOB, name: `Bob Tee ${suffix}`, status: "draft",
  }).returning({ id: products.id });
  fixture.bobProductId = bobProduct.id;

  const [customer] = await db.insert(customers).values({
    ownerId: ALICE, name: "Alice's customer", email: `alice-customer-${suffix}@example.test`,
  }).returning({ id: customers.id });
  fixture.customerId = customer.id;

  const [drop] = await db.insert(drops).values({
    ownerId: ALICE, name: `Alice Drop ${suffix}`, type: "pre-made",
  }).returning({ id: drops.id });
  fixture.dropId = drop.id;

  const [order] = await db.insert(orders).values({
    ownerId: ALICE,
    buyerId: CAROL,
    orderNumber: `XU-${suffix}`,
    status: "processing",
    totalCents: 2_500,
    subtotalCents: 2_500,
    shippingCents: 0,
  }).returning({ id: orders.id });
  fixture.orderId = order.id;
  const [item] = await db.insert(orderItems).values({
    orderId: order.id, variantId: variant.id, productName: "Alice Tee", quantity: 1, priceCents: 2_500,
  }).returning({ id: orderItems.id });
  fixture.orderItemId = item.id;

  const [conversation] = await db.insert(conversations).values({
    type: "buyer_to_seller", lastMessage: "private hello", lastMessageAt: new Date(),
  }).returning({ id: conversations.id });
  fixture.conversationId = conversation.id;
  await db.insert(conversationParticipants).values([
    { conversationId: conversation.id, userId: ALICE },
    { conversationId: conversation.id, userId: CAROL },
  ]);
  const [message] = await db.insert(messages).values({
    conversationId: conversation.id, senderId: CAROL, body: "private hello",
  }).returning({ id: messages.id });
  fixture.messageId = message.id;

  const [collection] = await db.insert(savedCollections).values({
    userId: ALICE, name: "Alice's public board", isPublic: true,
  }).returning({ id: savedCollections.id });
  fixture.collectionId = collection.id;

  const [
    { default: ordersRouter },
    { default: productsRouter },
    { default: productVariantsRouter },
    { default: buyerRouter },
    { default: conversationsRouter },
    { default: savedRouter },
  ] = await Promise.all([
    import("../orders"),
    import("../products"),
    import("../product-variants"),
    import("../buyer"),
    import("../conversations"),
    import("../saved"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/orders", ordersRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/product-variants", productVariantsRouter);
  app.use("/api/buyer/saved", savedRouter);
  app.use("/api/buyer", buyerRouter);
  app.use("/api/conversations", conversationsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (fixture.conversationId) await db.delete(conversations).where(eq(conversations.id, fixture.conversationId));
  await db.delete(savedItems).where(inArray(savedItems.userId, [ALICE, BOB, CAROL]));
  await db.delete(savedCollections).where(inArray(savedCollections.userId, [ALICE, BOB, CAROL]));
  const orderRows = await db.select({ id: orders.id }).from(orders).where(inArray(orders.ownerId, [ALICE, BOB]));
  if (orderRows.length) {
    await db.delete(orderItems).where(inArray(orderItems.orderId, orderRows.map((o) => o.id)));
    await db.delete(orders).where(inArray(orders.id, orderRows.map((o) => o.id)));
  }
  const productRows = await db.select({ id: products.id }).from(products).where(inArray(products.ownerId, [ALICE, BOB]));
  if (productRows.length) {
    await db.delete(productVariants).where(inArray(productVariants.productId, productRows.map((p) => p.id)));
    await db.delete(products).where(inArray(products.id, productRows.map((p) => p.id)));
  }
  await db.delete(customers).where(inArray(customers.ownerId, [ALICE, BOB]));
  await db.delete(drops).where(inArray(drops.ownerId, [ALICE, BOB]));
  await db.delete(users).where(inArray(users.clerkId, [ALICE, BOB, CAROL]));
});

async function currentOrder() {
  const [row] = await db.select().from(orders).where(eq(orders.id, fixture.orderId));
  return row;
}

describe("orders — seller side", () => {
  it("the owning seller can read their order (control)", async () => {
    const res = await call(ALICE, "GET", `/api/orders/${fixture.orderId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(fixture.orderId);
  });

  it("another seller cannot read it, and it is absent from their list", async () => {
    expect((await call(BOB, "GET", `/api/orders/${fixture.orderId}`)).status).toBe(404);
    const list = await call(BOB, "GET", "/api/orders");
    expect(list.status).toBe(200);
    expect(list.body.map((o: any) => o.id)).not.toContain(fixture.orderId);
    // Filtering by Alice's buyer still only ever narrows Bob's own orders.
    const byBuyer = await call(BOB, "GET", `/api/orders?buyerId=${encodeURIComponent(CAROL)}`);
    expect(byBuyer.body).toEqual([]);
  });

  it("the buyer cannot use the seller endpoints for their own order", async () => {
    expect((await call(CAROL, "GET", `/api/orders/${fixture.orderId}`)).status).toBe(404);
  });

  it("another seller cannot change status, tracking, item shipments or the checklist", async () => {
    const before = await currentOrder();
    expect((await call(BOB, "PATCH", `/api/orders/${fixture.orderId}/status`, { status: "fulfilled" })).status).toBe(404);
    expect((await call(BOB, "PATCH", `/api/orders/${fixture.orderId}/status`, {
      status: "cancelled", reason: "fraud_risk",
    })).status).toBe(404);
    expect((await call(BOB, "PATCH", `/api/orders/${fixture.orderId}/tracking`, {
      trackingNumber: "1Z999", carrier: "UPS",
    })).status).toBe(404);
    const items = await call(BOB, "PATCH", `/api/orders/${fixture.orderId}/items-tracking`, {
      itemIds: [fixture.orderItemId], trackingNumber: "1Z999", carrier: "UPS",
    });
    expect(items.status).toBeGreaterThanOrEqual(400);
    expect(items.status).toBeLessThan(500);
    expect((await call(BOB, "PATCH", `/api/orders/${fixture.orderId}/fulfillment-checklist`, {
      isPicked: true,
    })).status).toBe(404);

    const after = await currentOrder();
    expect(after.status).toBe(before.status);
    expect(after.trackingNumber).toBe(before.trackingNumber);
    expect(after.carrier).toBe(before.carrier);
    expect(after.fulfillmentPicked).toBe(before.fulfillmentPicked);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.id, fixture.orderItemId));
    expect(item.trackingNumber ?? null).toBeNull();
  });

  it("a manual order cannot reference another seller's customer or drop", async () => {
    const items = [{ productName: "Custom piece", quantity: 1, priceCents: 1_000 }];
    const viaCustomer = await call(BOB, "POST", "/api/orders", { customerId: fixture.customerId, items });
    expect(viaCustomer.status).toBe(404);
    const viaDrop = await call(BOB, "POST", "/api/orders", { dropId: fixture.dropId, items });
    expect(viaDrop.status).toBe(404);
    const bobOrders = await db.select({ id: orders.id }).from(orders).where(eq(orders.ownerId, BOB));
    expect(bobOrders).toHaveLength(0);
  });

  it("a manual order cannot price another seller's variant", async () => {
    const res = await call(BOB, "POST", "/api/orders", {
      items: [{ variantId: fixture.variantId, productName: "Alice Tee", quantity: 1 }],
    });
    expect(res.status).toBe(404);
    const [variant] = await db.select({ stock: productVariants.stock }).from(productVariants)
      .where(eq(productVariants.id, fixture.variantId));
    expect(variant.stock).toBe(7);
  });
});

describe("orders — buyer side", () => {
  it("the buyer sees their own order detail (control)", async () => {
    const res = await call(CAROL, "GET", `/api/buyer/orders/${fixture.orderId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(fixture.orderId);
  });

  it("another user cannot read the buyer's order detail or list it", async () => {
    expect((await call(BOB, "GET", `/api/buyer/orders/${fixture.orderId}`)).status).toBe(404);
    const list = await call(BOB, "GET", "/api/buyer/orders");
    expect(list.status).toBe(200);
    const rows = Array.isArray(list.body) ? list.body : (list.body?.orders ?? []);
    expect(rows.map((o: any) => o.id)).not.toContain(fixture.orderId);
  });

  it("another user cannot cancel or confirm receipt of the buyer's order", async () => {
    const before = await currentOrder();
    const cancel = await call(BOB, "POST", `/api/buyer/orders/${fixture.orderId}/cancel`, {});
    expect([403, 404]).toContain(cancel.status);
    const confirm = await call(BOB, "POST", `/api/buyer/orders/${fixture.orderId}/confirm-receipt`, {});
    expect([403, 404]).toContain(confirm.status);
    const after = await currentOrder();
    expect(after.status).toBe(before.status);
    expect(after.deliveredAt).toEqual(before.deliveredAt);
  });
});

describe("products and variants", () => {
  async function currentProduct() {
    const [row] = await db.select().from(products).where(eq(products.id, fixture.productId));
    return row;
  }

  it("another seller cannot read, edit, archive, delete or restore the product", async () => {
    expect((await call(BOB, "GET", `/api/products/${fixture.productId}`)).status).toBe(404);
    expect((await call(BOB, "PUT", `/api/products/${fixture.productId}`, { name: "pwned", description: "x" })).status).toBe(404);
    expect((await call(BOB, "PUT", `/api/products/${fixture.productId}`, { status: "archived" })).status).toBe(404);
    expect((await call(BOB, "DELETE", `/api/products/${fixture.productId}`)).status).toBe(404);
    expect((await call(BOB, "POST", `/api/products/${fixture.productId}/restore`, {})).status).toBe(404);
    const product = await currentProduct();
    expect(product.name).toBe(`Alice Tee ${suffix}`);
    expect(product.status).toBe("active");
    expect(product.deletedAt).toBeNull();
  });

  it("another seller cannot add or change variants", async () => {
    expect((await call(BOB, "POST", `/api/products/${fixture.productId}/variants`, {
      sku: `BOB-${suffix}`, priceCents: 1,
    })).status).toBe(404);
    expect((await call(BOB, "PATCH", `/api/products/${fixture.productId}/variants/${fixture.variantId}`, {
      stock: 0, priceCents: 1,
    })).status).toBe(404);
    // Pairing Bob's own product id with Alice's variant id must not reach it either.
    expect((await call(BOB, "PATCH", `/api/products/${fixture.bobProductId}/variants/${fixture.variantId}`, {
      stock: 0, priceCents: 1,
    })).status).toBe(404);

    expect((await call(BOB, "GET", `/api/product-variants/${fixture.productId}`)).status).toBe(404);
    expect((await call(BOB, "PUT", `/api/product-variants/${fixture.productId}/axes`, {
      axes: [{ name: "Size", values: ["S"] }],
    })).status).toBe(404);
    expect((await call(BOB, "PATCH", `/api/product-variants/${fixture.productId}/variants/bulk`, {
      updates: [{ variantId: fixture.variantId, stock: 0 }],
    })).status).toBe(404);
    expect((await call(BOB, "PUT", `/api/product-variants/${fixture.productId}/stock-rules`, {
      soldOutBehavior: "archive",
    })).status).toBe(404);

    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, fixture.variantId));
    expect(variant.stock).toBe(7);
    expect(variant.priceCents).toBe(2_500);
    const variants = await db.select({ id: productVariants.id }).from(productVariants)
      .where(eq(productVariants.productId, fixture.productId));
    expect(variants).toHaveLength(1);
  });

  it("a seller cannot attach their listing to another seller's drop", async () => {
    const res = await call(BOB, "PUT", `/api/products/${fixture.bobProductId}`, { dropId: fixture.dropId });
    expect(res.status).toBe(404);
    const [row] = await db.select({ dropId: products.dropId }).from(products).where(eq(products.id, fixture.bobProductId));
    expect(row.dropId).toBeNull();
    // ...while their own product can still be detached / edited normally.
    expect((await call(BOB, "PUT", `/api/products/${fixture.bobProductId}`, { dropId: null })).status).toBe(200);
  });
});

describe("messages", () => {
  it("a participant can read the conversation (control)", async () => {
    expect((await call(ALICE, "GET", `/api/conversations/${fixture.conversationId}`)).status).toBe(200);
    const msgs = await call(CAROL, "GET", `/api/conversations/${fixture.conversationId}/messages`);
    expect(msgs.status).toBe(200);
  });

  it("an outsider cannot read the conversation or its messages", async () => {
    const conv = await call(BOB, "GET", `/api/conversations/${fixture.conversationId}`);
    expect(conv.status).toBe(404);
    const msgs = await call(BOB, "GET", `/api/conversations/${fixture.conversationId}/messages`);
    expect(msgs.status).toBe(403);
    expect(JSON.stringify(msgs.body)).not.toContain("private hello");
    const search = await call(BOB, "GET", `/api/conversations/${fixture.conversationId}/messages?q=private`);
    expect(search.status).toBe(403);
    const list = await call(BOB, "GET", "/api/conversations");
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(fixture.conversationId);
  });

  it("an outsider cannot post into, react in, mark, mute or delete the conversation", async () => {
    const post = await call(BOB, "POST", `/api/conversations/${fixture.conversationId}/messages`, { text: "injected" });
    expect([403, 404]).toContain(post.status);
    const react = await call(BOB, "PUT",
      `/api/conversations/${fixture.conversationId}/messages/${fixture.messageId}/reactions`, { reactionType: "love" });
    expect([403, 404]).toContain(react.status);
    const unreact = await call(BOB, "DELETE",
      `/api/conversations/${fixture.conversationId}/messages/${fixture.messageId}/reactions`);
    expect([403, 404]).toContain(unreact.status);
    expect([403, 404]).toContain((await call(BOB, "PATCH", `/api/conversations/${fixture.conversationId}/read`, {})).status);
    expect([403, 404]).toContain((await call(BOB, "PATCH", `/api/conversations/${fixture.conversationId}/mute`, { muted: true })).status);
    expect([403, 404]).toContain((await call(BOB, "DELETE", `/api/conversations/${fixture.conversationId}`)).status);

    const rows = await db.select().from(messages).where(eq(messages.conversationId, fixture.conversationId));
    expect(rows.map((m) => m.body)).toEqual(["private hello"]);
    expect(rows[0].readAt).toBeNull();
    const reactions = await db.select().from(messageReactions).where(eq(messageReactions.messageId, fixture.messageId));
    expect(reactions).toHaveLength(0);
    const [conv] = await db.select({ id: conversations.id }).from(conversations)
      .where(eq(conversations.id, fixture.conversationId));
    expect(conv?.id).toBe(fixture.conversationId);
  });

  it("a participant cannot react to a message by routing it through their own conversation", async () => {
    const [own] = await db.insert(conversations).values({ type: "buyer_to_seller" }).returning({ id: conversations.id });
    try {
      await db.insert(conversationParticipants).values([
        { conversationId: own.id, userId: BOB },
        { conversationId: own.id, userId: CAROL },
      ]);
      const res = await call(BOB, "PUT",
        `/api/conversations/${own.id}/messages/${fixture.messageId}/reactions`, { reactionType: "love" });
      expect(res.status).toBe(404);
      const reactions = await db.select().from(messageReactions).where(eq(messageReactions.messageId, fixture.messageId));
      expect(reactions).toHaveLength(0);
    } finally {
      await db.delete(conversations).where(eq(conversations.id, own.id));
    }
  });
});

describe("saved boards", () => {
  it("an item cannot be filed into another user's (public) board", async () => {
    const save = await call(BOB, "POST", "/api/buyer/saved", {
      type: "product", targetId: fixture.bobProductId, title: "Buy from Bob", collectionId: fixture.collectionId,
    });
    expect(save.status).toBe(404);

    const ownSave = await call(BOB, "POST", "/api/buyer/saved", {
      type: "product", targetId: fixture.bobProductId, title: "Bob's own save",
    });
    expect(ownSave.status).toBe(201);
    const move = await call(BOB, "PATCH", `/api/buyer/saved/${fixture.bobProductId}`, { collectionId: fixture.collectionId });
    expect(move.status).toBe(404);

    const onBoard = await db.select().from(savedItems).where(eq(savedItems.collectionId, fixture.collectionId));
    expect(onBoard).toHaveLength(0);
  });
});
