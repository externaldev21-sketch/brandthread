/**
 * Audit regressions (slice B03) for the Thread Cash wallet:
 *  - redeem-then-cancel must not make friend-received Thread Cash re-sendable;
 *  - an account purge returns a pending send as the funds it used (paid stays paid);
 *  - the expiry job's candidate list is not cut off after the first page;
 *  - weekly quest rewards draw on the monthly rewards budget;
 *  - the top-up sweep retries a released preorder ('held') order too.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import {
  db, follows, orders, savedItems, threadCashEntries, threadCashHeartbeats, threadCashTransfers, users,
} from "@workspace/db";
import {
  cancelPendingThreadCashForAccount, cancelThreadCashRedemption, claimThreadCash, redeemThreadCash, sendThreadCash,
} from "../wallet";
import { getFundingBalances } from "../funding";
import { candidateBuyers } from "../expiry";
import { getRewardsBudgetStatus } from "../earnGate";
import { claimWeeklyQuests, getWeeklyQuestsStatus } from "../weeklyQuests";
import { addDays, weekWindow } from "../weeklyQuestsWeek";
import { sweepThreadCashSellerTopups } from "../checkoutTopup";
import { createFakeStripe } from "../../money/__tests__/fakeStripe";
import { allowThreadCashRewards, seedRewardsGmv } from "../../../testUtils/threadCashRewards";

const RUN = crypto.randomBytes(4).toString("hex");
const userIds: string[] = [];
const entryBuyerIds: string[] = [];
const orderIds: string[] = [];

async function makeUser(tag: string, accountType = "buyer", stripeAccountId: string | null = null): Promise<string> {
  const clerkId = `tc-b03-${tag}-${RUN}-${crypto.randomUUID().slice(0, 8)}`;
  userIds.push(clerkId);
  entryBuyerIds.push(clerkId);
  await db.insert(users).values({
    clerkId, email: `${clerkId}@test.example`, name: tag, accountType, stripeAccountId,
    createdAt: new Date(Date.now() - 30 * 86_400_000),
  } as any);
  return clerkId;
}

/** A paid, live order so the user may send Thread Cash. */
async function paidOrder(buyerId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const [row] = await db.insert(orders).values({
    buyerId, ownerId: `tc-b03-owner-${RUN}`, orderNumber: `B03-${crypto.randomUUID().slice(0, 10)}`,
    status: "processing", totalCents: 1_000, subtotalCents: 1_000, paidAt: new Date(), ...extra,
  } as any).returning({ id: orders.id });
  orderIds.push(row.id);
  return row.id;
}

async function mutualFollow(a: string, b: string) {
  await db.insert(follows).values([{ followerId: a, followingId: b }, { followerId: b, followingId: a }]);
}

async function credit(buyerId: string, amountCents: number, funding: "promo" | "paid") {
  await db.insert(threadCashEntries).values({
    buyerId, amountCents, funding, source: funding === "paid" ? "purchase" : "daily_checkin", referenceId: crypto.randomUUID(),
  });
}

afterEach(async () => {
  if (entryBuyerIds.length) {
    const ids = entryBuyerIds.splice(0);
    await db.delete(threadCashEntries).where(inArray(threadCashEntries.buyerId, ids));
    await db.delete(threadCashTransfers).where(or(inArray(threadCashTransfers.senderId, ids), inArray(threadCashTransfers.recipientId, ids)));
    await db.delete(threadCashHeartbeats).where(inArray(threadCashHeartbeats.buyerId, ids));
    await db.delete(savedItems).where(inArray(savedItems.userId, ids));
    await db.delete(follows).where(or(inArray(follows.followerId, ids), inArray(follows.followingId, ids)));
  }
});
afterAll(async () => {
  if (orderIds.length) await db.delete(orders).where(inArray(orders.id, orderIds));
  if (userIds.length) await db.delete(users).where(inArray(users.clerkId, userIds));
});

