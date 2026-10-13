import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, dropEarlyAccessGrants, drops, follows, notificationsFeed, orders, products, users } from "@workspace/db";
import { buyerKey } from "../../lib/sellerCustomers";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    req.log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  },
}));

// Any push from this flow is a bug: the grant is an in-app Activity row only.
const pushSpy = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/push")>()),
  sendPushToUser: pushSpy,
}));

const sfx = crypto.randomBytes(5).toString("hex");
const id = (name: string) => `sfn-${sfx}-${name}`;
const SELLER = id("seller");
const OTHER = id("other");
const NODROP = id("nodrop");
const FAN = id("fan");
const FAN_TIE = id("fantie");
const buyers = Array.from({ length: 150 }, (_, i) => id(`b${i}`));
const userIds = [SELLER, OTHER, NODROP, FAN, FAN_TIE, ...buyers];

let server: Server;
let base = "";
let n = 0;
const order = (v: Partial<typeof orders.$inferInsert>) => ({
  ownerId: SELLER, orderNumber: `${id("o")}-${++n}`, status: "processing", totalCents: 1000, subtotalCents: 1000,
  paidAt: new Date(), ...v,
});

async function call(method: string, path: string, as = SELLER) {
  const r = await fetch(`${base}/api/customers${path}`, { method, headers: { "x-test-user-id": as } });
  return { status: r.status, body: await r.json() as any };
}

const HOUR = 3_600_000;
let nextDropId = "";
let laterDropId = "";
let productId = "";

beforeAll(async () => {
  await db.insert(users).values(userIds.map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId,
    displayName: clerkId === SELLER ? "Seller" : clerkId,
    brandName: clerkId === SELLER ? "Northbound" : null,
    username: clerkId.replace(/[^a-z0-9]/gi, "").slice(0, 28),
    role: "buyer", accountType: clerkId === SELLER || clerkId === OTHER ? "seller" : "buyer",
  })));

  // 150 signed-in buyers + 1 big guest + FAN/FAN_TIE = 153 customers with an
  // order -> ceil(1.53) = 2 superfans. The guest outspends everyone but can't
  // hold early access, so the slots go to FAN, then FAN_TIE (same spend as
  // b0, more orders).
  await db.insert(orders).values([
    ...buyers.map((buyerId, i) => order({ buyerId, totalCents: 1000 + (buyers.length - i) })),
    order({ guestEmail: "whale@guest.test", totalCents: 900_000 }),
    order({ buyerId: FAN, totalCents: 50_000 }),
    order({ buyerId: FAN_TIE, totalCents: 1000 + buyers.length - 100 }),
    order({ buyerId: FAN_TIE, totalCents: 100 }),
    // Cancelled orders don't count toward spend.
    order({ buyerId: buyers[149], totalCents: 999_999, status: "cancelled" }),
    // The other seller's huge sale to b149 never leaks into SELLER's ranking.
    order({ ownerId: OTHER, buyerId: buyers[149], totalCents: 500_000 }),
    order({ ownerId: NODROP, buyerId: FAN, totalCents: 1000 }),
  ]);

  const now = Date.now();
  const [past, next, later, otherDrop, closed] = await db.insert(drops).values([
    { ownerId: SELLER, name: "Past drop", type: "pre-made", status: "active", releaseAt: new Date(now - 24 * HOUR) },
    { ownerId: SELLER, name: "Winter Capsule", type: "pre-made", status: "active", releaseAt: new Date(now + 30 * 60_000) },
    { ownerId: SELLER, name: "Spring", type: "pre-made", status: "draft", releaseAt: new Date(now + 72 * HOUR) },
    { ownerId: OTHER, name: "Other brand drop", type: "pre-made", status: "active", releaseAt: new Date(now + 10 * 60_000) },
    { ownerId: SELLER, name: "Closed", type: "pre-made", status: "closed", releaseAt: new Date(now + 5 * 60_000) },
  ]).returning({ id: drops.id });
  void past; void otherDrop; void closed;
  nextDropId = next!.id;
  laterDropId = later!.id;
  const [p] = await db.insert(products).values({ ownerId: SELLER, name: id("product"), status: "active", dropId: nextDropId })
    .returning({ id: products.id });
  productId = p!.id;

  const { default: router } = await import("../customers");
  const app = express();
  app.use(express.json());
  app.use("/api/customers", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, userIds));
  await db.delete(products).where(eq(products.id, productId));
  await db.delete(drops).where(inArray(drops.ownerId, [SELLER, OTHER, NODROP])); // grants cascade
  await db.delete(follows).where(inArray(follows.followerId, userIds));
  await db.delete(orders).where(like(orders.orderNumber, `sfn-${sfx}-%`));
  await db.delete(users).where(inArray(users.clerkId, userIds));
});

describe("GET /api/customers?segment=superfans", () => {
  it("returns the top 1% of signed-in buyers by spend, orders breaking ties, guests excluded", async () => {
    const r = await call("GET", "?segment=superfans");
    expect(r.status).toBe(200);
    expect(r.body.map((c: any) => c.id)).toEqual([buyerKey(FAN), buyerKey(FAN_TIE)]);
    expect(r.body.every((c: any) => c.kind === "account")).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain("whale@guest.test");
  });

  it("isolates sellers", async () => {
    const r = await call("GET", "?segment=superfans", OTHER);
    expect(r.body.map((c: any) => c.id)).toEqual([buyerKey(buyers[149]!)]);
    expect(r.body[0].totalSpentCents).toBe(500_000);
  });

  it("is empty for a seller with no orders", async () => {
    const fresh = id("fresh");
    expect((await call("GET", "?segment=superfans", fresh)).body).toEqual([]);
  });
});

