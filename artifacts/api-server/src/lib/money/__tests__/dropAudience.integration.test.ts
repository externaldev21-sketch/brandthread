import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, drops, follows, orders, products } from "@workspace/db";

const published = vi.hoisted(() => [] as Array<{ userId: string; type: string; targetId?: string; body?: string }>);
vi.mock("../../../routes/notifications-feed", () => ({
  publishNotification: async (n: { userId: string; type: string; targetId?: string; body?: string }) => { published.push(n); },
}));

import { isPastBuyer } from "../dropAudience";
import { resolveChargePlan } from "../checkoutPlan";
import { deliverDueEarlyAccessPushes, earlyAccessWindowLabel } from "../../dropEarlyAccessPush";

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `audience-seller-${suffix}`;
const otherSeller = `audience-other-${suffix}`;
const member = `audience-member-${suffix}`;
const stranger = `audience-stranger-${suffix}`;
const dropIds: string[] = [];
const productIds: string[] = [];
const orderNumbers: string[] = [];
const MIN = 60_000;

async function seedOrder(input: { buyerId: string; ownerId: string; paid?: boolean; status?: string; refundedCents?: number }) {
  const orderNumber = `BT-AUD-${suffix}-${orderNumbers.length}`;
  orderNumbers.push(orderNumber);
  await db.insert(orders).values({
    ownerId: input.ownerId, buyerId: input.buyerId, orderNumber,
    status: input.status ?? "fulfilled", totalCents: 5000, subtotalCents: 5000, shippingCents: 0,
    refundedCents: input.refundedCents ?? 0,
    paidAt: input.paid === false ? null : new Date(),
  });
}

async function seedDrop(values: Partial<typeof drops.$inferInsert> = {}) {
  const [drop] = await db.insert(drops).values({
    ownerId: seller, name: `Audience drop ${suffix}`, type: "pre-made", status: "active", ...values,
  }).returning();
  dropIds.push(drop.id);
  const [product] = await db.insert(products).values({
    ownerId: seller, name: `Audience tee ${suffix}`, status: "active", dropId: drop.id,
  }).returning({ id: products.id });
  productIds.push(product.id);
  return { drop, productId: product.id };
}

afterAll(async () => {
  if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
  if (dropIds.length) await db.delete(drops).where(inArray(drops.id, dropIds));
  if (orderNumbers.length) await db.delete(orders).where(inArray(orders.orderNumber, orderNumbers));
  await db.delete(follows).where(eq(follows.followingId, seller));
});

describe("isPastBuyer", () => {
  it("is true only for a paid, uncancelled, not fully refunded order from that seller", async () => {
    const paid = `audience-paid-${suffix}`;
    const unpaid = `audience-unpaid-${suffix}`;
    const cancelled = `audience-cancelled-${suffix}`;
    const refunded = `audience-refunded-${suffix}`;
    const partly = `audience-partly-${suffix}`;
    const elsewhere = `audience-elsewhere-${suffix}`;
    await seedOrder({ buyerId: paid, ownerId: seller });
    await seedOrder({ buyerId: unpaid, ownerId: seller, paid: false });
    await seedOrder({ buyerId: cancelled, ownerId: seller, status: "cancelled" });
    await seedOrder({ buyerId: refunded, ownerId: seller, refundedCents: 5000 });
    await seedOrder({ buyerId: partly, ownerId: seller, refundedCents: 1000 });
    await seedOrder({ buyerId: elsewhere, ownerId: otherSeller });

    expect(await isPastBuyer(paid, seller)).toBe(true);
    expect(await isPastBuyer(partly, seller)).toBe(true);
    expect(await isPastBuyer(unpaid, seller)).toBe(false);
    expect(await isPastBuyer(cancelled, seller)).toBe(false);
    expect(await isPastBuyer(refunded, seller)).toBe(false);
    expect(await isPastBuyer(elsewhere, seller)).toBe(false);
    expect(await isPastBuyer(null, seller)).toBe(false);
  });
});

