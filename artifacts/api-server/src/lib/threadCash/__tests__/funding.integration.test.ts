/**
 * Thread Cash funding (promo vs paid) through every write path: spending is
 * promo-first, sends and their claims/cancels carry the sender's funding,
 * checkout redemptions and their cancels/refunds restore exactly what they
 * used (refunds give paid money back first), and only paid Thread Cash a
 * seller RECEIVES is withdrawable. No purchase source exists yet, so paid
 * credit is inserted directly with funding 'paid', as a future one would.
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray, or } from "drizzle-orm";
import { db, follows, threadCashEntries, threadCashTransfers, users } from "@workspace/db";
import {
  cancelThreadCash, cancelThreadCashRedemption, claimThreadCash, getHistory, redeemThreadCash, refundThreadCashSpend,
  sendThreadCash,
} from "../wallet";
import { getFundingBalances } from "../funding";

const created: string[] = [];

async function makeUser(tag: string): Promise<string> {
  const clerkId = `tc-funding-${tag}-${crypto.randomUUID()}`;
  created.push(clerkId);
  await db.insert(users).values({
    clerkId, email: `${clerkId}@test.example`, name: tag, createdAt: new Date(Date.now() - 7 * 86_400_000),
  } as any);
  return clerkId;
}

async function credit(userId: string, amountCents: number, funding: "promo" | "paid") {
  await db.insert(threadCashEntries).values({
    buyerId: userId, amountCents, source: funding === "paid" ? "purchase" : "daily_checkin",
    referenceId: crypto.randomUUID(), funding,
  });
}

afterEach(async () => {
  if (created.length === 0) return;
  await db.delete(threadCashEntries).where(inArray(threadCashEntries.buyerId, created));
  await db.delete(threadCashTransfers).where(or(inArray(threadCashTransfers.senderId, created), inArray(threadCashTransfers.recipientId, created)));
  await db.delete(follows).where(or(inArray(follows.followerId, created), inArray(follows.followingId, created)));
  await db.delete(users).where(inArray(users.clerkId, created.splice(0)));
});

describe("Thread Cash funding", () => {
  it("checkout redemption spends promo first; cancelling it restores the same mix", async () => {
    const buyer = await makeUser("redeem");
    await credit(buyer, 300, "promo");
    await credit(buyer, 500, "paid");

    const { token } = await redeemThreadCash(buyer, 600, crypto.randomUUID());
    expect(await getFundingBalances(db, buyer)).toMatchObject({ balanceCents: 200, promoCents: 0, paidCents: 200 });
    // History shows one redemption line, never the internal funding rows.
    const history = await getHistory(buyer);
    expect(history.filter((e) => e.source === "redemption").map((e) => e.amountCents)).toEqual([-600]);
    expect(history.some((e) => e.source === "funding_shift")).toBe(false);

    await cancelThreadCashRedemption(buyer, token);
    expect(await getFundingBalances(db, buyer)).toMatchObject({ balanceCents: 800, promoCents: 300, paidCents: 500 });
  });

  it("a refunded order returns paid Thread Cash first", async () => {
    const buyer = await makeUser("refund");
    await credit(buyer, 300, "promo");
    await credit(buyer, 500, "paid");
    const orderId = crypto.randomUUID();
    const { token } = await redeemThreadCash(buyer, 600, crypto.randomUUID());
    await db.update(threadCashEntries).set({ usedAt: new Date(), usedOrderId: orderId })
      .where(eq(threadCashEntries.referenceId, token));

    await db.transaction((tx) => refundThreadCashSpend(tx, buyer, orderId, 400));
    // 600 = 300 promo + 300 paid; a 400 refund gives back 300 paid + 100 promo.
    expect(await getFundingBalances(db, buyer)).toMatchObject({ balanceCents: 600, promoCents: 100, paidCents: 500 });
    // Exactly once.
    await db.transaction((tx) => refundThreadCashSpend(tx, buyer, orderId, 400));
    expect((await getFundingBalances(db, buyer)).balanceCents).toBe(600);
  });

  it("a send carries the sender's funding to the recipient; a cancelled send returns it as it was", async () => {
    const sender = await makeUser("sender");
    const friend = await makeUser("friend");
    await db.insert(follows).values([
      { followerId: sender, followingId: friend },
      { followerId: friend, followingId: sender },
    ]);
    await credit(sender, 200, "promo");
    await credit(sender, 1_000, "paid");

    const first = await sendThreadCash(sender, friend, 500, { idempotencyKey: crypto.randomUUID() });
    expect(await getFundingBalances(db, sender)).toMatchObject({ promoCents: 0, paidCents: 700 });
    await claimThreadCash(first.transferId, friend);
    // 500 = 200 promo + 300 paid; only the paid part is withdrawable.
    expect(await getFundingBalances(db, friend)).toMatchObject({ balanceCents: 500, promoCents: 200, paidCents: 300, cashableCents: 300 });

    const second = await sendThreadCash(sender, friend, 400, { idempotencyKey: crypto.randomUUID() });
    expect(await getFundingBalances(db, sender)).toMatchObject({ paidCents: 300 });
    await cancelThreadCash(second.transferId, sender);
    expect(await getFundingBalances(db, sender)).toMatchObject({ balanceCents: 700, promoCents: 0, paidCents: 700 });
  });

  it("promo a user holds is never withdrawable, and their own paid top-up isn't either (only paid money received)", async () => {
    const user = await makeUser("own");
    await credit(user, 1_000, "promo");
    await credit(user, 500, "paid");
    expect(await getFundingBalances(db, user)).toMatchObject({ balanceCents: 1_500, promoCents: 1_000, paidCents: 500, cashableCents: 0 });
  });
});
