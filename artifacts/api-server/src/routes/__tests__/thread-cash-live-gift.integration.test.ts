/**
 * Live gifts: buyer → seller Thread Cash from a live stream. Unlike
 * sendThreadCash (send-to-friend), this is never gated on mutual follow and
 * never sits pending a claim — it posts the debit and the cashable seller
 * credit in one transaction, using the `live_gift` source cashOut.ts expects.
 */
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { blocks, db, follows, liveGiftPlatformFees, liveStreams, threadCashConfig, threadCashEntries, users } from "@workspace/db";
import { getBalanceCents, sendLiveGift } from "../../lib/threadCash/wallet";

const testUserIds: string[] = [];
const testStreamIds: string[] = [];

async function makeUser(): Promise<string> {
  const clerkId = `thread-cash-live-gift-test-${crypto.randomUUID()}`;
  testUserIds.push(clerkId);
  await db.insert(users).values({
    clerkId,
    email: `${clerkId}@test.example`,
    name: "Test User",
  });
  return clerkId;
}

async function makeStream(sellerId: string): Promise<string> {
  const id = crypto.randomUUID();
  testStreamIds.push(id);
  await db.insert(liveStreams).values({
    id,
    sellerId,
    channelName: `live-gift-test-${id}`,
    title: "Test stream",
  });
  return id;
}

async function grant(buyerId: string, amountCents: number): Promise<void> {
  await db.insert(threadCashEntries).values({
    buyerId, amountCents, source: "daily_checkin", referenceId: crypto.randomUUID(),
  });
}

/** Gifts `cap` cents to the seller from as many buyers as the per-buyer send cap needs. */
async function reachReceiveCap(seller: string, stream: string, cap: number, sendCap: number, feeBps: number): Promise<void> {
  let left = cap;
  while (left > 0) {
    const amount = Math.min(left, sendCap);
    const giver = await makeUser();
    await grant(giver, amount);
    await sendLiveGift(giver, seller, stream, amount, crypto.randomUUID(), feeBps);
    left -= amount;
  }
}

afterEach(async () => {
  while (testStreamIds.length > 0) {
    await db.delete(liveStreams).where(eq(liveStreams.id, testStreamIds.pop()!));
  }
  while (testUserIds.length > 0) {
    const id = testUserIds.pop()!;
    await db.delete(threadCashEntries).where(eq(threadCashEntries.buyerId, id));
    await db.delete(liveGiftPlatformFees).where(eq(liveGiftPlatformFees.buyerId, id));
    await db.delete(blocks).where(eq(blocks.blockerId, id));
    await db.delete(blocks).where(eq(blocks.blockedId, id));
    await db.delete(follows).where(eq(follows.followerId, id));
    await db.delete(follows).where(eq(follows.followingId, id));
    await db.delete(users).where(eq(users.clerkId, id));
  }
});