describe("members-only drops at checkout", () => {
  it("lets a past buyer check out and refuses everyone else, guests included", async () => {
    await seedOrder({ buyerId: member, ownerId: seller });
    const { productId } = await seedDrop({ membersOnly: true, releaseAt: new Date(Date.now() - MIN) });

    await expect(resolveChargePlan({ productIds: [productId], sellerId: seller, buyerId: member }))
      .resolves.toEqual({ chargeModel: "destination", dropId: null });
    await expect(resolveChargePlan({ productIds: [productId], sellerId: seller, buyerId: stranger }))
      .rejects.toMatchObject({ status: 403, code: "DROP_MEMBERS_ONLY" });
    await expect(resolveChargePlan({ productIds: [productId], sellerId: seller, buyerId: null }))
      .rejects.toMatchObject({ code: "DROP_MEMBERS_ONLY" });
  });

  it("leaves open drops open", async () => {
    const { productId } = await seedDrop({ releaseAt: new Date(Date.now() - MIN) });
    await expect(resolveChargePlan({ productIds: [productId], sellerId: seller, buyerId: stranger }))
      .resolves.toEqual({ chargeModel: "destination", dropId: null });
  });
});

describe("early-access push", () => {
  beforeEach(() => { published.length = 0; });

  it("labels the window", () => {
    expect(earlyAccessWindowLabel(60)).toBe("the next hour");
    expect(earlyAccessWindowLabel(120)).toBe("the next 2 hours");
    expect(earlyAccessWindowLabel(45)).toBe("the next 45 minutes");
  });

  it("tells followers once, when their window opens", async () => {
    const follower = `audience-follower-${suffix}`;
    await db.insert(follows).values({ followerId: follower, followingId: seller }).onConflictDoNothing();
    const releaseAt = new Date(Date.now() + 60 * MIN);
    const { drop } = await seedDrop({ releaseAt, earlyAccessMinutes: 60 });

    // Before the window: nothing.
    await deliverDueEarlyAccessPushes(new Date(releaseAt.getTime() - 61 * MIN));
    expect(published.filter((n) => n.targetId === drop.id)).toHaveLength(0);

    await deliverDueEarlyAccessPushes(new Date(releaseAt.getTime() - 59 * MIN));
    const sent = published.filter((n) => n.targetId === drop.id);
    expect(sent).toEqual([expect.objectContaining({ userId: follower, type: "drop_early_access" })]);
    expect(sent[0].body).toContain("the next hour");

    // Second run never repeats it.
    await deliverDueEarlyAccessPushes(new Date(releaseAt.getTime() - 58 * MIN));
    expect(published.filter((n) => n.targetId === drop.id)).toHaveLength(1);
  });

  it("only tells followers who can buy a members-only drop", async () => {
    const memberFollower = `audience-mfollower-${suffix}`;
    const plainFollower = `audience-pfollower-${suffix}`;
    await seedOrder({ buyerId: memberFollower, ownerId: seller });
    await db.insert(follows).values([
      { followerId: memberFollower, followingId: seller },
      { followerId: plainFollower, followingId: seller },
    ]).onConflictDoNothing();
    const releaseAt = new Date(Date.now() + 30 * MIN);
    const { drop } = await seedDrop({ releaseAt, earlyAccessMinutes: 60, membersOnly: true });

    await deliverDueEarlyAccessPushes(new Date());
    const recipients = published.filter((n) => n.targetId === drop.id).map((n) => n.userId);
    expect(recipients).toContain(memberFollower);
    expect(recipients).not.toContain(plainFollower);
  });

  it("skips drops already live for everyone", async () => {
    const { drop } = await seedDrop({ releaseAt: new Date(Date.now() - MIN), earlyAccessMinutes: 60 });
    await deliverDueEarlyAccessPushes(new Date());
    expect(published.filter((n) => n.targetId === drop.id)).toHaveLength(0);
  });
});
