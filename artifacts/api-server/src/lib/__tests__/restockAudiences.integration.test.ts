import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  blocks, buyerPreferences, cartItems, db, notificationsFeed, productVariants, products,
  recentlyViewedProducts, restockPushLog, savedItems, users, waitlistEntries,
} from "@workspace/db";

const sent = vi.hoisted(() => ({
  pushes: [] as Array<{ userId: string; type: string; title: string; body: string; category?: string }>,
}));

vi.mock("../push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../push")>();
  return {
    ...actual,
    sendPushToUser: async (userId: string, payload: { title: string; body: string; data?: Record<string, unknown> }, category?: string) => {
      sent.pushes.push({ userId, type: String(payload.data?.type ?? ""), title: payload.title, body: payload.body, category });
      return true;
    },
  };
});

const suffix = crypto.randomBytes(6).toString("hex");
const u = (name: string) => `restock-${name}-${suffix}`;
const seller = u("seller");
const bagM = u("bag-m");                // M in bag, also saves it with tops M -> bag push only
const bagSavedForLater = u("bag-sfl");  // M saved for later -> nothing
const bagWaitlisted = u("bag-wait");    // M in bag + on the waitlist -> nothing from us
const bagBlocked = u("bag-blocked");    // M in bag, seller blocked them -> nothing
const bagL = u("bag-l");                // L in bag (still sold out) -> nothing
const saverM = u("saver-m");            // saved, tops M -> size back
const viewerM = u("viewer-m");          // viewed 2 days ago, tops "m" -> size back
const viewerOld = u("viewer-old");      // viewed 40 days ago, tops M -> nothing
const saverL = u("saver-l");            // saved, tops L -> nothing
const saverWaitlisted = u("saver-wait");// saved, tops M, waitlisted -> nothing
const viewerShoes = u("viewer-shoes");  // viewed, only shoes M -> nothing
const raceBag = u("race-bag");
const raceSaver = u("race-saver");
const wireBag = u("wire-bag");
const buyers = [bagM, bagSavedForLater, bagWaitlisted, bagBlocked, bagL, saverM, viewerM, viewerOld, saverL, saverWaitlisted, viewerShoes, raceBag, raceSaver, wireBag];
const everyone = [seller, ...buyers];
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

let productId = "";
let vM = "";
let vL = "";
let raceProductId = "";
let raceVariant = "";
let wireProductId = "";
let wireVariant = "";

const pushesFor = (ids: string[]) => sent.pushes.filter((p) => ids.includes(p.userId));

beforeAll(async () => {
  await db.insert(users).values(everyone.map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId,
    role: clerkId === seller ? "owner" : "buyer", accountType: clerkId === seller ? "seller" : "buyer",
  })));
  const [p, rp, wp] = await db.insert(products).values([
    { ownerId: seller, name: "Boxy tee", category: "Tops", status: "active" },
    { ownerId: seller, name: "Race tee", category: "Tops", status: "active" },
    { ownerId: seller, name: "Wire tee", category: "Tops", status: "active" },
  ]).returning({ id: products.id });
  productId = p.id; raceProductId = rp.id; wireProductId = wp.id;
  const variants = await db.insert(productVariants).values([
    { productId, size: "M", color: "Black", sku: `RS-M-${suffix}`, priceCents: 3000, stock: 0 },
    { productId, size: "L", color: "Black", sku: `RS-L-${suffix}`, priceCents: 3000, stock: 0 },
    { productId: raceProductId, size: "S", sku: `RS-RACE-${suffix}`, priceCents: 3000, stock: 0 },
    { productId: wireProductId, size: null, sku: `RS-WIRE-${suffix}`, priceCents: 3000, stock: 0 },
  ]).returning({ id: productVariants.id, sku: productVariants.sku });
  const bySku = Object.fromEntries(variants.map((v) => [v.sku, v.id]));
  vM = bySku[`RS-M-${suffix}`]; vL = bySku[`RS-L-${suffix}`];
  raceVariant = bySku[`RS-RACE-${suffix}`]; wireVariant = bySku[`RS-WIRE-${suffix}`];

  const line = { productName: "Boxy tee", variantTitle: "M / Black", quantity: 1, priceCents: 3000 };
  await db.insert(cartItems).values([
    { userId: bagM, variantId: vM, itemData: line },
    { userId: bagSavedForLater, variantId: vM, itemData: line, savedForLater: true },
    { userId: bagWaitlisted, variantId: vM, itemData: line },
    { userId: bagBlocked, variantId: vM, itemData: line },
    { userId: bagL, variantId: vL, itemData: line },
    { userId: raceBag, variantId: raceVariant, itemData: line },
    { userId: wireBag, variantId: wireVariant, itemData: line },
  ]);
  await db.insert(waitlistEntries).values([
    { productId, variantId: vM, userId: bagWaitlisted, sellerId: seller },
    { productId, variantId: null, userId: saverWaitlisted, sellerId: seller },
  ]);
  await db.insert(blocks).values({ blockerId: seller, blockedId: bagBlocked });
  await db.insert(savedItems).values([
    { userId: bagM, itemType: "product", targetId: productId },
    { userId: saverM, itemType: "product", targetId: productId },
    { userId: saverL, itemType: "product", targetId: productId },
    { userId: saverWaitlisted, itemType: "product", targetId: productId },
    { userId: raceSaver, itemType: "product", targetId: raceProductId },
  ]);
  await db.insert(recentlyViewedProducts).values([
    { userId: viewerM, productId, viewedAt: daysAgo(2) },
    { userId: viewerOld, productId, viewedAt: daysAgo(40) },
    { userId: viewerShoes, productId, viewedAt: daysAgo(1) },
  ]);
  await db.insert(buyerPreferences).values([
    { userId: bagM, sizes: { tops: "M" } },
    { userId: saverM, sizes: { tops: "M" } },
    { userId: viewerM, sizes: { tops: "m" } },
    { userId: viewerOld, sizes: { tops: "M" } },
    { userId: saverL, sizes: { tops: "L" } },
    { userId: saverWaitlisted, sizes: { tops: "M" } },
    { userId: viewerShoes, sizes: { shoes: "M" } },
    { userId: raceSaver, sizes: { tops: "S" } },
  ]);
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, everyone));
  await db.delete(restockPushLog).where(inArray(restockPushLog.userId, everyone));
  await db.delete(cartItems).where(inArray(cartItems.userId, everyone));
  await db.delete(savedItems).where(inArray(savedItems.userId, everyone));
  await db.delete(buyerPreferences).where(inArray(buyerPreferences.userId, everyone));
  await db.delete(blocks).where(eq(blocks.blockerId, seller));
  await db.delete(products).where(inArray(products.id, [productId, raceProductId, wireProductId]));
  await db.delete(users).where(inArray(users.clerkId, everyone));
});