describe("sendLiveGift", () => {
  it("moves funds from buyer to seller immediately, with no mutual-follow gate", async () => {
    const buyer = await makeUser();
    const seller = await makeUser();
    const stream = await makeStream(seller);
    await grant(buyer, 500);

    const { giftId } = await sendLiveGift(buyer, seller, stream, 200, crypto.randomUUID());
    expect(giftId).toBeTruthy();
    expect(await getBalanceCents(db, buyer)).toBe(300);
    // Unlike sendThreadCash, a gift is spendable/cashable by the seller
    // immediately — there is no pending/claim step. The seller is credited
    // the gift minus Brandthread's default 30% cut.
    expect(await getBalanceCents(db, seller)).toBe(140);
  });

  it("records one debit entry (source live_gift_sent) and one credit entry (source live_gift)", async () => {
    const buyer = await makeUser();
    const seller = await makeUser();
    const stream = await makeStream(seller);
    await grant(buyer, 500);

    await sendLiveGift(buyer, seller, stream, 150, crypto.randomUUID());

    const [debit] = await db.select().from(threadCashEntries)
      .where(and(eq(threadCashEntries.buyerId, buyer), eq(threadCashEntries.source, "live_gift_sent"))).limit(1);
    expect(debit).toMatchObject({ amountCents: -150, source: "live_gift_sent", referenceId: stream });

    const [credit] = await db.select().from(threadCashEntries)
      .where(eq(threadCashEntries.buyerId, seller)).limit(1);
    expect(credit).toMatchObject({ amountCents: 105, source: "live_gift", referenceId: stream });
  });

  it("rejects gifting yourself", async () => {
    const seller = await makeUser();
    const stream = await makeStream(seller);
    await grant(seller, 500);

    await expect(
      sendLiveGift(seller, seller, stream, 100, crypto.randomUUID()),
    ).rejects.toMatchObject({ message: expect.stringContaining("can't gift yourself") });
  });

  it("rejects a gift to someone who blocked the buyer", async () => {
    const buyer = await makeUser();
    const seller = await makeUser();
    const stream = await makeStream(seller);
    await db.insert(blocks).values({ blockerId: seller, blockedId: buyer });
    await grant(buyer, 500);

    await expect(
      sendLiveGift(buyer, seller, stream, 100, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "THREAD_CASH_BLOCKED" });
  });

  it("rejects insufficient balance", async () => {
    const buyer = await makeUser();
    const seller = await makeUser();
    const stream = await makeStream(seller);
    await grant(buyer, 50);

    await expect(
      sendLiveGift(buyer, seller, stream, 100, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_THREAD_CASH" });
  });

  it("a double-tapped gift with the SAME idempotency key posts exactly once", async () => {
    const buyer = await makeUser();
    const seller = await makeUser();
    const stream = await makeStream(seller);
    await grant(buyer, 500);
    const idempotencyKey = crypto.randomUUID();

    const [first, second] = await Promise.all([
      sendLiveGift(buyer, seller, stream, 100, idempotencyKey),
      sendLiveGift(buyer, seller, stream, 100, idempotencyKey),
    ]);
    expect(first.giftId).toBe(second.giftId);
    expect(await getBalanceCents(db, buyer)).toBe(400);
    expect(await getBalanceCents(db, seller)).toBe(70);
    expect(second.netCents).toBe(70);
    const fees = await db.select().from(liveGiftPlatformFees).where(eq(liveGiftPlatformFees.buyerId, buyer));
    expect(fees).toHaveLength(1);
  });

  it("20 parallel gifts with DIFFERENT idempotency keys never drive the buyer's balance negative", async () => {
    const buyer = await makeUser();
    const seller = await makeUser();
    const stream = await makeStream(seller);
    await grant(buyer, 500);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => sendLiveGift(buyer, seller, stream, 100, crypto.randomUUID())),
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeLessThanOrEqual(5);
    expect(await getBalanceCents(db, buyer)).toBeGreaterThanOrEqual(0);
  });

  it("enforces the daily send cap combined with send-to-friend sends", async () => {
    const buyer = await makeUser();
    const seller = await makeUser();
    const stream = await makeStream(seller);
    const [config] = await db.select().from(threadCashConfig).limit(1);
    const cap = config?.dailySendCapCents ?? 2000;
    await grant(buyer, cap * 3);

    await sendLiveGift(buyer, seller, stream, cap, crypto.randomUUID());
    await expect(
      sendLiveGift(buyer, seller, stream, 1, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "THREAD_CASH_DAILY_SEND_CAP" });
  });

  it("enforces the daily receive cap on the seller", async () => {
    const buyer = await makeUser();
    const seller = await makeUser();
    const stream = await makeStream(seller);
    const [config] = await db.select().from(threadCashConfig).limit(1);
    const cap = config?.dailyReceiveCapCents ?? 5000;
    await reachReceiveCap(seller, stream, cap, config?.dailySendCapCents ?? 2000, 0);
    const late = await makeUser();
    await grant(late, 100);
    await expect(
      sendLiveGift(late, seller, stream, 1, crypto.randomUUID(), 0),
    ).rejects.toMatchObject({ code: "THREAD_CASH_DAILY_RECEIVE_CAP" });
  });

  it("credits the seller the gift minus the platform fee and records the fee", async () => {
    const buyer = await makeUser();
    const seller = await makeUser();
    const stream = await makeStream(seller);
    await grant(buyer, 1000);

    const gift = await sendLiveGift(buyer, seller, stream, 999, crypto.randomUUID(), 3000);
    expect(gift).toMatchObject({ grossCents: 999, feeCents: 299, netCents: 700, created: true });
    expect(await getBalanceCents(db, buyer)).toBe(1);
    expect(await getBalanceCents(db, seller)).toBe(700);
    const [fee] = await db.select().from(liveGiftPlatformFees).where(eq(liveGiftPlatformFees.giftEntryId, gift.giftId));
    expect(fee).toMatchObject({ streamId: stream, buyerId: buyer, sellerId: seller, grossCents: 999, feeBps: 3000, feeCents: 299, netCents: 700 });
  });

  it("a 0 bps fee credits the seller in full", async () => {
    const buyer = await makeUser();
    const seller = await makeUser();
    const stream = await makeStream(seller);
    await grant(buyer, 500);

    const gift = await sendLiveGift(buyer, seller, stream, 250, crypto.randomUUID(), 0);
    expect(gift).toMatchObject({ feeCents: 0, netCents: 250 });
    expect(await getBalanceCents(db, seller)).toBe(250);
  });

  it("the receive cap counts the gross gift, not just the seller's net", async () => {
    const buyer = await makeUser();
    const seller = await makeUser();
    const stream = await makeStream(seller);
    const [config] = await db.select().from(threadCashConfig).limit(1);
    const cap = config?.dailyReceiveCapCents ?? 5000;
    await reachReceiveCap(seller, stream, cap, config?.dailySendCapCents ?? 2000, 3000);
    // The seller was only credited 70% of `cap`, but the cap is on gifts received.
    expect(await getBalanceCents(db, seller)).toBeLessThan(cap);
    const late = await makeUser();
    await grant(late, 100);
    await expect(
      sendLiveGift(late, seller, stream, 1, crypto.randomUUID(), 3000),
    ).rejects.toMatchObject({ code: "THREAD_CASH_DAILY_RECEIVE_CAP" });
  });
});
