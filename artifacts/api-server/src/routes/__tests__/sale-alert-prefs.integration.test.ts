import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { newOrderPushDelivery } from "../../lib/saleAlerts";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = auth.userId;
    next();
  },
}));

const suffix = crypto.randomBytes(8).toString("hex");
const sellerId = `sale-alerts-seller-${suffix}`;
let server: Server;
let base = "";

async function putPrefs(body: unknown) {
  return fetch(`${base}/api/notification-prefs`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await db.insert(users).values({
    clerkId: sellerId,
    email: `${sellerId}@test.local`,
    name: "Sale Alerts Seller",
    role: "seller",
    accountType: "seller",
  });
  auth.userId = sellerId;
  const { default: prefsRouter } = await import("../notification-prefs");
  const app = express();
  app.use(express.json());
  app.use("/api/notification-prefs", prefsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(users).where(eq(users.clerkId, sellerId));
  await new Promise((resolve) => server.close(resolve));
});

describe("seller sale alert preferences", () => {
  it("defaults the sale sound and haptic on", async () => {
    const body = await (await fetch(`${base}/api/notification-prefs`)).json() as any;
    expect(body.saleSound).toBe(true);
    expect(body.saleHaptic).toBe(true);
  });

  it("saves each switch on its own and keeps new-order pushes on", async () => {
    const res = await putPrefs({ saleSound: false });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.saleSound).toBe(false);
    expect(body.saleHaptic).toBe(true);
    expect(body.categories.new_orders).toBe(true);

    const [row] = await db.select({ preferences: users.notificationPreferences })
      .from(users).where(eq(users.clerkId, sellerId)).limit(1);
    expect(newOrderPushDelivery(row?.preferences)).toEqual({ pushSound: null, pushChannelId: "default" });

    const again = await (await putPrefs({ saleSound: true, saleHaptic: false })).json() as any;
    expect(again.saleSound).toBe(true);
    expect(again.saleHaptic).toBe(false);
  });

  it("rejects non-boolean values", async () => {
    expect((await putPrefs({ saleSound: "off" })).status).toBe(400);
    expect((await putPrefs({ saleHaptic: 0 })).status).toBe(400);
  });
});
