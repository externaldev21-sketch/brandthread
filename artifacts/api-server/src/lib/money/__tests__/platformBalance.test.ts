import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { sellerHeld: 0 };
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("../../logger", () => ({ logger }));
vi.mock("../ledger", () => ({
  accountBalanceCents: vi.fn(async (_executor: unknown, filter: { account: string }) => {
    expect(filter).toEqual({ account: "seller_held" });
    return state.sellerHeld;
  }),
}));

const {
  balanceCoverage, checkPlatformBalance, lastPlatformBalanceReport, payoutScheduleVerdict, sumCurrency,
} = await import("../platformBalance");

function fakeStripe(input: { interval?: string | null; available?: number; pending?: number; accountError?: boolean }) {
  return {
    accounts: {
      retrieve: vi.fn(async () => {
        if (input.accountError) throw new Error("stripe down");
        return { settings: { payouts: { schedule: { interval: input.interval ?? null } } } } as any;
      }),
    },
    balance: {
      retrieve: vi.fn(async () => ({
        available: [{ amount: input.available ?? 0, currency: "usd" }, { amount: 999_999, currency: "eur" }],
        pending: [{ amount: input.pending ?? 0, currency: "usd" }],
      }) as any),
    },
  };
}

beforeEach(() => {
  state.sellerHeld = 0;
  logger.error.mockClear();
  logger.warn.mockClear();
});

describe("payoutScheduleVerdict (BT-062)", () => {
  it("requires manual payouts in hold mode", () => {
    expect(payoutScheduleVerdict("manual", "hold")).toMatchObject({ ok: true, problem: null });
    expect(payoutScheduleVerdict("daily", "hold")).toMatchObject({ ok: false, problem: "automatic_payouts_in_hold_mode", interval: "daily" });
    expect(payoutScheduleVerdict("Weekly", "hold")).toMatchObject({ ok: false, interval: "weekly" });
    expect(payoutScheduleVerdict(null, "hold")).toMatchObject({ ok: false, problem: "schedule_unreadable" });
  });
  it("does not require manual payouts in immediate (destination) mode", () => {
    expect(payoutScheduleVerdict("daily", "immediate")).toMatchObject({ ok: true });
  });
});

describe("balanceCoverage / sumCurrency", () => {
  it("sums only USD entries", () => {
    expect(sumCurrency([{ amount: 100, currency: "usd" }, { amount: 50, currency: "USD" }, { amount: 7, currency: "eur" }])).toBe(150);
    expect(sumCurrency(undefined)).toBe(0);
  });
  it("flags a shortfall when available + pending is below seller_held", () => {
    expect(balanceCoverage({ availableCents: 400, pendingCents: 500, sellerHeldCents: 1000 }))
      .toEqual({ ok: false, availableCents: 400, pendingCents: 500, sellerHeldCents: 1000, shortfallCents: 100 });
    expect(balanceCoverage({ availableCents: 400, pendingCents: 600, sellerHeldCents: 1000 }).ok).toBe(true);
    expect(balanceCoverage({ availableCents: 0, pendingCents: 0, sellerHeldCents: -50 }).ok).toBe(true);
  });
});

describe("checkPlatformBalance", () => {
  const hold = { PAYOUT_MODE: "hold" } as NodeJS.ProcessEnv;

  it("is quiet when payouts are manual and the balance covers seller_held", async () => {
    state.sellerHeld = 10_000;
    const report = await checkPlatformBalance({ stripe: fakeStripe({ interval: "manual", available: 6_000, pending: 4_000 }), env: hold });
    expect(report.schedule?.ok).toBe(true);
    expect(report.coverage?.ok).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
    expect(lastPlatformBalanceReport()).toBe(report);
  });

  it("logs an error for automatic payouts in hold mode and for a balance shortfall", async () => {
    state.sellerHeld = 10_000;
    const report = await checkPlatformBalance({ stripe: fakeStripe({ interval: "daily", available: 1_000, pending: 2_000 }), env: hold });
    expect(report.schedule).toMatchObject({ ok: false, problem: "automatic_payouts_in_hold_mode" });
    expect(report.coverage).toMatchObject({ ok: false, shortfallCents: 7_000 });
    const checks = logger.error.mock.calls.map((call) => (call[0] as { check: string }).check);
    expect(checks).toEqual(["platform_payout_schedule", "platform_balance_coverage"]);
  });

  it("treats an unreadable schedule as a problem in hold mode", async () => {
    const report = await checkPlatformBalance({ stripe: fakeStripe({ accountError: true }), env: hold });
    expect(report.schedule).toMatchObject({ ok: false, problem: "schedule_unreadable" });
    expect(report.errors).toHaveLength(1);
  });

  it("does nothing without Stripe", async () => {
    const report = await checkPlatformBalance({ stripe: null, env: hold });
    expect(report).toMatchObject({ stripeConfigured: false, schedule: null, coverage: null });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
