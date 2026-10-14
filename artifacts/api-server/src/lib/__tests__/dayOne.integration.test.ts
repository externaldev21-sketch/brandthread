/**
 * "Day 1" badge, against real Postgres:
 *  - ranks 1..100 per brand, never more, never twice for one buyer, no gaps
 *    under concurrent orders; a seller buying from themself doesn't count;
 *  - the real paid-order webhook awards it;
 *  - the brand's comments carry dayOne for those buyers only, and only on
 *    that brand's posts;
 *  - GET /api/day-one/:userId lists the brands (empty across a block);
 *  - the migration's backfill ranks existing buyers by first paid order.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("../money/__tests__/fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../push")>()),
  sendPushToUser: async () => {},
}));
vi.mock("../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const who = req.header("x-test-user");
    if (!who) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = who;
    next();
  },
}));
vi.mock("../../middlewares/rateLimit", () => ({ rateLimit: () => (_q: any, _s: any, next: () => void) => next() }));
vi.mock("../safety", async (orig) => {
  const actual: any = await orig();
  return { ...actual, optionalViewerId: (req: any) => req.header("x-test-user") || null };
});

import { and, eq, inArray, sql } from "drizzle-orm";
import { blocks, brandDayOneBuyers, db, orders, postComments, posts, users } from "@workspace/db";
import { DAY_ONE_LIMIT, awardDayOne, dayOneAmong } from "../dayOne";
import { pay, seedBuyer, seedProduct, seedSeller, startApp, uid } from "../money/__tests__/moneyHarness";
import commentsRouter from "../../routes/post-comments";
import dayOneRouter from "../../routes/day-one";

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/posts", commentsRouter);
    server.use("/api/day-one", dayOneRouter);
  });
});
afterAll(async () => { await app.close(); });

async function call(p: string, user: string | null) {
  const res = await fetch(`${app.base}${p}`, { headers: user ? { "x-test-user": user } : {} });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const ranksFor = (sellerId: string) =>
  db.select({ buyerId: brandDayOneBuyers.buyerId, rank: brandDayOneBuyers.rank }).from(brandDayOneBuyers)
    .where(eq(brandDayOneBuyers.sellerId, sellerId)).orderBy(brandDayOneBuyers.rank);

describe("awardDayOne", () => {
  it("gives ranks 1..100 with no gaps under concurrent orders, then stops", async () => {
    const seller = uid("d1-seller");
    const buyers = Array.from({ length: DAY_ONE_LIMIT + 20 }, (_, i) => uid(`d1-buyer-${i}`));
    // All at once, each in its own transaction, like simultaneous paid webhooks.
    await Promise.all(buyers.map((b) => db.transaction((tx) => awardDayOne(tx, seller, b, null))));
    const rows = await ranksFor(seller);
    expect(rows).toHaveLength(DAY_ONE_LIMIT);
    expect(rows.map((r) => r.rank)).toEqual(Array.from({ length: DAY_ONE_LIMIT }, (_, i) => i + 1));
    expect(new Set(rows.map((r) => r.buyerId)).size).toBe(DAY_ONE_LIMIT);
  });

  it("is a no-op for a repeat buyer and for the seller themself", async () => {
    const seller = uid("d1-seller");
    const b = uid("d1-buyer");
    expect(await db.transaction((tx) => awardDayOne(tx, seller, b, null))).toBe(1);
    expect(await db.transaction((tx) => awardDayOne(tx, seller, b, null))).toBe(1);
    expect(await db.transaction((tx) => awardDayOne(tx, seller, seller, null))).toBeNull();
    expect(await ranksFor(seller)).toEqual([{ buyerId: b, rank: 1 }]);
  });

  it("is awarded by the real paid-order webhook", async () => {
    const seller = await seedSeller("d1-pay");
    const buyer = await seedBuyer("d1-pay");
    const product = await seedProduct(seller, { priceCents: 3_000, stock: 5 });
    const { order } = await pay({
      sellerId: seller, buyerId: buyer, chargeModel: "transfer",
      items: [{ variantId: product.variantId, productName: product.productName, priceCents: 3_000, quantity: 1 }],
    });
    const [row] = await db.select().from(brandDayOneBuyers)
      .where(and(eq(brandDayOneBuyers.sellerId, seller), eq(brandDayOneBuyers.buyerId, buyer)));
    expect(row).toMatchObject({ rank: 1, orderId: order.id });
    expect([...(await dayOneAmong(seller, [buyer, "someone-else"]))]).toEqual([buyer]);
  });
});

describe("where the badge shows", () => {
  it("marks the brand's comments by Day 1 buyers only, and lists the brands on the profile", async () => {
    const brand = await seedSeller("d1-brand");
    const otherBrand = await seedSeller("d1-other");
    const fan = await seedBuyer("d1-fan");
    const newcomer = await seedBuyer("d1-new");
    const blocker = await seedBuyer("d1-blocker");
    await db.update(users).set({ brandName: "Northline", accountType: "seller" }).where(eq(users.clerkId, brand));
    await db.transaction((tx) => awardDayOne(tx, brand, fan, null));

    const [brandPost] = await db.insert(posts).values({ userId: brand, mediaUrl: "https://cdn.test/a.jpg", mediaType: "image", postStatus: "published" }).returning({ id: posts.id });
    const [otherPost] = await db.insert(posts).values({ userId: otherBrand, mediaUrl: "https://cdn.test/b.jpg", mediaType: "image", postStatus: "published" }).returning({ id: posts.id });
    for (const [postId, author] of [[brandPost.id, fan], [brandPost.id, newcomer], [otherPost.id, fan]] as const) {
      await db.insert(postComments).values({ postId, authorId: author, body: `hi ${uid("c")}`, moderationStatus: "visible" });
    }

    const onBrand = (await call(`/api/posts/${brandPost.id}/comments`, null)).body.comments as any[];
    expect(onBrand.find((c) => c.author.userId === fan).dayOne).toBe(true);
    expect(onBrand.find((c) => c.author.userId === newcomer).dayOne).toBe(false);
    // Day 1 is per brand: the same buyer on another brand's post has no badge.
    const onOther = (await call(`/api/posts/${otherPost.id}/comments`, null)).body.comments as any[];
    expect(onOther.find((c) => c.author.userId === fan).dayOne).toBe(false);

    const profile = await call(`/api/day-one/${fan}`, null);
    expect(profile.body.brands).toEqual([expect.objectContaining({ sellerId: brand, name: "Northline", rank: 1 })]);
    expect((await call(`/api/day-one/${newcomer}`, null)).body.brands).toEqual([]);

    await db.insert(blocks).values({ blockerId: fan, blockedId: blocker });
    expect((await call(`/api/day-one/${fan}`, blocker)).body.brands).toEqual([]);

    await db.delete(posts).where(inArray(posts.id, [brandPost.id, otherPost.id]));
    await db.delete(blocks).where(eq(blocks.blockerId, fan));
  });
});

describe("migration backfill", () => {
  it("ranks a brand's existing buyers by first paid order, skipping cancelled and self orders", async () => {
    const seller = await seedSeller("d1-backfill");
    const [early, middle, late, cancelledOnly] = await Promise.all(["early", "middle", "late", "cancel"].map((t) => seedBuyer(`d1-bf-${t}`)));
    const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h));
    const order = (buyerId: string, paidAt: Date, status = "processing") => ({
      ownerId: seller, buyerId, orderNumber: uid("BT"), status, totalCents: 1000, subtotalCents: 1000, paidAt,
    });
    await db.insert(orders).values([
      order(middle, at(5)), order(early, at(1)), order(late, at(9)), order(middle, at(2)), // middle's first is hour 2
      order(cancelledOnly, at(0), "cancelled"), order(seller, at(0)),
    ]);
    const sqlText = fs.readFileSync(path.resolve(__dirname, "../../../../../lib/db/migrations/276_brand_day_one_buyers.sql"), "utf8");
    await db.execute(sql.raw(sqlText));
    expect(await ranksFor(seller)).toEqual([
      { buyerId: early, rank: 1 }, { buyerId: middle, rank: 2 }, { buyerId: late, rank: 3 },
    ]);
    // Re-running is harmless.
    await db.execute(sql.raw(sqlText));
    expect(await ranksFor(seller)).toHaveLength(3);
  });
});
