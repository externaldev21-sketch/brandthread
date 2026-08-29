/**
 * Real development-DB coverage for the account erasure transaction.  Clerk and
 * auth are mocked only at the boundary; all deletion SQL runs against Postgres.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, buyerAddresses, cartItems, orders, pushTokens, returns, users } from "@workspace/db";

const state = vi.hoisted(() => ({
  userId: "",
  clerkCalls: 0,
  tombstoneExistedWhenClerkWasCalled: false,
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = state.userId;
    next();
  },
}));

vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: {
      deleteUser: async () => {
        state.clerkCalls += 1;
        // Import inside the hoisted mock factory to avoid accessing a static
        // binding before Vitest initializes it.
        const { db: liveDb, users: liveUsers } = await import("@workspace/db");
        const { eq: liveEq } = await import("drizzle-orm");
        const [{ deletedAt }] = await liveDb.select({ deletedAt: liveUsers.deletedAt })
          .from(liveUsers).where(liveEq(liveUsers.clerkId, state.userId)).limit(1);
        state.tombstoneExistedWhenClerkWasCalled = !!deletedAt;
      },
    },
  },
}));

let server: Server;
let base = "";
let orderId = "";
let returnId = "";

beforeAll(async () => {
  state.userId = `account-delete-test-${crypto.randomBytes(8).toString("hex")}`;
  const email = `${state.userId}@example.test`;
  await db.insert(users).values({
    clerkId: state.userId, email, name: "Disposable User", displayName: "Disposable User",
    accountType: "buyer", role: "buyer",
  });
  await db.insert(pushTokens).values({ userId: state.userId, token: `ExponentPushToken[${state.userId}]` });
  await db.insert(cartItems).values({ userId: state.userId, variantId: "disposable-variant", itemData: { private: true } });
  await db.insert(buyerAddresses).values({
    buyerId: state.userId, label: "Home", recipientName: "Disposable User",
    street: "1 Test Way", city: "Testville", state: "TS", postalCode: "00000",
  });
  const [order] = await db.insert(orders).values({
    ownerId: "retained-seller", buyerId: state.userId, orderNumber: `DELETE-${Date.now()}`,
    totalCents: 1000, subtotalCents: 1000, shippingAddress: {
      name: "Disposable User", street: "1 Test Way", city: "Testville", state: "TS", zip: "00000", country: "US",
    },
  }).returning({ id: orders.id });
  orderId = order.id;
  returnId = `delete-return-${crypto.randomBytes(6).toString("hex")}`;
  await db.insert(returns).values({
    id: returnId, orderId, buyerId: state.userId, sellerId: "retained-seller",
    reason: "test", notes: "private return note", evidenceUrls: ["https://private.example/evidence"],
  });

  const { default: authRouter } = await import("../auth");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(returns).where(eq(returns.id, returnId));
  await db.delete(orders).where(eq(orders.id, orderId));
  await db.delete(users).where(eq(users.clerkId, state.userId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("DELETE /api/auth/account", () => {
  it("erases private data, tombstones the local user, then deletes the Clerk subject", async () => {
    const response = await fetch(`${base}/api/auth/account`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "DELETE" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const [user] = await db.select().from(users).where(eq(users.clerkId, state.userId)).limit(1);
    expect(user.deletedAt).toBeInstanceOf(Date);
    expect(user.name).toBe("Deleted user");
    expect(user.email).toMatch(/^deleted\+/);
    expect(user.avatarUrl).toBeNull();
    expect(await db.select().from(pushTokens).where(eq(pushTokens.userId, state.userId))).toEqual([]);
    expect(await db.select().from(cartItems).where(eq(cartItems.userId, state.userId))).toEqual([]);
    expect(await db.select().from(buyerAddresses).where(eq(buyerAddresses.buyerId, state.userId))).toEqual([]);

    const [retainedOrder] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    expect(retainedOrder.buyerId).toBeNull();
    expect(retainedOrder.shippingAddress).toBeNull();
    const [retainedReturn] = await db.select().from(returns).where(eq(returns.id, returnId)).limit(1);
    expect(retainedReturn.notes).toBeNull();
    expect(retainedReturn.evidenceUrls).toEqual([]);
    expect(state.clerkCalls).toBe(1);
    expect(state.tombstoneExistedWhenClerkWasCalled).toBe(true);
  });
});