describe("notifyRestockAudiences", () => {
  it("pushes the bag once, then the matching sizes, and holds the cooldown", async () => {
    const { notifyRestockAudiences } = await import("../restockAudiences");
    await db.update(productVariants).set({ stock: 5 }).where(eq(productVariants.id, vM));
    const input = { productId, ownerId: seller, productName: "Boxy tee", previousStock: 0, newStock: 5, variantId: vM };

    const first = await notifyRestockAudiences(input);
    expect(first.bag).toEqual([bagM]);
    expect(first.sizeBack.sort()).toEqual([saverM, viewerM].sort());

    expect(pushesFor(buyers).sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
      { userId: bagM, type: "bag_restock", category: "cart", title: "Back in stock", body: "Boxy tee, size M, from your bag is available again." },
      { userId: saverM, type: "size_back", category: "stock", title: "Your size is back", body: "Boxy tee is back in M." },
      { userId: viewerM, type: "size_back", category: "stock", title: "Your size is back", body: "Boxy tee is back in M." },
    ].sort((a, b) => a.userId.localeCompare(b.userId)));

    const feed = await db.select({ userId: notificationsFeed.userId, type: notificationsFeed.type, targetId: notificationsFeed.targetId, targetType: notificationsFeed.targetType })
      .from(notificationsFeed).where(inArray(notificationsFeed.userId, buyers));
    expect(feed).toHaveLength(3);
    expect(feed.every((f) => f.targetId === productId && f.targetType === "product")).toBe(true);

    // Flapping: sold out and restocked again inside the cooldown -> nothing new.
    const again = await notifyRestockAudiences(input);
    expect(again).toEqual({ bag: [], sizeBack: [] });
    expect(pushesFor(buyers)).toHaveLength(3);

    // Not a restock -> nothing at all.
    expect(await notifyRestockAudiences({ ...input, previousStock: 2 })).toEqual({ bag: [], sizeBack: [] });

    // After the 7-day cooldown the bag buyer can hear about it again.
    await db.update(restockPushLog).set({ sentAt: sql`now() - interval '8 days'` })
      .where(eq(restockPushLog.userId, bagM));
    const later = await notifyRestockAudiences(input);
    expect(later).toEqual({ bag: [bagM], sizeBack: [] });
    expect(pushesFor(buyers)).toHaveLength(4);
  }, 30_000);

  it("never double-sends under concurrent restock writers", async () => {
    const { notifyRestockAudiences } = await import("../restockAudiences");
    await db.update(productVariants).set({ stock: 3 }).where(eq(productVariants.id, raceVariant));
    const input = { productId: raceProductId, ownerId: seller, productName: "Race tee", previousStock: 0, newStock: 3, variantId: raceVariant };
    await Promise.all(Array.from({ length: 6 }, () => notifyRestockAudiences(input)));
    const race = pushesFor([raceBag, raceSaver]);
    expect(race.map((p) => `${p.userId}:${p.type}`).sort()).toEqual([`${raceBag}:bag_restock`, `${raceSaver}:size_back`].sort());
  }, 30_000);

  it("runs from notifyBackInStock without the seller waiting on it, and drops the size clause when there is none", async () => {
    const { notifyBackInStock } = await import("../stockNotifications");
    await db.update(productVariants).set({ stock: 2 }).where(eq(productVariants.id, wireVariant));
    await notifyBackInStock({ productId: wireProductId, ownerId: seller, productName: "Wire tee", previousStock: 0, newStock: 2, variantId: wireVariant });
    await vi.waitFor(() => expect(pushesFor([wireBag])).toHaveLength(1), { timeout: 5000 });
    expect(pushesFor([wireBag])[0]).toMatchObject({ type: "bag_restock", body: "Wire tee from your bag is available again." });
  }, 30_000);
});
