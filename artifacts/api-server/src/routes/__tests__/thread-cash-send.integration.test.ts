/**
 * Thread Cash send-to-friend: mutual-follow/block gating (checked at both
 * send and claim), daily caps, "received can't be re-sent", cancel/expiry,
 * and exactly-once behavior under concurrency.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Send does several extra round trips over redeem (mutual-follow, block,
// account-age, sendable-balance, two rolling-window caps) and the 20-way
// concurrency tests below serialize on one sender's advisory lock — give
// them a little more room than the 5s default rather than flaking under
// connection-pool contention.
vi.setConfig({ testTimeout: 10_000, hookTimeout: 10_000 });
import { and, eq } from "drizzle-orm";
import {
  blocks, db, follows, orders, threadCashEntries, threadCashStreaks, threadCashTransfers, users,
} from "@workspace/db";
import {
  cancelThreadCash,
  claimThreadCash,
  getBalanceCents,
  getCashableBalanceCents,
  getThreadCashConfig,
  sendThreadCash,
} from "../../lib/threadCash/wallet";

const testUserIds: string[] = [];

/** By default an 8-day-old account with one paid order — eligible to send. */
async function makeUser(agedHours = 8 * 24, options: { paidOrder?: boolean } = {}): Promise<string> {
  const clerkId = `thread-cash-send-test-${crypto.randomUUID()}`;
  testUserIds.push(clerkId);
  await db.insert(users).values({
    clerkId,
    email: `${clerkId}@test.example`,
    name: "Test User",
    createdAt: new Date(Date.now() - agedHours * 3_600_000),
  });
  if (options.paidOrder !== false) {
    await db.insert(orders).values({
      ownerId: `thread-cash-send-test-seller-${crypto.randomUUID()}`,
      buyerId: clerkId,
      orderNumber: `TCS-${crypto.randomUUID().slice(0, 8)}`,
      status: "processing",
      totalCents: 2_500,
      subtotalCents: 2_500,
      paidAt: new Date(),
    });
  }
  return clerkId;
}

async function makeMutualFollow(a: string, b: string): Promise<void> {
  await db.insert(follows).values([
    { followerId: a, followingId: b },
    { followerId: b, followingId: a },
  ]);
}

async function grant(buyerId: string, amountCents: number): Promise<void> {
  await db.insert(threadCashEntries).values({
    buyerId, amountCents, source: "daily_checkin", referenceId: crypto.randomUUID(),
  });
}

afterEach(async () => {
  while (testUserIds.length > 0) {
    const id = testUserIds.pop()!;
    await db.delete(threadCashTransfers).where(eq(threadCashTransfers.senderId, id));
    await db.delete(orders).where(eq(orders.buyerId, id));
    await db.delete(threadCashEntries).where(eq(threadCashEntries.buyerId, id));
    await db.delete(threadCashStreaks).where(eq(threadCashStreaks.buyerId, id));
    await db.delete(follows).where(eq(follows.followerId, id));
    await db.delete(follows).where(eq(follows.followingId, id));
    await db.delete(blocks).where(eq(blocks.blockerId, id));
    await db.delete(blocks).where(eq(blocks.blockedId, id));
    await db.delete(users).where(eq(users.clerkId, id));
  }
});