describe("sendable balance", () => {
  it("a redemption cancelled back to the balance does not make friend-received Thread Cash re-sendable", async () => {
    const friend = await makeUser("friend");
    const holder = await makeUser("holder");
    const third = await makeUser("third");
    for (const id of [friend, holder]) await paidOrder(id);
    await mutualFollow(friend, holder);
    await mutualFollow(holder, third);
    await credit(friend, 500, "promo");

    const { transferId } = await sendThreadCash(friend, holder, 500, { idempotencyKey: crypto.randomUUID() });
    await claimThreadCash(transferId, holder);
    // Received money can't be relayed straight away…
    await expect(sendThreadCash(holder, third, 500, { idempotencyKey: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_THREAD_CASH" });
    // …nor after a redeem that was cancelled (nothing was actually spent).
    const { token } = await redeemThreadCash(holder, 500, crypto.randomUUID());
    await cancelThreadCashRedemption(holder, token);
    await expect(sendThreadCash(holder, third, 500, { idempotencyKey: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_THREAD_CASH" });
  });
});

describe("account purge", () => {
  it("returns a pending send to its sender as the same funds it used", async () => {
    const sender = await makeUser("purge-sender");
    const recipient = await makeUser("purge-recipient");
    await paidOrder(sender);
    await mutualFollow(sender, recipient);
    await credit(sender, 1_000, "paid");
    await sendThreadCash(sender, recipient, 400, { idempotencyKey: crypto.randomUUID() });
    expect(await getFundingBalances(db, sender)).toMatchObject({ balanceCents: 600, paidCents: 600 });

    expect(await db.transaction((tx) => cancelPendingThreadCashForAccount(tx, recipient))).toBe(1);
    expect(await getFundingBalances(db, sender)).toMatchObject({ balanceCents: 1_000, promoCents: 0, paidCents: 1_000 });
  });
});

describe("expiry job candidates", () => {
  it("reaches every buyer, not just the first page of 500", async () => {
    const base = Date.UTC(2001, 2, 10);
    const buyers = Array.from({ length: 501 }, (_, i) => `tc-b03-exp-${RUN}-${String(i).padStart(4, "0")}`);
    entryBuyerIds.push(...buyers);
    await db.insert(threadCashEntries).values(buyers.map((buyerId, i) => ({
      buyerId, amountCents: 10, source: "daily_checkin", referenceId: crypto.randomUUID(), createdAt: new Date(base + i * 1_000),
    })));
    const found = await candidateBuyers(new Date(Date.UTC(2001, 2, 1)), new Date(Date.UTC(2001, 2, 31)));
    expect(found.filter((id) => id.startsWith(`tc-b03-exp-${RUN}-`)).sort()).toEqual([...buyers].sort());
  });
});

describe("weekly quests", () => {
  it("draw on the monthly rewards budget like every other reward", async () => {
    await seedRewardsGmv();
    const restore = allowThreadCashRewards();
    try {
      const brandA = await makeUser("brand-a", "seller");
      const brandB = await makeUser("brand-b", "seller");
      async function questsDone(tag: string) {
        const buyerId = await makeUser(tag);
        const week = weekWindow(new Date(), "UTC");
        await db.insert(threadCashHeartbeats).values([0, 1, 2].map((d) => ({ buyerId, localDate: addDays(week.startDate, d), heartbeatCount: 3 })));
        await db.insert(savedItems).values([1, 2, 3].map((n) => ({ userId: buyerId, itemType: "product", targetId: `${buyerId}-p${n}` })));
        await db.insert(follows).values([brandA, brandB].map((followingId) => ({ followerId: buyerId, followingId })));
        return buyerId;
      }
      const first = await questsDone("wq-first");
      const second = await questsDone("wq-second");
      const reward = (await getWeeklyQuestsStatus(first)).rewardCents;

      // Exactly one weekly reward left in this month's budget.
      const { issuedCents } = await getRewardsBudgetStatus();
      process.env.THREAD_CASH_REWARDS_MONTHLY_CAP_CENTS = String(issuedCents + reward);
      expect((await claimWeeklyQuests(first)).created).toBe(true);
      await expect(claimWeeklyQuests(second)).rejects.toMatchObject({ code: "THREAD_CASH_REWARDS_BUDGET_EXHAUSTED" });
      // A repeat claim is still a quiet no-op, not a budget error.
      expect((await claimWeeklyQuests(first)).created).toBe(false);
    } finally {
      restore();
    }
  });
});

describe("Thread Cash seller top-up sweep", () => {
  it("retries a released preorder ('held') order whose top-up never went out", async () => {
    const seller = await makeUser("topup-seller", "seller", `acct_b03_${crypto.randomUUID().slice(0, 8)}`);
    const orderId = await paidOrder(`tc-b03-topup-buyer-${RUN}`, {
      ownerId: seller, chargeModel: "held", fundsState: "released", threadCashAppliedCents: 300,
    });
    const { stripe, state } = createFakeStripe();
    await sweepThreadCashSellerTopups(stripe as any, { limit: 100_000 });
    expect(state.transfers.filter((t: any) => t.metadata?.orderId === orderId)).toEqual([
      expect.objectContaining({ amount: 300, destination: expect.stringContaining("acct_b03_") }),
    ]);
    const [row] = await db.select({ transferId: orders.stripeThreadCashTransferId }).from(orders).where(eq(orders.id, orderId));
    expect(row.transferId).toBeTruthy();
  });
});
