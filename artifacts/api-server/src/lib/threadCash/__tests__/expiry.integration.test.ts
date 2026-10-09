/**
 * Thread Cash expiry against a real database (skipped without one, like every
 * *.integration.test.ts here): the job appends idempotent `expiry` entries,
 * spends are FIFO, warnings go out once, and the per-order cap is enforced.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, notificationsFeed, threadCashConfig, threadCashEntries, threadCashExpiryWarnings, users } from "@workspace/db";
import { runThreadCashExpiry, getExpirySummary } from "../expiry";
import { getBalanceCents, redeemThreadCash } from "../wallet";

const DAY = 86_400_000;
const ids: string[] = [];

async function makeBuyer(): Promise<string> {
  const clerkId = `tc-expiry-test-${crypto.randomUUID()}`;
  ids.push(clerkId);
  await db.insert(users).values({ clerkId, email: `${clerkId}@test.example`, name: "Expiry Test" });
  return clerkId;
}

async function credit(buyerId: string, amountCents: number, daysAgo: number, source = "daily_checkin", funding: "promo" | "paid" = "promo") {
  await db.insert(threadCashEntries).values({
    buyerId, amountCents, source, funding, referenceId: crypto.randomUUID(),
    createdAt: new Date(Date.now() - daysAgo * DAY),
  });
}

async function setConfig(expiryDays: number | null, maxRedemptionPerOrderCents: number | null = null) {
  await db.insert(threadCashConfig).values({ id: "default", expiryDays, maxRedemptionPerOrderCents })
    .onConflictDoUpdate({ target: threadCashConfig.id, set: { expiryDays, maxRedemptionPerOrderCents } });
}

beforeEach(() => setConfig(null));
afterEach(async () => {
  await setConfig(null);
  while (ids.length > 0) {
    const id = ids.pop()!;
    await db.delete(threadCashEntries).where(eq(threadCashEntries.buyerId, id));
    await db.delete(threadCashExpiryWarnings).where(eq(threadCashExpiryWarnings.buyerId, id));
    await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, id));
    await db.delete(users).where(eq(users.clerkId, id));
  }
});

describe("thread cash expiry job", () => {
  it("with expiry_days unset, reward credit still expires after the policy's 90 days", async () => {
    const buyer = await makeBuyer();
    await credit(buyer, 100, 400); // lapsed under the 90-day policy
    await credit(buyer, 40, 30);   // still live
    await runThreadCashExpiry();
    expect(await getBalanceCents(db, buyer)).toBe(40);
    expect((await getExpirySummary(buyer)).expiryDays).toBe(90);
  });

  it("a row can shorten expiry but never lengthen it past the policy", async () => {
    await setConfig(365);
    expect((await getExpirySummary(await makeBuyer())).expiryDays).toBe(90);
  });

  it("never expires paid funds, but does expire a promo Live gift (no dodging expiry by gifting)", async () => {
    const seller = await makeBuyer();
    await credit(seller, 300, 400, "live_gift", "paid");
    await credit(seller, 200, 400, "live_gift", "promo");
    await runThreadCashExpiry();
    expect(await getBalanceCents(db, seller)).toBe(300);
  });

  it("expires only lapsed credit and is idempotent across runs", async () => {
    await setConfig(30);
    const buyer = await makeBuyer();
    await credit(buyer, 100, 40); // lapsed
    await credit(buyer, 50, 10);  // live
    await runThreadCashExpiry();
    await runThreadCashExpiry();
    expect(await getBalanceCents(db, buyer)).toBe(50);
    const expiries = (await db.select().from(threadCashEntries).where(eq(threadCashEntries.buyerId, buyer)))
      .filter((e) => e.source === "expiry");
    expect(expiries).toHaveLength(1);
    expect(expiries[0].amountCents).toBe(-100);
  });

  it("does not expire credit that was already spent (FIFO)", async () => {
    await setConfig(30);
    const buyer = await makeBuyer();
    await credit(buyer, 100, 40);
    // spend 100 at day 35 ago, when the credit had not yet lapsed
    await db.insert(threadCashEntries).values({
      buyerId: buyer, amountCents: -100, source: "redemption", referenceId: crypto.randomUUID(),
      createdAt: new Date(Date.now() - 35 * DAY),
    });
    await runThreadCashExpiry();
    expect(await getBalanceCents(db, buyer)).toBe(0);
    const rows = await db.select().from(threadCashEntries).where(eq(threadCashEntries.buyerId, buyer));
    expect(rows.filter((e) => e.source === "expiry")).toHaveLength(0);
  });

  it("warns once about credit lapsing within a week", async () => {
    await setConfig(30);
    const buyer = await makeBuyer();
    await credit(buyer, 100, 25); // lapses in 5 days
    const first = await runThreadCashExpiry();
    const second = await runThreadCashExpiry();
    expect(first.warned).toBeGreaterThanOrEqual(1);
    expect(second.warned).toBe(0);
    const summary = await getExpirySummary(buyer);
    expect(summary.expiringSoon.totalCents).toBe(100);
    const warnings = await db.select().from(threadCashExpiryWarnings).where(eq(threadCashExpiryWarnings.buyerId, buyer));
    expect(warnings).toHaveLength(1);
    const feed = await db.select().from(notificationsFeed).where(eq(notificationsFeed.userId, buyer));
    expect(feed.filter((n) => n.type === "thread_cash_expiring")).toHaveLength(1);
  });
});

describe("redeemThreadCash", () => {
  it("cannot spend lapsed credit even before the job has run", async () => {
    await setConfig(30);
    const buyer = await makeBuyer();
    await credit(buyer, 100, 40);
    await expect(redeemThreadCash(buyer, 50, `k-${crypto.randomUUID()}`)).rejects.toMatchObject({ code: "INSUFFICIENT_THREAD_CASH" });
  });

  it("enforces the per-order cap", async () => {
    await setConfig(null, 500);
    const buyer = await makeBuyer();
    await credit(buyer, 2_000, 1);
    await expect(redeemThreadCash(buyer, 501, `k-${crypto.randomUUID()}`)).rejects.toMatchObject({ code: "THREAD_CASH_REDEMPTION_CAP" });
    const ok = await redeemThreadCash(buyer, 500, `k-${crypto.randomUUID()}`);
    expect(ok.discountCents).toBe(500);
  });
});
