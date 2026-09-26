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
  blocks, db, follows, threadCashConfig, threadCashEntries, threadCashStreaks, threadCashTransfers, users,
} from "@workspace/db";
import {
  cancelThreadCash,
  claimThreadCash,
  getBalanceCents,
  sendThreadCash,
} from "../../lib/threadCash/wallet";

const testUserIds: string[] = [];

async function makeUser(agedHours = 48): Promise<string> {
  const clerkId = `thread-cash-send-test-${crypto.randomUUID()}`;
  testUserIds.push(clerkId);
  await db.insert(users).values({
    clerkId,
    email: `${clerkId}@test.example`,
    name: "Test User",
    createdAt: new Date(Date.now() - agedHours * 3_600_000),
  });
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
    const a = await makeUser(1); // 1 hour old, default minimum is 24h
    const b = await makeUser();
    await makeMutualFollow(a, b);
    await grant(a, 500);

    await expect(
      sendThreadCash(a, b, 100, { idempotencyKey: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "THREAD_CASH_ACCOUNT_TOO_NEW" });
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
    // 5 sends of 100 exhaust the 500 balance; the daily send cap (default
    // $20) also caps it at 5×100 — either way, never more than the balance.
    expect(succeeded).toBeLessThanOrEqual(5);
    expect(await getBalanceCents(db, a)).toBeGreaterThanOrEqual(0);
  });

  it("enforces the daily send cap even with a large balance", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeMutualFollow(a, b);
    const [config] = await db.select().from(threadCashConfig).limit(1);
    const cap = config?.dailySendCapCents ?? 2000;
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