describe("sendThreadCash", () => {
  it("rejects a send when the two accounts don't follow each other", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await grant(a, 500);

    await expect(
      sendThreadCash(a, b, 100, { idempotencyKey: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "THREAD_CASH_NOT_MUTUAL_FOLLOWERS" });
  });

  it("rejects a send between accounts that follow each other but where one blocked the other", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeMutualFollow(a, b);
    await db.insert(blocks).values({ blockerId: b, blockedId: a });
    await grant(a, 500);

    await expect(
      sendThreadCash(a, b, 100, { idempotencyKey: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "THREAD_CASH_BLOCKED" });
  });

  it("rejects a send from an account younger than the minimum age", async () => {
    const a = await makeUser(1); // 1 hour old, default minimum is 7 days
    const b = await makeUser();
    await makeMutualFollow(a, b);
    await grant(a, 500);

    await expect(
      sendThreadCash(a, b, 100, { idempotencyKey: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "THREAD_CASH_ACCOUNT_TOO_NEW" });
  });

  it("rejects a send from a 3-day-old account (the minimum is 7 days by default)", async () => {
    const a = await makeUser(72);
    const b = await makeUser();
    await makeMutualFollow(a, b);
    await grant(a, 500);

    await expect(
      sendThreadCash(a, b, 100, { idempotencyKey: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "THREAD_CASH_ACCOUNT_TOO_NEW" });
  });

  it("rejects a send from an account that has never placed a paid order", async () => {
    const a = await makeUser(8 * 24, { paidOrder: false });
    const b = await makeUser();
    await makeMutualFollow(a, b);
    await grant(a, 500);

    await expect(
      sendThreadCash(a, b, 100, { idempotencyKey: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "THREAD_CASH_SENDER_NO_PAID_ORDER" });
    expect(await getBalanceCents(db, a)).toBe(500);
  });

  it("caps what one receiver can be sent per day across every sender, pending sends included", async () => {
    const { dailyReceiveCapCents, dailySendCapCents } = await getThreadCashConfig();
    const receiver = await makeUser();
    const senders = await Promise.all(Array.from({ length: 3 }, () => makeUser()));
    const each = Math.min(dailySendCapCents, Math.ceil(dailyReceiveCapCents / 2));
    for (const sender of senders) {
      await makeMutualFollow(sender, receiver);
      await grant(sender, each);
    }
    await sendThreadCash(senders[0], receiver, each, { idempotencyKey: crypto.randomUUID() });
    await sendThreadCash(senders[1], receiver, dailyReceiveCapCents - each, { idempotencyKey: crypto.randomUUID() });
    // Neither send is claimed yet; the receiver is still at the cap.
    await expect(
      sendThreadCash(senders[2], receiver, 1, { idempotencyKey: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "THREAD_CASH_DAILY_RECEIVE_CAP" });
  });

  it("received Thread Cash is promo credit: spendable, never cashable", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeMutualFollow(a, b);
    await grant(a, 500);
    const { transferId } = await sendThreadCash(a, b, 300, { idempotencyKey: crypto.randomUUID() });
    await claimThreadCash(transferId, b);

    const rows = await db.select().from(threadCashEntries).where(eq(threadCashEntries.buyerId, b));
    expect(rows.map((r) => [r.source, r.funding])).toEqual([["send_received", "promo"]]);
    expect(await getBalanceCents(db, b)).toBe(300);
    expect(await getCashableBalanceCents(db, b)).toBe(0);
  });

  it("allows a mutual-follow send and moves funds out of the sender's balance immediately", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeMutualFollow(a, b);
    await grant(a, 500);

    const { transferId } = await sendThreadCash(a, b, 200, { idempotencyKey: crypto.randomUUID(), note: "for coffee" });
    expect(transferId).toBeTruthy();
    expect(await getBalanceCents(db, a)).toBe(300);
    expect(await getBalanceCents(db, b)).toBe(0); // not spendable until claimed
  });

  it("a double-tapped send with the SAME idempotency key creates exactly one transfer", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeMutualFollow(a, b);
    await grant(a, 500);
    const idempotencyKey = crypto.randomUUID();

    const [first, second] = await Promise.all([
      sendThreadCash(a, b, 100, { idempotencyKey }),
      sendThreadCash(a, b, 100, { idempotencyKey }),
    ]);
    expect(first.transferId).toBe(second.transferId);
    expect(await getBalanceCents(db, a)).toBe(400); // spent exactly once
  });

  it("20 parallel sends with the same idempotency key create exactly one transfer", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeMutualFollow(a, b);
    await grant(a, 1_000);
    const idempotencyKey = crypto.randomUUID();

    const results = await Promise.all(
      Array.from({ length: 20 }, () => sendThreadCash(a, b, 50, { idempotencyKey })),
    );
    expect(new Set(results.map((r) => r.transferId)).size).toBe(1);
    expect(await getBalanceCents(db, a)).toBe(950);
  });

  it("20 parallel sends with DIFFERENT idempotency keys never drive the balance negative", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeMutualFollow(a, b);
    await grant(a, 500);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => sendThreadCash(a, b, 100, { idempotencyKey: crypto.randomUUID() })),
    );
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    // 5 sends of 100 exhaust the 500 balance; the daily caps (default $10
    // sent / $20 received) bound it too — either way, never more than the balance.
    expect(succeeded).toBeLessThanOrEqual(5);
    expect(await getBalanceCents(db, a)).toBeGreaterThanOrEqual(0);
  });

  it("enforces the daily send cap even with a large balance", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeMutualFollow(a, b);
    // The effective cap: thread_cash_config bounded by the env policy.
    const cap = (await getThreadCashConfig()).dailySendCapCents;
    await grant(a, cap * 3);

    await sendThreadCash(a, b, cap, { idempotencyKey: crypto.randomUUID() });
    await expect(
      sendThreadCash(a, b, 1, { idempotencyKey: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "THREAD_CASH_DAILY_SEND_CAP" });
  });

  it("received Thread Cash can be spent but not sent onward", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    await makeMutualFollow(a, b);
    await makeMutualFollow(b, c);
    await grant(a, 500);

    const { transferId } = await sendThreadCash(a, b, 300, { idempotencyKey: crypto.randomUUID() });
    await claimThreadCash(transferId, b);
    expect(await getBalanceCents(db, b)).toBe(300);

    // b received 300 and never spent any of it — none of it is sendable.
    await expect(
      sendThreadCash(b, c, 100, { idempotencyKey: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_THREAD_CASH" });
  });
});

