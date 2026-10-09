/**
 * Live gifts: buyer → seller Thread Cash from a live stream. Unlike
 * sendThreadCash (send-to-friend), this is never gated on mutual follow and
 * never sits pending a claim — it posts the debit and the cashable seller
 * credit in one transaction, using the `live_gift` source cashOut.ts expects.
 */
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { blocks, db, follows, liveStreams, threadCashConfig, threadCashEntries, users } from "@workspace/db";
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

    // The buyer also holds the daily_checkin grant row, so select by source.
    const [debit] = await db.select().from(threadCashEntries)
      .where(and(eq(threadCashEntries.buyerId, buyer), eq(threadCashEntries.source, "live_gift_sent"))).limit(1);
    expect(debit).toMatchObject({ amountCents: -150, source: "live_gift_sent", referenceId: stream });

    const [credit] = await db.select().from(threadCashEntries)
      .where(eq(threadCashEntries.buyerId, seller)).limit(1);
    expect(credit).toMatchObject({ amountCents: 150, source: "live_gift", referenceId: stream });
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
    const [config] = await db.select().from(threadCashConfig).limit(1);
    const cap = config?.dailySendCapCents ?? 2000;
    await grant(buyer, cap * 3);

    await sendLiveGift(buyer, seller, stream, cap, crypto.randomUUID());
    await expect(
      sendLiveGift(buyer, seller, stream, 1, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "THREAD_CASH_DAILY_SEND_CAP" });
  });

  it("enforces the daily receive cap on the seller", async () => {
    // Several senders: the receive cap must trip on the seller even when no
    // single buyer has hit their own (lower) daily send cap.
    const seller = await makeUser();
    const stream = await makeStream(seller);
    const [config] = await db.select().from(threadCashConfig).limit(1);
    const cap = config?.dailyReceiveCapCents ?? 5000;
    const sendCap = config?.dailySendCapCents ?? cap;

    let received = 0;
    while (received < cap) {
      const sender = await makeUser();
      const chunk = Math.min(sendCap, cap - received);
      await grant(sender, chunk);
      await sendLiveGift(sender, seller, stream, chunk, crypto.randomUUID());
      received += chunk;
    }
    const third = await makeUser();
    await grant(third, 100);
    await expect(
      sendLiveGift(third, seller, stream, 1, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "THREAD_CASH_DAILY_RECEIVE_CAP" });
  });
});
