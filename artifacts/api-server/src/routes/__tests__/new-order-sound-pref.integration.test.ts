/**
 * Settings › Sounds & haptics › New order sound is stored as the seller
 * notification preference `new_order_sound` (default on). Buyers don't have it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { ORDER_SOUND_FILE, resolvePushSound } from "../../lib/push";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = auth.userId;
    next();
  },
}));

const suffix = crypto.randomBytes(8).toString("hex");
const sellerId = `order-sound-seller-${suffix}`;
const buyerId = `order-sound-buyer-${suffix}`;
let server: Server;
let base = "";

async function prefs(method: "GET" | "PUT", body?: unknown) {
  const res = await fetch(`${base}/api/notification-prefs`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: sellerId, email: `${sellerId}@test.local`, name: "Sound Seller", role: "seller", accountType: "seller" },
    { clerkId: buyerId, email: `${buyerId}@test.local`, name: "Sound Buyer", role: "buyer", accountType: "buyer" },
  ]);
  const { default: prefsRouter } = await import("../notification-prefs");
  const app = express();
  app.use(express.json());
  app.use("/api/notification-prefs", prefsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.clerkId, [sellerId, buyerId]));
  await new Promise((resolve) => server.close(resolve));
});

describe("new order sound preference", () => {
  it("is on by default for sellers", async () => {
    auth.userId = sellerId;
    const { body } = await prefs("GET");
    expect(body.categories.new_order_sound).toBe(true);
  });

  it("can be turned off, and new-order pushes then use the standard sound", async () => {
    auth.userId = sellerId;
    const { status, body } = await prefs("PUT", { categories: { new_order_sound: false } });
    expect(status).toBe(200);
    expect(body.categories.new_order_sound).toBe(false);
    expect(body.categories.new_orders).toBe(true);
    const [row] = await db.select({ p: users.notificationPreferences }).from(users).where(eq(users.clerkId, sellerId));
    expect(resolvePushSound(ORDER_SOUND_FILE, row.p)).toBe("default");
  });

  it("is not a buyer preference", async () => {
    auth.userId = buyerId;
    expect((await prefs("PUT", { categories: { new_order_sound: false } })).status).toBe(400);
  });
});
