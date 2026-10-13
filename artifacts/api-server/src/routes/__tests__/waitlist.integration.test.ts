import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, productVariants, products, waitlistEntries } from "@workspace/db";

// publishNotification is the feed row + push fan-out; capture what it is asked to send.
const published = vi.hoisted(() => [] as Array<{ userId: string; type: string; targetId?: string; pushChannelId?: string }>);

vi.mock("../notifications-feed", () => ({
  publishNotification: async (n: { userId: string; type: string; targetId?: string; pushChannelId?: string }) => { published.push(n); },
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.header("x-test-user");
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));

type WaitlistRow = typeof waitlistEntries.$inferSelect;

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `wl-seller-${suffix}`;
const otherSeller = `wl-other-${suffix}`;
const buyerA = `wl-buyer-a-${suffix}`;
const buyerB = `wl-buyer-b-${suffix}`;
const productIds: string[] = [];
let server: Server;
let base = "";

async function api(path: string, user?: string, method = "GET", body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(user ? { "x-test-user": user } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

async function makeProduct(stockM: number) {
  const [p] = await db.insert(products).values({ ownerId: seller, name: `Field Jacket ${suffix}`, status: "active" }).returning({ id: products.id });
  productIds.push(p.id);
  const [vM, vL] = await db.insert(productVariants).values([
    { productId: p.id, size: "M", sku: `WLR-M-${p.id}`, priceCents: 22000, stock: stockM },
    { productId: p.id, size: "L", sku: `WLR-L-${p.id}`, priceCents: 22000, stock: 0 },
  ]).returning({ id: productVariants.id });
  return { productId: p.id, vM: vM.id, vL: vL.id };
}

beforeAll(async () => {
  const router = (await import("../waitlist")).default;
  const app = express();
  app.use(express.json());
  app.use("/api/waitlist", router);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => { published.length = 0; });

afterAll(async () => {
  if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
  await new Promise<void>((r) => server.close(() => r()));
});

describe("buyer join / check / leave", () => {
  it("joins a sold-out variant, reports it, and leaves it", async () => {
    const { productId, vL } = await makeProduct(0);
    expect((await api("/api/waitlist/join", buyerA, "POST", { productId, variantId: vL })).body).toEqual({ joined: true });
    expect((await api(`/api/waitlist/check/${vL}`, buyerA)).body).toEqual({ joined: true });
    const [row] = await db.select().from(waitlistEntries).where(eq(waitlistEntries.variantId, vL));
    expect(row).toMatchObject({ userId: buyerA, sellerId: seller, variantLabel: "L" });

    expect((await api(`/api/waitlist/leave?productId=${productId}&variantId=${vL}`, buyerA, "DELETE")).body).toEqual({ left: true });
    expect((await api(`/api/waitlist/check/${vL}`, buyerA)).body).toEqual({ joined: false });
  });
});

describe("seller Notify now", () => {
  it("claims atomically and sends feed + push through the shared restock path, once per buyer", async () => {
    const { productId, vM, vL } = await makeProduct(0);
    await api("/api/waitlist/join", buyerA, "POST", { productId, variantId: vM });
    await api("/api/waitlist/join", buyerB, "POST", { productId, variantId: vL });
    await db.update(productVariants).set({ stock: 3 }).where(eq(productVariants.id, vM));

    const first = await api(`/api/waitlist/seller/notify/${vM}`, seller, "POST");
    expect(first).toEqual({ status: 200, body: { notified: 1 } });
    const sent = published.filter((p) => p.type === "waitlist_restock" && p.targetId === productId);
    expect(sent.map((p) => p.userId)).toEqual([buyerA]);
    // pushChannelId set: publishNotification also sends the push, not only a feed row.
    expect(sent[0].pushChannelId).toBe("stock");

    const rows = await db.select().from(waitlistEntries).where(eq(waitlistEntries.productId, productId));
    expect(rows.find((r: WaitlistRow) => r.userId === buyerA)?.notifiedAt).toBeTruthy();
    expect(rows.find((r: WaitlistRow) => r.userId === buyerB)?.notifiedAt).toBeNull();

    // Pressing again (or racing an automatic restock) never re-notifies.
    const again = await api(`/api/waitlist/seller/notify/${vM}`, seller, "POST");
    expect(again.body).toMatchObject({ notified: 0 });
    expect(published.filter((p) => p.type === "waitlist_restock" && p.targetId === productId)).toHaveLength(1);

    const demand = await api("/api/waitlist/seller", seller);
    const mRow = demand.body.find((r: any) => r.variantId === vM);
    expect(mRow).toMatchObject({ count: 1, notifiedCount: 1 });
  });

  it("refuses a size that is still out of stock and leaves its waitlist untouched", async () => {
    const { productId, vL } = await makeProduct(0);
    await api("/api/waitlist/join", buyerA, "POST", { productId, variantId: vL });
    const res = await api(`/api/waitlist/seller/notify/${vL}`, seller, "POST");
    expect(res.status).toBe(409);
    expect(published).toHaveLength(0);
    const [row] = await db.select().from(waitlistEntries).where(eq(waitlistEntries.variantId, vL));
    expect(row.notifiedAt).toBeNull();
  });

  it("404s for another seller's variant", async () => {
    const { productId, vM } = await makeProduct(5);
    await api("/api/waitlist/join", buyerA, "POST", { productId, variantId: vM });
    expect((await api(`/api/waitlist/seller/notify/${vM}`, otherSeller, "POST")).status).toBe(404);
    expect(published).toHaveLength(0);
  });
});
