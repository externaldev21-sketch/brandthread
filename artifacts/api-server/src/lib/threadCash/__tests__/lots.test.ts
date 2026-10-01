import { describe, expect, it } from "vitest";
import { dueExpiries, expiringSoon, expiryReferenceFor, replayLots, spendableCents, type LedgerEntryLike } from "../lots";
import { buildLedger, filterLedger, ledgerKind, parseLedgerKind } from "../ledger";
import {
  EXPIRY_WARNING_DAYS, activeExpiryDays, computeExpiresAt, describeRules, maxRedeemableCents, redemptionCapViolation,
} from "../rules";
import { DEFAULT_THREAD_CASH_CONFIG } from "../streaks";

const DAY = 86_400_000;
const T0 = new Date("2026-01-01T12:00:00Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY);
let seq = 0;
const entry = (amountCents: number, source: string, days: number, referenceId: string | null = null): LedgerEntryLike => ({
  id: `e${String(++seq).padStart(4, "0")}`,
  amountCents, source, referenceId, createdAt: at(days),
});

describe("rules", () => {
  it("treats only a positive integer expiryDays as active", () => {
    expect(activeExpiryDays({ expiryDays: null })).toBeNull();
    expect(activeExpiryDays({ expiryDays: 0 })).toBeNull();
    expect(activeExpiryDays({ expiryDays: -5 })).toBeNull();
    expect(activeExpiryDays({ expiryDays: 90 })).toBe(90);
  });

  it("computes expiry as earned + days, or never", () => {
    expect(computeExpiresAt(T0, 30)).toEqual(at(30));
    expect(computeExpiresAt(T0, null)).toBeNull();
  });

  it("caps redemption by balance, order (keeping the card minimum) and the per-order cap", () => {
    const base = { balanceCents: 5_000, orderRemainingCents: 4_000, maxRedemptionPerOrderCents: null, minRemainderCents: 50 };
    expect(maxRedeemableCents(base)).toBe(3_950);
    expect(maxRedeemableCents({ ...base, maxRedemptionPerOrderCents: 1_000 })).toBe(1_000);
    expect(maxRedeemableCents({ ...base, balanceCents: 300, maxRedemptionPerOrderCents: 1_000 })).toBe(300);
    expect(maxRedeemableCents({ ...base, orderRemainingCents: 40 })).toBe(0);
    expect(maxRedeemableCents({ ...base, maxRedemptionPerOrderCents: 0 })).toBe(0);
  });

  it("flags a redemption over the cap and allows one at or under it", () => {
    expect(redemptionCapViolation(1_000, null)).toBeNull();
    expect(redemptionCapViolation(1_000, 1_000)).toBeNull();
    expect(redemptionCapViolation(1_001, 1_000)).toEqual({
      maxCents: 1_000,
      message: "You can apply up to $10.00 of Thread Cash per order.",
    });
  });

  it("publishes the rules it enforces", () => {
    const rules = describeRules({ ...DEFAULT_THREAD_CASH_CONFIG, expiryDays: 180, maxRedemptionPerOrderCents: 2_000 });
    expect(rules.earn).toMatchObject({ dailyCents: 10, streakBonusCents: 100, streakBonusDays: 7 });
    expect(rules.spend.maxRedemptionPerOrderCents).toBe(2_000);
    expect(rules.expiry).toEqual({ expiryDays: 180, warningDays: EXPIRY_WARNING_DAYS });
  });
});

describe("replayLots", () => {
  it("never expires anything when there is no expiry policy", () => {
    const lots = replayLots([entry(100, "daily_checkin", 0)], null);
    expect(lots).toHaveLength(1);
    expect(lots[0].expiresAt).toBeNull();
    expect(dueExpiries(lots, at(9_999))).toEqual([]);
  });

  it("gives each credit an expiry of earned_at + expiryDays", () => {
    const lots = replayLots([entry(10, "daily_checkin", 0), entry(10, "daily_checkin", 5)], 30);
    expect(lots.map((l) => l.expiresAt)).toEqual([at(30), at(35)]);
  });

  it("spends the soonest-expiring lot first (FIFO)", () => {
    const lots = replayLots([
      entry(100, "daily_checkin", 0),
      entry(100, "daily_checkin", 10),
      entry(-150, "redemption", 15),
    ], 30);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ originalCents: 100, remainingCents: 50, expiresAt: at(40) });
  });

  it("consumes across lots and leaves none when fully spent", () => {
    const lots = replayLots([
      entry(40, "daily_checkin", 0),
      entry(60, "streak_bonus", 1),
      entry(-100, "redemption", 2),
    ], 30);
    expect(lots).toEqual([]);
  });

  it("spends expiring credit before non-expiring credit", () => {
    const lots = replayLots([
      entry(500, "live_gift", 0),
      entry(100, "daily_checkin", 1),
      entry(-100, "redemption", 2),
    ], 30);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ source: "live_gift", remainingCents: 500, expiresAt: null });
  });

  it("makes a cash-out draw non-expiring value first", () => {
    const lots = replayLots([
      entry(500, "live_gift", 0),
      entry(100, "daily_checkin", 1),
      entry(-500, "cash_out", 2),
    ], 30);
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ source: "daily_checkin", remainingCents: 100 });
  });

  it("does not spend a lot that had already lapsed at the time of the debit", () => {
    const lots = replayLots([
      entry(100, "daily_checkin", 0),
      entry(100, "daily_checkin", 29),
      entry(-100, "redemption", 31),
    ], 30);
    const byId = Object.fromEntries(lots.map((l) => [l.originalCents + "@" + l.earnedAt.getTime(), l.remainingCents]));
    // the day-0 lot lapsed at day 30, so the day-31 spend came out of the day-29 lot
    expect(byId[`100@${at(0).getTime()}`]).toBe(100);
    expect(lots.find((l) => l.earnedAt.getTime() === at(29).getTime())).toBeUndefined();
  });

  it("zeroes exactly one lot with an expiry entry, leaving the rest", () => {
    const a = entry(100, "daily_checkin", 0);
    const b = entry(100, "daily_checkin", 5);
    const lots = replayLots([a, b, entry(-100, "expiry", 31, expiryReferenceFor(a.id))], 30);
    expect(lots).toHaveLength(1);
    expect(lots[0].entryId).toBe(b.id);
  });

  it("is order-independent for shuffled input", () => {
    const rows = [entry(100, "daily_checkin", 0), entry(100, "daily_checkin", 3), entry(-120, "redemption", 4)];
    expect(replayLots([...rows].reverse(), 30)).toEqual(replayLots(rows, 30));
  });
});