describe("claimThreadCash", () => {
  it("rejects a claim by anyone other than the recipient", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const stranger = await makeUser();
    await makeMutualFollow(a, b);
    await grant(a, 500);
    const { transferId } = await sendThreadCash(a, b, 100, { idempotencyKey: crypto.randomUUID() });

    await expect(claimThreadCash(transferId, stranger)).rejects.toMatchObject({ code: "THREAD_CASH_TRANSFER_FORBIDDEN" });
  });

  it("rejects a claim once the two accounts are no longer mutual followers", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeMutualFollow(a, b);
    await grant(a, 500);
    const { transferId } = await sendThreadCash(a, b, 100, { idempotencyKey: crypto.randomUUID() });

    await db.delete(follows).where(and(eq(follows.followerId, b), eq(follows.followingId, a)));

    await expect(claimThreadCash(transferId, b)).rejects.toMatchObject({ code: "THREAD_CASH_NOT_MUTUAL_FOLLOWERS" });
  });

  it("cannot be claimed twice", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeMutualFollow(a, b);
    await grant(a, 500);
    const { transferId } = await sendThreadCash(a, b, 100, { idempotencyKey: crypto.randomUUID() });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => claimThreadCash(transferId, b)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await getBalanceCents(db, b)).toBe(100);
  });
});

describe("cancelThreadCash", () => {
  it("returns funds to the sender and the transfer can no longer be claimed", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeMutualFollow(a, b);
    await grant(a, 500);
    const { transferId } = await sendThreadCash(a, b, 200, { idempotencyKey: crypto.randomUUID() });
    expect(await getBalanceCents(db, a)).toBe(300);

    await cancelThreadCash(transferId, a);
    expect(await getBalanceCents(db, a)).toBe(500);

    await expect(claimThreadCash(transferId, b)).rejects.toMatchObject({ code: "THREAD_CASH_TRANSFER_NOT_PENDING" });
  });

  it("cannot be cancelled by anyone but the sender", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeMutualFollow(a, b);
    await grant(a, 500);
    const { transferId } = await sendThreadCash(a, b, 200, { idempotencyKey: crypto.randomUUID() });

    await expect(cancelThreadCash(transferId, b)).rejects.toMatchObject({ code: "THREAD_CASH_TRANSFER_FORBIDDEN" });
  });
});
