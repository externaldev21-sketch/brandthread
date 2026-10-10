import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, emailSubscribers, storefronts, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = req.headers["x-test-user"]; next(); },
}));
vi.mock("../../middlewares/rateLimit", () => ({ rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next() }));

const suffix = crypto.randomBytes(5).toString("hex");
const seller = `optin-seller-${suffix}`;
const buyer = `optin-buyer-${suffix}`;
let server: Server;
let base = "";

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@test.local`, name: "Seller", accountType: "seller" },
    { clerkId: buyer, email: `${buyer}@test.local`, name: "Buyer", accountType: "buyer" },
  ] as any);
  await db.insert(storefronts).values({ ownerId: seller, slug: `optin-${suffix}` } as any);
  const { default: router } = await import("../email-opt-in");
  const app = express();
  app.use(express.json());
  app.use("/api/buyer/email-opt-in", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(emailSubscribers).where(eq(emailSubscribers.sellerId, seller));
  await db.delete(storefronts).where(eq(storefronts.ownerId, seller));
  await db.delete(users).where(inArray(users.clerkId, [seller, buyer]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const post = (body: unknown, user = buyer) => fetch(`${base}/api/buyer/email-opt-in`, {
  method: "POST", headers: { "content-type": "application/json", "x-test-user": user }, body: JSON.stringify(body),
});

describe("POST /api/buyer/email-opt-in", () => {
  it("adds the buyer's account email to the store's list with its source", async () => {
    const res = await post({ sellerId: seller, source: "checkout" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "subscribed" });
    const [row] = await db.select().from(emailSubscribers)
      .where(and(eq(emailSubscribers.sellerId, seller), eq(emailSubscribers.email, `${buyer}@test.local`)));
    expect(row).toMatchObject({ status: "subscribed", source: "checkout" });
    expect(row.consentAt).not.toBeNull();
  });
  it("rejects unknown sources, unknown stores and your own store", async () => {
    expect((await post({ sellerId: seller, source: "banner" })).status).toBe(400);
    expect((await post({ sellerId: `nope-${suffix}`, source: "follow" })).status).toBe(404);
    expect((await post({ sellerId: seller, source: "follow" }, seller)).status).toBe(400);
  });
});
