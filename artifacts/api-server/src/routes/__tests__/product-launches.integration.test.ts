import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import {
  db, follows, productLaunchAlerts, productLaunches, productPreorderTerms, productVariants, products, waitlistEntries,
} from "@workspace/db";

const published = vi.hoisted(() => [] as Array<{ userId: string; type: string; targetId?: string }>);

vi.mock("../notifications-feed", () => ({
  publishNotification: async (n: { userId: string; type: string; targetId?: string }) => { published.push(n); },
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.header("x-test-user");
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = user;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `launch-seller-${suffix}`;
const otherSeller = `launch-other-${suffix}`;
const buyerA = `launch-buyer-a-${suffix}`;
const buyerB = `launch-buyer-b-${suffix}`;
const follower = `launch-follower-${suffix}`;
const productIds: string[] = [];
let server: Server;
let base = "";

const HOUR = 3600 * 1000;
const future = (h: number) => new Date(Date.now() + h * HOUR);

async function api(path: string, user?: string, method = "GET", body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(user ? { "x-test-user": user } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

async function makeProduct(values: Partial<typeof products.$inferInsert> = {}) {
  const [p] = await db.insert(products).values({ ownerId: seller, name: `Launch Tee ${suffix}`, status: "active", ...values }).returning({ id: products.id });
  productIds.push(p.id);
  return p.id;
}

beforeAll(async () => {
  const launchRouter = (await import("../product-launches")).default;
  const termsRouter = (await import("../preorder-terms")).default;
  const app = express();
  app.use(express.json());
  app.use("/api/product-launches", launchRouter);
  app.use("/api/preorder-terms", termsRouter);
  await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => { published.length = 0; });

afterAll(async () => {
  await db.delete(follows).where(eq(follows.followingId, seller));
  if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
  await new Promise<void>((r) => server.close(() => r()));
});

describe("pre-order terms", () => {
  it("rejects a ship-by date beyond 60 days of closing with the max date, then accepts day 60", async () => {
    const closing = future(24 * 10);
    const id = await makeProduct({ isPreOrder: true, preOrderClosingDate: closing });
    const tooLate = new Date(closing.getTime() + 61 * 24 * HOUR);
    const bad = await api(`/api/preorder-terms/${id}`, seller, "PUT", { shipBy: tooLate.toISOString() });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("SHIP_BY_TOO_LATE");
    expect(typeof bad.body.maxShipBy).toBe("string");

    const ok = await api(`/api/preorder-terms/${id}`, seller, "PUT", { shipBy: bad.body.maxShipBy });
    expect(ok.status).toBe(200);
    expect(ok.body.refundWindowDays).toBe(60);
    expect(ok.body.refundCopy).toContain("you're refunded automatically");
  });

  it("rejects past dates, non pre-orders and other sellers", async () => {
    const id = await makeProduct({ isPreOrder: true });
    const past = await api(`/api/preorder-terms/${id}`, seller, "PUT", { shipBy: future(-48).toISOString() });
    expect(past.status).toBe(400);
    expect(past.body.code).toBe("SHIP_BY_IN_PAST");
    const other = await api(`/api/preorder-terms/${id}`, otherSeller, "PUT", { shipBy: future(48).toISOString() });
    expect(other.status).toBe(404);
    const plain = await makeProduct();
    const np = await api(`/api/preorder-terms/${plain}`, seller, "PUT", { shipBy: future(48).toISOString() });
    expect(np.status).toBe(409);
    expect((await api(`/api/preorder-terms/${id}`, undefined, "PUT", { shipBy: future(48).toISOString() })).status).toBe(401);
  });

  it("public GET exposes only active pre-order products with terms", async () => {
    const id = await makeProduct({ isPreOrder: true });
    expect((await api(`/api/preorder-terms/${id}`)).status).toBe(404); // no ship-by yet
    await api(`/api/preorder-terms/${id}`, seller, "PUT", { shipBy: future(24 * 20).toISOString(), note: "Ships from Lisbon" });
    const pub = await api(`/api/preorder-terms/${id}`);
    expect(pub.status).toBe(200);
    expect(pub.body.daysLeft).toBeGreaterThanOrEqual(19);
    expect(Object.keys(pub.body).sort()).toEqual(["closingDate", "daysLeft", "note", "refundCopy", "refundWindowDays", "shipBy"]);

    await db.update(products).set({ status: "draft" }).where(eq(products.id, id));
    expect((await api(`/api/preorder-terms/${id}`)).status).toBe(404);
    expect((await api(`/api/preorder-terms/not-a-uuid`)).status).toBe(404);
    await db.delete(productPreorderTerms).where(eq(productPreorderTerms.productId, id));
  });
});

describe("product launches", () => {
  it("seller schedules, lists with notify-me counts, cancels", async () => {
    const id = await makeProduct();
    expect((await api(`/api/product-launches/${id}`, seller, "PUT", { launchAt: future(-1).toISOString() })).status).toBe(400);
    expect((await api(`/api/product-launches/${id}`, otherSeller, "PUT", { launchAt: future(5).toISOString() })).status).toBe(404);
    const put = await api(`/api/product-launches/${id}`, seller, "PUT", { launchAt: future(5).toISOString(), notifyFollowers: true });
    expect(put.status).toBe(200);

    expect((await api(`/api/product-launches/${id}/alert`, buyerA, "POST")).body.subscribed).toBe(true);
    await api(`/api/product-launches/${id}/alert`, buyerA, "POST"); // idempotent
    await api(`/api/product-launches/${id}/alert`, buyerB, "POST");

    const list = await api(`/api/product-launches`, seller);
    const mine = list.body.find((r: any) => r.productId === id);
    expect(mine.alertCount).toBe(2);
    expect(mine.notifyFollowers).toBe(true);
    expect((await api(`/api/product-launches`, otherSeller)).body.find((r: any) => r.productId === id)).toBeUndefined();

    expect((await api(`/api/product-launches/${id}/alert`, buyerB, "DELETE")).body.subscribed).toBe(false);
    expect((await api(`/api/product-launches/${id}/alert`, buyerB)).body.subscribed).toBe(false);

    expect((await api(`/api/product-launches/${id}`, seller, "DELETE")).status).toBe(200);
    expect((await api(`/api/product-launches/${id}`)).body.launching).toBe(false);
  });

  it("public state never exposes subscribers and hides unpublished products", async () => {
    const id = await makeProduct();
    await api(`/api/product-launches/${id}`, seller, "PUT", { launchAt: future(3).toISOString() });
    await api(`/api/product-launches/${id}/alert`, buyerA, "POST");
    const pub = await api(`/api/product-launches/${id}`);
    expect(Object.keys(pub.body).sort()).toEqual(["launchAt", "launching", "serverNow"]);
    expect(pub.body.launching).toBe(true);

    await db.update(products).set({ status: "draft" }).where(eq(products.id, id));
    expect((await api(`/api/product-launches/${id}`)).body).toMatchObject({ launching: false, launchAt: null });
    expect((await api(`/api/product-launches/${id}/alert`, undefined, "POST")).status).toBe(401);
    expect((await api(`/api/product-launches`)).status).toBe(401);
  });

  it("notify-me is refused for products with no launch or already live", async () => {
    const plain = await makeProduct();
    expect((await api(`/api/product-launches/${plain}/alert`, buyerA, "POST")).status).toBe(404);
  });

  it("gates checkout for unlaunched products only", async () => {
    const { resolveChargePlan, CheckoutPlanError } = await import("../../lib/money/checkoutPlan");
    const gated = await makeProduct();
    const free = await makeProduct();
    await db.insert(productLaunches).values({ productId: gated, launchAt: future(2) });

    await expect(resolveChargePlan({ productIds: [gated], sellerId: seller })).rejects.toMatchObject({ code: "PRODUCT_NOT_LAUNCHED", status: 409 });
    await expect(resolveChargePlan({ productIds: [free, gated], sellerId: seller })).rejects.toBeInstanceOf(CheckoutPlanError);
    // No launch row: behaves exactly as before.
    await expect(resolveChargePlan({ productIds: [free], sellerId: seller })).resolves.toMatchObject({ chargeModel: "destination" });
    // Once the clock passes launchAt (even before the job runs) it is purchasable.
    await expect(resolveChargePlan({ productIds: [gated], sellerId: seller, now: future(3) })).resolves.toMatchObject({ chargeModel: "destination" });
  });

  it("launch job flips launched_at and notifies subscribers + followers exactly once", async () => {
    const { runProductLaunches } = await import("../../lib/productLaunch");
    const id = await makeProduct();
    await db.insert(productLaunches).values({ productId: id, launchAt: future(1), notifyFollowers: true });
    await db.insert(productLaunchAlerts).values([{ productId: id, userId: buyerA }, { productId: id, userId: follower }]);
    await db.insert(follows).values({ followerId: follower, followingId: seller }).onConflictDoNothing();
    await db.insert(follows).values({ followerId: buyerB, followingId: seller }).onConflictDoNothing();

    // Not due yet.
    const early = await runProductLaunches(new Date());
    expect(published.filter((p) => p.targetId === id)).toHaveLength(0);
    expect(early.launched >= 0).toBe(true);

    const due = future(2);
    await runProductLaunches(due);
    const sent = published.filter((p) => p.targetId === id && p.type === "product_launched");
    expect(sent.map((p) => p.userId).sort()).toEqual([buyerA, buyerB, follower].sort());

    // Re-runs (and overlapping runs) send nothing more.
    await Promise.all([runProductLaunches(due), runProductLaunches(due)]);
    await runProductLaunches(future(10));
    expect(published.filter((p) => p.targetId === id && p.type === "product_launched")).toHaveLength(3);

    const [row] = await db.select().from(productLaunches).where(eq(productLaunches.productId, id));
    expect(row.launchedAt).not.toBeNull();
    // Already launched: cannot reschedule, cannot subscribe.
    expect((await api(`/api/product-launches/${id}`, seller, "PUT", { launchAt: future(9).toISOString() })).status).toBe(409);
    expect((await api(`/api/product-launches/${id}/alert`, buyerB, "POST")).status).toBe(409);
  });

  it("does not notify followers when the toggle is off", async () => {
    const { runProductLaunches } = await import("../../lib/productLaunch");
    const id = await makeProduct();
    await db.insert(productLaunches).values({ productId: id, launchAt: future(1), notifyFollowers: false });
    await db.insert(productLaunchAlerts).values({ productId: id, userId: buyerA });
    await runProductLaunches(future(2));
    expect(published.filter((p) => p.targetId === id).map((p) => p.userId)).toEqual([buyerA]);
  });
});

describe("restock notifies the waitlist once", () => {
  it("notifies variant and product-level entries on restock, and never again", async () => {
    const { notifyBackInStock } = await import("../../lib/stockNotifications");
    const id = await makeProduct();
    const [vOut, vOther] = await db.insert(productVariants).values([
      { productId: id, size: "M", color: "Black", sku: `WL-M-${suffix}`, priceCents: 3000, stock: 0 },
      { productId: id, size: "L", color: "Black", sku: `WL-L-${suffix}`, priceCents: 3000, stock: 0 },
    ]).returning({ id: productVariants.id });
    await db.insert(waitlistEntries).values([
      { productId: id, variantId: vOut.id, userId: buyerA, sellerId: seller, productName: "Tee", variantLabel: "M / Black" },
      { productId: id, variantId: vOther.id, userId: buyerB, sellerId: seller, productName: "Tee", variantLabel: "L / Black" },
      { productId: id, variantId: null, userId: follower, sellerId: seller, productName: "Tee", variantLabel: "" },
    ]);

    // M is restocked; L is still out.
    await db.update(productVariants).set({ stock: 5 }).where(eq(productVariants.id, vOut.id));
    const input = { productId: id, ownerId: seller, productName: "Tee", previousStock: 0, newStock: 5 };
    await notifyBackInStock(input);
    let sent = published.filter((p) => p.type === "waitlist_restock" && p.targetId === id).map((p) => p.userId).sort();
    expect(sent).toEqual([buyerA, follower].sort());

    // Same restock signal again: nobody is re-notified.
    await notifyBackInStock(input);
    await notifyBackInStock({ ...input, variantId: vOut.id });
    expect(published.filter((p) => p.type === "waitlist_restock" && p.targetId === id)).toHaveLength(2);

    // L restocks later: only its waiter is notified.
    await db.update(productVariants).set({ stock: 2 }).where(eq(productVariants.id, vOther.id));
    await notifyBackInStock({ ...input, variantId: vOther.id, newStock: 2 });
    sent = published.filter((p) => p.type === "waitlist_restock" && p.targetId === id).map((p) => p.userId).sort();
    expect(sent).toEqual([buyerA, buyerB, follower].sort());

    const rows = await db.select().from(waitlistEntries).where(eq(waitlistEntries.productId, id));
    expect(rows.every((r) => r.notifiedAt)).toBe(true);
  });

  it("does nothing when stock did not go from zero to positive", async () => {
    const { notifyBackInStock } = await import("../../lib/stockNotifications");
    const id = await makeProduct();
    await db.insert(waitlistEntries).values({ productId: id, variantId: null, userId: buyerA, sellerId: seller, productName: "Tee" });
    await notifyBackInStock({ productId: id, ownerId: seller, productName: "Tee", previousStock: 3, newStock: 9 });
    expect(published).toHaveLength(0);
  });
});
