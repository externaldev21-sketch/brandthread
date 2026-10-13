/**
 * Brandthread's part of the instant payout fee, against real Postgres rows
 * and a fake Stripe: collected by reversing the seller's own order transfers,
 * exactly once, and never more than the fee fixed on the cash-out attempt.
 */
import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db, ledgerTransactions, orders, sellerCashoutAttempts, users } from "@workspace/db";
import { accountBalanceCents, findUnbalancedTransactions } from "../ledger";
import {
  INSTANT_FEE_REVERSAL_KIND, collectInstantPayoutPlatformFee, sweepInstantPayoutFees, type InstantFeeStripe,
} from "../instantPayoutFee";

const RUN = crypto.randomBytes(4).toString("hex");
let seq = 0;
const uid = (tag: string) => `${tag}-${RUN}-${++seq}`;

type FakeTransfer = { id: string; amount: number; amount_reversed: number; reversals: any[] };

function fakeStripe() {
  const transfers = new Map<string, FakeTransfer>();
  const keys = new Map<string, any>();
  const calls = { retrieve: 0, createReversal: [] as Array<{ transferId: string; amount: number }> };
  let failNext: "before" | "after" | null = null;
  let n = 0;
  const client: InstantFeeStripe = {
    transfers: {
      retrieve: (async (id: string) => {
        calls.retrieve++;
        const t = transfers.get(id);
        if (!t) throw Object.assign(new Error("No such transfer"), { statusCode: 404 });
        return {
          id: t.id, amount: t.amount, amount_reversed: t.amount_reversed,
          reversals: { data: [...t.reversals].reverse().slice(0, 10), has_more: t.reversals.length > 10 },
        };
      }) as any,
      listReversals: (async (id: string) => ({ data: [...(transfers.get(id)?.reversals ?? [])].reverse(), has_more: false })) as any,
      createReversal: (async (transferId: string, params: any, opts: any) => {
        if (failNext === "before") { failNext = null; throw Object.assign(new Error("Stripe down"), { statusCode: 500 }); }
        const key = opts?.idempotencyKey;
        if (key && keys.has(key)) return keys.get(key);
        const t = transfers.get(transferId)!;
        if (params.amount > t.amount - t.amount_reversed) throw Object.assign(new Error("Insufficient"), { statusCode: 400 });
        const reversal = { id: `trr_${RUN}_${++n}`, amount: params.amount, transfer: transferId, metadata: params.metadata };
        t.reversals.push(reversal);
        t.amount_reversed += params.amount;
        calls.createReversal.push({ transferId, amount: params.amount });
        if (key) keys.set(key, reversal);
        if (failNext === "after") { failNext = null; throw Object.assign(new Error("Connection lost"), { statusCode: undefined }); }
        return reversal;
      }) as any,
    },
  };
  return {
    client, transfers, calls,
    addTransfer(amount: number, reversed = 0) {
      const id = `tr_${RUN}_${++n}`;
      transfers.set(id, { id, amount, amount_reversed: reversed, reversals: [] });
      return id;
    },
    failNextReversal(when: "before" | "after") { failNext = when; },
  };
}

const sellers: string[] = [];
async function seedSeller(): Promise<string> {
  const clerkId = uid("instant-fee-seller");
  sellers.push(clerkId);
  await db.insert(users).values({
    clerkId, email: `${clerkId}@money-tests.invalid`, name: "Seller", role: "seller",
    stripeAccountId: `acct_${clerkId.replace(/-/g, "_")}`, stripeAccountStatus: "active",
  });
  return clerkId;
}

async function seedOrder(sellerId: string, transferId: string, paidAt: Date) {
  await db.insert(orders).values({
    ownerId: sellerId, orderNumber: uid("BT"), totalCents: 10_000, subtotalCents: 10_000,
    chargeModel: "destination", stripeTransferId: transferId, paidAt,
  } as any);
}

async function seedAttempt(sellerId: string, input: {
  platformFeeCents: number; method?: string; status?: string; payoutId?: string | null; createdAt?: Date;
}): Promise<string> {
  const [row] = await db.insert(sellerCashoutAttempts).values({
    ownerId: sellerId,
    idempotencyKey: uid("cashout"),
    amountCents: 98_522,
    currency: "usd",
    stripeAccountId: "acct_x",
    bankDestinationId: "card_1",
    method: input.method ?? "instant",
    status: input.status ?? "succeeded",
    platformFeeCents: input.platformFeeCents,
    stripePayoutId: input.payoutId === undefined ? `po_${RUN}_${++seq}` : input.payoutId,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  }).returning({ id: sellerCashoutAttempts.id });
  return row.id;
}