describe("Superfans early access", () => {
  it("reports the next drop (earliest future draft/active) before granting", async () => {
    const r = await call("GET", "/superfans/early-access");
    expect(r.status).toBe(200);
    expect(r.body.drop).toMatchObject({ id: nextDropId, name: "Winter Capsule", earlyAccessMinutes: 60 });
    expect(r.body).toMatchObject({ superfans: 2, granted: 0, allGranted: false });
  });

  it("409s with NO_UPCOMING_DROP when the seller has nothing scheduled", async () => {
    const r = await call("POST", "/superfans/early-access", NODROP);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("NO_UPCOMING_DROP");
    expect((await call("GET", "/superfans/early-access", NODROP)).body.drop).toBeNull();
  });

  it("grants every superfan the next drop in one call, and is idempotent", async () => {
    const first = await call("POST", "/superfans/early-access");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ dropId: nextDropId, dropName: "Winter Capsule", granted: 2, alreadyHad: 0 });

    const again = await call("POST", "/superfans/early-access");
    expect(again.body).toEqual({ dropId: nextDropId, dropName: "Winter Capsule", granted: 0, alreadyHad: 2 });

    const rows = await db.select().from(dropEarlyAccessGrants).where(eq(dropEarlyAccessGrants.dropId, nextDropId));
    expect(rows.map((r) => r.buyerId).sort()).toEqual([FAN, FAN_TIE].sort());
    expect(rows.every((r) => r.grantedBy === SELLER)).toBe(true);
    expect(await db.select().from(dropEarlyAccessGrants).where(eq(dropEarlyAccessGrants.dropId, laterDropId))).toHaveLength(0);

    expect((await call("GET", "/superfans/early-access")).body).toMatchObject({ granted: 2, allGranted: true });
  });

  it("tells each superfan once, in-app only, and sends no push", async () => {
    const rows = await db.select().from(notificationsFeed)
      .where(and(inArray(notificationsFeed.userId, userIds), eq(notificationsFeed.type, "drop_early_access")));
    expect(rows.map((r) => r.userId).sort()).toEqual([FAN, FAN_TIE].sort());
    expect(rows[0]).toMatchObject({
      title: "Northbound gave you early access to Winter Capsule",
      targetType: "drop", targetId: nextDropId, actorId: SELLER, category: "drops",
    });
    expect(pushSpy).not.toHaveBeenCalled();
  });
});

describe("checkout honours the grant during the early window", () => {
  it("lets a granted non-follower buy inside the 60-minute default window, and nobody else", async () => {
    const { resolveChargePlan } = await import("../../lib/money/checkoutPlan");
    const plan = (buyerId: string | null, now = new Date()) =>
      resolveChargePlan({ productIds: [productId], sellerId: SELLER, buyerId, now });

    // FAN holds a grant, doesn't follow SELLER; release is ~30 min away.
    await expect(plan(FAN)).resolves.toMatchObject({ chargeModel: "destination" });
    // A buyer without a grant (and a signed-out checkout) still waits.
    await expect(plan(buyers[0]!)).rejects.toMatchObject({ code: "DROP_NOT_LIVE" });
    await expect(plan(null)).rejects.toMatchObject({ code: "DROP_NOT_LIVE" });
    // Before the window opens (release - 60 min) even a grant doesn't help.
    const [drop] = await db.select({ releaseAt: drops.releaseAt }).from(drops).where(eq(drops.id, nextDropId));
    await expect(plan(FAN, new Date(drop!.releaseAt!.getTime() - 61 * 60_000))).rejects.toMatchObject({ code: "DROP_NOT_LIVE" });
  });

  it("uses the drop's own early-access window when it sets one", async () => {
    const { resolveChargePlan } = await import("../../lib/money/checkoutPlan");
    await db.update(drops).set({ earlyAccessMinutes: 15 }).where(eq(drops.id, nextDropId));
    try {
      const [drop] = await db.select({ releaseAt: drops.releaseAt }).from(drops).where(eq(drops.id, nextDropId));
      const at = (minutesBefore: number) => new Date(drop!.releaseAt!.getTime() - minutesBefore * 60_000);
      const plan = (buyerId: string, now: Date) => resolveChargePlan({ productIds: [productId], sellerId: SELLER, buyerId, now });
      await expect(plan(FAN, at(10))).resolves.toMatchObject({ chargeModel: "destination" });
      await expect(plan(FAN, at(20))).rejects.toMatchObject({ code: "DROP_NOT_LIVE" });
      // Follower early access is unchanged and composes with grants.
      await db.insert(follows).values({ followerId: buyers[0]!, followingId: SELLER });
      await expect(plan(buyers[0]!, at(10))).resolves.toMatchObject({ chargeModel: "destination" });
      await expect(plan(buyers[1]!, at(10))).rejects.toMatchObject({ code: "DROP_NOT_LIVE" });
    } finally {
      await db.update(drops).set({ earlyAccessMinutes: 0 }).where(eq(drops.id, nextDropId));
    }
  });
});
