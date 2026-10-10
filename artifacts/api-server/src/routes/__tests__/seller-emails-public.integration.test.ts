import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";

process.env.EMAIL_TOKEN_SECRET = "seller-tips-test-secret";
const { default: router } = await import("../seller-emails-public");
const { sellerTipsUnsubscribeUrl } = await import("../../lib/sellerLifecycle/unsubscribe");

const clerkId = `tips-${crypto.randomBytes(5).toString("hex")}`;
let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values({ clerkId, email: `${clerkId}@test.local`, name: "Tips", accountType: "seller", notificationPreferences: { new_orders: true } } as any);
  const app = express();
  app.use("/api/public", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(users).where(eq(users.clerkId, clerkId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("seller tips unsubscribe", () => {
  it("GET only confirms; POST turns off the tips email and keeps other prefs", async () => {
    const path = new URL(sellerTipsUnsubscribeUrl(clerkId)!).pathname;
    const get = await fetch(`${base}${path}`);
    expect(get.status).toBe(200);
    expect(await get.text()).toContain("Stop these emails");
    let [row] = await db.select({ p: users.notificationPreferences }).from(users).where(eq(users.clerkId, clerkId));
    expect((row.p as any)["email:seller_tips"]).toBeUndefined();

    const post = await fetch(`${base}${path}`, { method: "POST" });
    expect(post.status).toBe(200);
    [row] = await db.select({ p: users.notificationPreferences }).from(users).where(eq(users.clerkId, clerkId));
    expect(row.p).toEqual({ new_orders: true, "email:seller_tips": false });
  });

  it("rejects a forged link", async () => {
    const res = await fetch(`${base}/api/public/seller-emails/unsubscribe/seller-tips:${clerkId}.forged`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});