describe("dueExpiries / expiringSoon / spendable", () => {
  const rows = [
    entry(100, "daily_checkin", 0),    // expires day 30
    entry(50, "daily_checkin", 1),     // expires day 31
    entry(25, "streak_bonus", 1),      // expires day 31 (same bucket)
    entry(10, "daily_checkin", 20),    // expires day 50
  ];
  const lots = replayLots(rows, 30);

  it("lists only lots past expiry as due", () => {
    expect(dueExpiries(lots, at(30)).map((l) => l.remainingCents)).toEqual([100]);
    expect(dueExpiries(lots, at(29.9))).toEqual([]);
  });

  it("buckets what lapses within the warning window by day", () => {
    const soon = expiringSoon(lots, at(25), 7);
    expect(soon.totalCents).toBe(175);
    expect(soon.buckets.map((b) => b.amountCents)).toEqual([100, 75]);
    expect(soon.nextExpiresAt).toEqual(at(30));
    expect(expiringSoon(lots, at(0), 7).totalCents).toBe(0);
  });

  it("excludes lapsed value from the spendable balance", () => {
    expect(spendableCents(lots, at(20))).toBe(185);
    expect(spendableCents(lots, at(30.5))).toBe(85);
  });
});

describe("ledger", () => {
  it("builds newest-first rows with a running balance, kinds and expiry", () => {
    const earn = { ...entry(100, "daily_checkin", 0), note: null };
    const spend = { ...entry(-30, "redemption", 1), note: null };
    const lapse = { ...entry(-70, "expiry", 31, expiryReferenceFor(earn.id)), note: "x" };
    const lots = replayLots([earn, spend, lapse], 30);
    const rows = buildLedger([earn, spend, lapse], lots);
    expect(rows.map((r) => [r.kind, r.balanceAfterCents])).toEqual([["expired", 0], ["spent", 70], ["earned", 100]]);
    expect(rows[2].remainingCents).toBe(0);

    const open = buildLedger([earn], replayLots([earn], 30));
    expect(open[0]).toMatchObject({ remainingCents: 100, expiresAt: at(30).toISOString() });
  });

  it("filters by kind and validates the kind param", () => {
    const rows = buildLedger(
      [{ ...entry(10, "daily_checkin", 0), note: null }, { ...entry(-5, "redemption", 1), note: null }],
      [],
    );
    expect(filterLedger(rows, "spent")).toHaveLength(1);
    expect(filterLedger(rows, null)).toHaveLength(2);
    expect(parseLedgerKind("earned")).toBe("earned");
    expect(parseLedgerKind("bogus")).toBeNull();
    expect(ledgerKind({ amountCents: -1, source: "expiry" })).toBe("expired");
  });
});
