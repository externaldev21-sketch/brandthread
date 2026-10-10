import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = req.headers["x-test-user"]; next(); },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const suffix = crypto.randomBytes(5).toString("hex");
const seller = `ret-seller-${suffix}`;
const native = `ret-native-${suffix}`;
const sub: any = { id: `sub_${suffix}`, status: "active", pause_collection: null, metadata: {} };
const stripe = {
  subscriptions: {
    retrieve: vi.fn(async () => sub),
    update: vi.fn(async (_id: string, body: any) => { Object.assign(sub, { pause_collection: body.pause_collection || null, metadata: body.metadata ?? sub.metadata }); return sub; }),
  },
};
let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@test.local`, name: "S", accountType: "seller", subscriptionId: sub.id, subscriptionStatus: "active" },
    { clerkId: native, email: `${native}@test.local`, name: "N", accountType: "seller", subscriptionId: "rc_app_store_123", subscriptionStatus: "active" },
  ] as any);
  const mod = await import("../subscription-retention");
  mod.setRetentionStripe(stripe as any);
  const app = express();
  app.use(express.json());
  app.use("/r", mod.default);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => { stripe.subscriptions.update.mockClear(); });

afterAll(async () => {
  await db.delete(users).where(inArray(users.clerkId, [seller, native]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const call = (path: string, user: string, method = "POST") => fetch(`${base}/r${path}`, { method, headers: { "x-test-user": user, "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });

describe("subscription retention", () => {
  it("offers a pause to a Stripe subscriber", async () => {
    const res = await call("/offers", seller, "GET");
    expect(await res.json()).toEqual({ provider: "stripe", pause: { available: true, paused: false, resumesAt: null, nextPauseAt: null } });
  });

  it("pauses billing for 30 days and puts the store on vacation", async () => {
    const res = await call("/pause", seller);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paused).toBe(true);
    const [, update] = stripe.subscriptions.update.mock.calls[0] as any[];
    expect(update.pause_collection.behavior).toBe("void");
    expect(update.metadata.lastPausedAt).toBeTruthy();
    const [row] = await db.select({ vacationMode: users.vacationMode, vacationUntil: users.vacationUntil, msg: users.vacationMessage })
      .from(users).where(eq(users.clerkId, seller));
    expect(row.vacationMode).toBe(true);
    expect(row.vacationUntil?.toISOString()).toBe(body.resumesAt);
    expect(row.msg).toMatch(/^We're taking a short break\. Back on /);
  });

  it("resumes early and turns vacation off; a second pause within 6 months is refused", async () => {
    expect((await call("/resume", seller)).status).toBe(200);
    const [row] = await db.select({ vacationMode: users.vacationMode }).from(users).where(eq(users.clerkId, seller));
    expect(row.vacationMode).toBe(false);
    const again = await call("/pause", seller);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "PAUSE_UNAVAILABLE" });
  });

  it("sends App Store / Play subscribers to the store", async () => {
    expect((await call("/pause", native)).status).toBe(409);
    expect(await (await call("/offers", native, "GET")).json()).toMatchObject({ provider: "store", pause: { available: false } });
  });
});