const owed = (sellerId: string) => accountBalanceCents(db, { account: "platform_funds_advanced", partyId: sellerId });
const revenue = (sellerId: string) => accountBalanceCents(db, { account: "platform_revenue", partyId: sellerId });
const hourAgo = () => new Date(Date.now() - 3_600_000);

afterAll(async () => {
  if (sellers.length === 0) return;
  await db.delete(sellerCashoutAttempts).where(inArray(sellerCashoutAttempts.ownerId, sellers));
  await db.delete(orders).where(inArray(orders.ownerId, sellers));
});

describe("collectInstantPayoutPlatformFee", () => {
  let stripe: ReturnType<typeof fakeStripe>;
  beforeEach(() => { stripe = fakeStripe(); });

  it("reverses the fee from the newest order transfer and books it in the ledger", async () => {
    const seller = await seedSeller();
    const older = stripe.addTransfer(9_000);
    const newer = stripe.addTransfer(9_000);
    await seedOrder(seller, older, new Date(Date.now() - 7_200_000));
    await seedOrder(seller, newer, hourAgo());
    const attempt = await seedAttempt(seller, { platformFeeCents: 493 });

    const result = await collectInstantPayoutPlatformFee(attempt, { stripe: stripe.client });
    expect(result).toEqual({ status: "collected", feeCents: 493, collectedCents: 493, outstandingCents: 0 });
    expect(stripe.calls.createReversal).toEqual([{ transferId: newer, amount: 493 }]);
    const reversal = stripe.transfers.get(newer)!.reversals[0];
    expect(reversal.metadata).toMatchObject({ kind: INSTANT_FEE_REVERSAL_KIND, attemptId: attempt });
    expect(await revenue(seller)).toBe(493);
    expect(await owed(seller)).toBe(0);
    expect(await accountBalanceCents(db, { account: "seller_paid_out", partyId: seller })).toBe(-493);
    expect(await findUnbalancedTransactions()).toEqual([]);
  });

  it("is idempotent: a second run moves no money and posts nothing", async () => {
    const seller = await seedSeller();
    const t = stripe.addTransfer(9_000);
    await seedOrder(seller, t, hourAgo());
    const attempt = await seedAttempt(seller, { platformFeeCents: 250 });
    await collectInstantPayoutPlatformFee(attempt, { stripe: stripe.client });
    const again = await collectInstantPayoutPlatformFee(attempt, { stripe: stripe.client });
    expect(again.status).toBe("collected");
    expect(stripe.calls.createReversal).toHaveLength(1);
    expect(await revenue(seller)).toBe(250);
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(ledgerTransactions)
      .where(eq(ledgerTransactions.sellerId, seller));
    expect(count.n).toBe(2); // the charge + one recovery
  });

  it("runs concurrently without taking the fee twice", async () => {
    const seller = await seedSeller();
    const t = stripe.addTransfer(9_000);
    await seedOrder(seller, t, hourAgo());
    const attempt = await seedAttempt(seller, { platformFeeCents: 300 });
    await Promise.all([
      collectInstantPayoutPlatformFee(attempt, { stripe: stripe.client }),
      collectInstantPayoutPlatformFee(attempt, { stripe: stripe.client }),
    ]);
    expect(stripe.transfers.get(t)!.amount_reversed).toBe(300);
    expect(await owed(seller)).toBe(0);
    expect(await revenue(seller)).toBe(300);
  });

  it("spreads across transfers when the newest one can't cover it, and skips fully reversed ones", async () => {
    const seller = await seedSeller();
    const a = stripe.addTransfer(5_000, 5_000); // already fully reversed (refund)
    const b = stripe.addTransfer(200);
    const c = stripe.addTransfer(5_000);
    await seedOrder(seller, c, new Date(Date.now() - 3 * 3_600_000));
    await seedOrder(seller, b, new Date(Date.now() - 2 * 3_600_000));
    await seedOrder(seller, a, hourAgo());
    const attempt = await seedAttempt(seller, { platformFeeCents: 500 });
    const result = await collectInstantPayoutPlatformFee(attempt, { stripe: stripe.client });
    expect(result.status).toBe("collected");
    expect(stripe.calls.createReversal).toEqual([{ transferId: b, amount: 200 }, { transferId: c, amount: 300 }]);
    expect(await owed(seller)).toBe(0);
  });

  it("a crash after Stripe reversed (lost response) is recorded on retry, not charged again", async () => {
    const seller = await seedSeller();
    const t = stripe.addTransfer(9_000);
    await seedOrder(seller, t, hourAgo());
    const attempt = await seedAttempt(seller, { platformFeeCents: 400 });
    stripe.failNextReversal("after");
    const first = await collectInstantPayoutPlatformFee(attempt, { stripe: stripe.client });
    expect(first.status).toBe("failed");
    expect(await owed(seller)).toBe(-400); // booked as owed, not yet recovered in the ledger
    // A new order lands after the cash-out: it must not be charged instead.
    const later = stripe.addTransfer(9_000);
    await seedOrder(seller, later, new Date(Date.now() + 60_000));
    const retry = await collectInstantPayoutPlatformFee(attempt, { stripe: stripe.client });
    expect(retry.status).toBe("collected");
    expect(stripe.calls.createReversal).toHaveLength(1);
    expect(stripe.transfers.get(t)!.amount_reversed).toBe(400);
    expect(stripe.transfers.get(later)!.amount_reversed).toBe(0);
    expect(await owed(seller)).toBe(0);
    expect(await revenue(seller)).toBe(400);
  });

  it("a Stripe failure leaves the fee owed and the sweep collects it later", async () => {
    const seller = await seedSeller();
    const t = stripe.addTransfer(9_000);
    await seedOrder(seller, t, hourAgo());
    const attempt = await seedAttempt(seller, { platformFeeCents: 150 });
    stripe.failNextReversal("before");
    expect((await collectInstantPayoutPlatformFee(attempt, { stripe: stripe.client })).status).toBe("failed");
    expect(await owed(seller)).toBe(-150);
    const swept = await sweepInstantPayoutFees({ stripe: stripe.client });
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(await owed(seller)).toBe(0);
    expect(stripe.calls.createReversal).toEqual([{ transferId: t, amount: 150 }]);
  });

  it("keeps a part it can't collect owed (no transfers with room) and reports it", async () => {
    const seller = await seedSeller();
    const t = stripe.addTransfer(100);
    await seedOrder(seller, t, hourAgo());
    const attempt = await seedAttempt(seller, { platformFeeCents: 250 });
    const result = await collectInstantPayoutPlatformFee(attempt, { stripe: stripe.client });
    expect(result).toEqual({ status: "partial", feeCents: 250, collectedCents: 100, outstandingCents: 150 });
    expect(await owed(seller)).toBe(-150);
    expect(await revenue(seller)).toBe(250);
  });

  it("does nothing for standard, unfinished, zero-fee or failed payouts", async () => {
    const seller = await seedSeller();
    const t = stripe.addTransfer(9_000);
    await seedOrder(seller, t, hourAgo());
    const cases = [
      await seedAttempt(seller, { platformFeeCents: 0 }),
      await seedAttempt(seller, { platformFeeCents: 300, method: "standard" }),
      await seedAttempt(seller, { platformFeeCents: 300, status: "processing", payoutId: null }),
      await seedAttempt(seller, { platformFeeCents: 300, status: "failed", payoutId: null }),
    ];
    for (const id of cases) {
      expect((await collectInstantPayoutPlatformFee(id, { stripe: stripe.client })).status).toBe("skipped");
    }
    expect(stripe.calls.createReversal).toHaveLength(0);
    expect(await revenue(seller)).toBe(0);
  });

  it("without Stripe it books the fee as owed and moves no money", async () => {
    const seller = await seedSeller();
    const attempt = await seedAttempt(seller, { platformFeeCents: 120 });
    const result = await collectInstantPayoutPlatformFee(attempt, { stripe: null });
    expect(result).toEqual({ status: "failed", feeCents: 120, collectedCents: 0, outstandingCents: 120 });
    expect(await owed(seller)).toBe(-120);
  });
});
