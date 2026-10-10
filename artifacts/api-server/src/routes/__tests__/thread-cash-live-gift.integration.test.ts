/**
 * Live gifts: buyer → seller Thread Cash from a live stream. Unlike
 * sendThreadCash (send-to-friend), this is never gated on mutual follow and
 * never sits pending a claim — it posts the debit and the cashable seller
 * credit in one transaction, using the `live_gift` source cashOut.ts expects.
 */
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { blocks, db, follows, liveStreams, threadCashEntries, users } from "@workspace/db";
import { getBalanceCents, getCashableBalanceCents, getThreadCashConfig, sendLiveGift } from "../../lib/threadCash/wallet";

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

afterEach(async () => {
  while (testStreamIds.length > 0) {
    await db.delete(liveStreams).where(eq(liveStreams.id, testStreamIds.pop()!));
  }
  while (testUserIds.length > 0) {
    const id = testUserIds.pop()!;
    await db.delete(threadCashEntries).where(eq(threadCashEntries.buyerId, id));
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
    // immediately — there is no pending/claim step.
    expect(await getBalanceCents(db, seller)).toBe(200);
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
    expect(credit).toMatchObject({ amountCents: 150, source: "live_gift", referenceId: stream });
  });

  it("a gift of reward credit stays promo: the seller can spend it but never cash it out", async () => {
    const buyer = await makeUser();
    const seller = await makeUser();
    const stream = await makeStream(seller);
    await grant(buyer, 500); // a check-in reward

    await sendLiveGift(buyer, seller, stream, 400, crypto.randomUUID());
    const [credit] = await db.select().from(threadCashEntries).where(eq(threadCashEntries.buyerId, seller));
    expect(credit).toMatchObject({ source: "live_gift", funding: "promo", amountCents: 400 });
    expect(await getBalanceCents(db, seller)).toBe(400);
    expect(await getCashableBalanceCents(db, seller)).toBe(0);
  });

  it("a gift of paid Thread Cash is the one thing the seller can cash out", async () => {
    const buyer = await makeUser();
    const seller = await makeUser();
    const stream = await makeStream(seller);
    await db.insert(threadCashEntries).values({
      buyerId: buyer, amountCents: 300, source: "purchase", funding: "paid", referenceId: crypto.randomUUID(),
    });

    await sendLiveGift(buyer, seller, stream, 300, crypto.randomUUID());
    expect(await getCashableBalanceCents(db, seller)).toBe(300);
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
    expect(await getBalanceCents(db, seller)).toBe(100);
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
    // The effective cap: thread_cash_config bounded by the env policy.
    const cap = (await getThreadCashConfig()).dailySendCapCents;
    await grant(buyer, cap * 3);

    await sendLiveGift(buyer, seller, stream, cap, crypto.randomUUID());
    await expect(
      sendLiveGift(buyer, seller, stream, 1, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "THREAD_CASH_DAILY_SEND_CAP" });
  });

  it("enforces the daily receive cap on the seller", async () => {
    const seller = await makeUser();
    const stream = await makeStream(seller);
    const { dailyReceiveCapCents: cap, dailySendCapCents: perSender } = await getThreadCashConfig();
    // Several buyers, each within their own send cap, fill the seller's receive cap.
    let left = cap;
    while (left > 0) {
      const buyer = await makeUser();
      const amount = Math.min(left, perSender);
      await grant(buyer, amount);
      await sendLiveGift(buyer, seller, stream, amount, crypto.randomUUID());
      left -= amount;
    }
    const last = await makeUser();
    await grant(last, 100);
    await expect(
      sendLiveGift(last, seller, stream, 1, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "THREAD_CASH_DAILY_RECEIVE_CAP" });
  });
});
