/**
 * Thread Cash's daily reward trigger moved from a button tap to cumulative
 * active foreground time. These tests cover the new gate end-to-end against
 * a real (test) database: heartbeats accumulate, a claim under the
 * threshold is rejected, a claim that clears it pays out exactly once per
 * buyer-local day, and the streak still resets after a missed day / rolls
 * over into a new week — the same math as the old check-in path, since
 * awardDailyActiveTimeClaimOnce reuses it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, threadCashEntries, threadCashHeartbeats, threadCashStreaks } from "@workspace/db";
import {
  MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM,
  MIN_HEARTBEATS_FOR_DAILY_CLAIM,
  ThreadCashError,
  awardDailyActiveTimeClaimOnce,
  getBalanceCents,
  recordThreadCashHeartbeat,
} from "../wallet";
import { DEFAULT_THREAD_CASH_CONFIG, computeCheckIn, EMPTY_STREAK_STATE, type StreakState } from "../streaks";

const testBuyerIds: string[] = [];

afterEach(async () => {
  while (testBuyerIds.length > 0) {
    const buyerId = testBuyerIds.pop()!;
    await db.delete(threadCashEntries).where(eq(threadCashEntries.buyerId, buyerId));
    await db.delete(threadCashStreaks).where(eq(threadCashStreaks.buyerId, buyerId));
    await db.delete(threadCashHeartbeats).where(eq(threadCashHeartbeats.buyerId, buyerId));
  }
});

function newBuyerId(): string {
  const id = `thread-cash-active-time-test-${crypto.randomUUID()}`;
  testBuyerIds.push(id);
  return id;
}

describe("recordThreadCashHeartbeat", () => {
  it("increments the heartbeat count per buyer-local day and tracks the max active seconds reported", async () => {
    const buyerId = newBuyerId();
    await recordThreadCashHeartbeat(buyerId, "2025-06-01", 60);
    await recordThreadCashHeartbeat(buyerId, "2025-06-01", 120);
    const { heartbeatCount } = await recordThreadCashHeartbeat(buyerId, "2025-06-01", 90);
    expect(heartbeatCount).toBe(3);

    const [row] = await db.select().from(threadCashHeartbeats).where(eq(threadCashHeartbeats.buyerId, buyerId));
    expect(row.heartbeatCount).toBe(3);
    expect(row.activeSeconds).toBe(120); // the max reported, not the sum
  });

  it("keeps separate counts for separate buyer-local days", async () => {
    const buyerId = newBuyerId();
    await recordThreadCashHeartbeat(buyerId, "2025-06-01", 60);
    await recordThreadCashHeartbeat(buyerId, "2025-06-02", 60);
    const rows = await db.select().from(threadCashHeartbeats).where(eq(threadCashHeartbeats.buyerId, buyerId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.heartbeatCount === 1)).toBe(true);
  });
});

describe("awardDailyActiveTimeClaimOnce — abuse gates", () => {
  it("rejects a claim under the active-seconds threshold even with plenty of heartbeats", async () => {
    const buyerId = newBuyerId();
    const localDate = "2025-06-01";
    for (let i = 0; i < MIN_HEARTBEATS_FOR_DAILY_CLAIM + 2; i++) {
      await recordThreadCashHeartbeat(buyerId, localDate, MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM);
    }
    await expect(awardDailyActiveTimeClaimOnce({
      buyerId, localDate, earnedCents: 10, streakBonusCents: 0,
      activeSeconds: MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM - 1,
    })).rejects.toBeInstanceOf(ThreadCashError);
    expect(await getBalanceCents(db, buyerId)).toBe(0);
  });

  it("rejects a claim that hasn't sent enough heartbeats, even claiming enough active seconds", async () => {
    const buyerId = newBuyerId();
    const localDate = "2025-06-01";
    for (let i = 0; i < MIN_HEARTBEATS_FOR_DAILY_CLAIM - 2; i++) {
      await recordThreadCashHeartbeat(buyerId, localDate, MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM);
    }
    await expect(awardDailyActiveTimeClaimOnce({
      buyerId, localDate, earnedCents: 10, streakBonusCents: 0,
      activeSeconds: MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM,
    })).rejects.toBeInstanceOf(ThreadCashError);
    expect(await getBalanceCents(db, buyerId)).toBe(0);
  });

  it("pays out once the active-time AND heartbeat gates both clear", async () => {
    const buyerId = newBuyerId();
    const localDate = "2025-06-01";
    for (let i = 0; i < MIN_HEARTBEATS_FOR_DAILY_CLAIM; i++) {
      await recordThreadCashHeartbeat(buyerId, localDate, MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM);
    }
    const { created } = await awardDailyActiveTimeClaimOnce({
      buyerId, localDate, earnedCents: 10, streakBonusCents: 0,
      activeSeconds: MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM,
    });
    expect(created).toBe(true);
    expect(await getBalanceCents(db, buyerId)).toBe(10);
  });
});

describe("awardDailyActiveTimeClaimOnce — idempotency", () => {
  it("only ever pays out once per buyer per local date, even racing concurrent claims", async () => {
    const buyerId = newBuyerId();
    const localDate = "2025-06-01";
    for (let i = 0; i < MIN_HEARTBEATS_FOR_DAILY_CLAIM; i++) {
      await recordThreadCashHeartbeat(buyerId, localDate, MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM);
    }
    const results = await Promise.all(
      Array.from({ length: 5 }, () => awardDailyActiveTimeClaimOnce({
        buyerId, localDate, earnedCents: 10, streakBonusCents: 0,
        activeSeconds: MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM,
      })),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await getBalanceCents(db, buyerId)).toBe(10);
  });

  it("a second claim attempt the same day (fresh heartbeats included) still never re-pays", async () => {
    const buyerId = newBuyerId();
    const localDate = "2025-06-01";
    for (let i = 0; i < MIN_HEARTBEATS_FOR_DAILY_CLAIM; i++) {
      await recordThreadCashHeartbeat(buyerId, localDate, MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM);
    }
    const first = await awardDailyActiveTimeClaimOnce({
      buyerId, localDate, earnedCents: 10, streakBonusCents: 0, activeSeconds: MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM,
    });
    const second = await awardDailyActiveTimeClaimOnce({
      buyerId, localDate, earnedCents: 10, streakBonusCents: 0, activeSeconds: MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM,
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await getBalanceCents(db, buyerId)).toBe(10);
  });
});

describe("streak reset and week rollover through the active-time path", () => {
  const config = DEFAULT_THREAD_CASH_CONFIG;

  async function claimDay(buyerId: string, state: StreakState, dateIso: string): Promise<StreakState> {
    const localDate = dateIso;
    for (let i = 0; i < MIN_HEARTBEATS_FOR_DAILY_CLAIM; i++) {
      await recordThreadCashHeartbeat(buyerId, localDate, MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM);
    }
    const result = computeCheckIn(state, config, new Date(`${dateIso}T12:00:00Z`), "UTC");
    await awardDailyActiveTimeClaimOnce({
      buyerId,
      localDate: result.state.lastCheckInDate!,
      earnedCents: result.earnedCents,
      streakBonusCents: result.streakBonusCents,
      activeSeconds: MIN_ACTIVE_SECONDS_FOR_DAILY_CLAIM,
    });
    return result.state;
  }

  it("resets the streak to day 1 after a missed calendar day", async () => {
    const buyerId = newBuyerId();
    let state = EMPTY_STREAK_STATE;
    state = await claimDay(buyerId, state, "2025-06-01");
    expect(state.currentStreak).toBe(1);
    state = await claimDay(buyerId, state, "2025-06-02");
    expect(state.currentStreak).toBe(2);
    // Skip 2025-06-03 entirely — the next claim is a gap of 2 days.
    state = await claimDay(buyerId, state, "2025-06-04");
    expect(state.currentStreak).toBe(1);
  });

  it("completes a 7-day week and starts a fresh week on day 8", async () => {
    const buyerId = newBuyerId();
    let state = EMPTY_STREAK_STATE;
    const days = ["01", "02", "03", "04", "05", "06", "07", "08"];
    for (const day of days) {
      state = await claimDay(buyerId, state, `2025-06-${day}`);
    }
    // Day 7 completed the week (streakBonusDays=7): day 8 starts a fresh cycle at dayInCycle 1.
    const result = computeCheckIn(
      { currentStreak: 7, longestStreak: 7, lastCheckInDate: "2025-06-07" },
      config,
      new Date("2025-06-08T12:00:00Z"),
      "UTC",
    );
    expect(result.dayInCycle).toBe(1);
    expect(state.currentStreak).toBe(8);

    const rows = await db.select().from(threadCashEntries).where(eq(threadCashEntries.buyerId, buyerId));
    const bonuses = rows.filter((r) => r.source === "streak_bonus");
    expect(bonuses).toHaveLength(1);
    expect(bonuses[0].referenceId).toBe("2025-06-07");
  });
});
