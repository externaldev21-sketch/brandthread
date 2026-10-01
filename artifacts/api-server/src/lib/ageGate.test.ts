import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as Array<{ ageBand: string | null }> }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => state.rows }) }) }),
  },
  users: { ageBand: "age_band", clerkId: "clerk_id" },
}));

import {
  AgeRestrictedError,
  ageBandFromDob,
  ageInYears,
  assertCanSellOrEarn,
  bandMaySellOrEarn,
  denyIfAgeRestricted,
} from "./ageGate";

const NOW = new Date("2026-09-30T12:00:00Z");

describe("ageBandFromDob", () => {
  it("is under_13 the day before the 13th birthday and 13_17 on it", () => {
    expect(ageBandFromDob("2013-10-01", NOW)).toBe("under_13");
    expect(ageBandFromDob("2013-09-30", NOW)).toBe("13_17");
  });
  it("is 13_17 the day before the 18th birthday and 18_plus on it", () => {
    expect(ageBandFromDob("2008-10-01", NOW)).toBe("13_17");
    expect(ageBandFromDob("2008-09-30", NOW)).toBe("18_plus");
  });
  it("treats a leap-day birthday as reached on Mar 1 in non-leap years", () => {
    // Born 2012-02-29: 13th birthday counted on 2025-03-01 (2025 is not a leap year).
    expect(ageBandFromDob("2012-02-29", new Date("2025-02-28T23:59:00Z"))).toBe("under_13");
    expect(ageBandFromDob("2012-02-29", new Date("2025-03-01T00:00:00Z"))).toBe("13_17");
    // 18th birthday in a leap year lands exactly on Feb 29.
    expect(ageBandFromDob("2008-02-29", new Date("2026-02-28T12:00:00Z"))).toBe("13_17");
    expect(ageBandFromDob("2008-02-29", new Date("2026-03-01T12:00:00Z"))).toBe("18_plus");
    expect(ageBandFromDob("2004-02-29", new Date("2022-02-28T12:00:00Z"))).toBe("13_17");
    expect(ageBandFromDob("2004-02-29", new Date("2022-03-01T12:00:00Z"))).toBe("18_plus");
  });
  it("uses the UTC calendar date, not the server timezone", () => {
    expect(ageBandFromDob("2013-09-30", new Date("2026-09-29T23:59:59Z"))).toBe("under_13");
    expect(ageBandFromDob("2013-09-30", new Date("2026-09-30T00:00:00Z"))).toBe("13_17");
  });
  it("rejects malformed, impossible, future and implausible dates", () => {
    expect(ageBandFromDob("2011-02-30", NOW)).toBeNull();
    expect(ageBandFromDob("2011-13-01", NOW)).toBeNull();
    expect(ageBandFromDob("2011-1-1", NOW)).toBeNull();
    expect(ageBandFromDob("", NOW)).toBeNull();
    expect(ageBandFromDob(undefined, NOW)).toBeNull();
    expect(ageBandFromDob(20110101, NOW)).toBeNull();
    expect(ageBandFromDob("2026-10-01", NOW)).toBeNull();
    expect(ageBandFromDob("2030-01-01", NOW)).toBeNull();
    expect(ageBandFromDob("1900-01-01", NOW)).toBeNull();
    expect(ageInYears("1906-09-30", NOW)).toBe(120);
    expect(ageInYears("1905-09-29", NOW)).toBeNull();
  });
  it("accepts a same-day birth as under_13", () => {
    expect(ageBandFromDob("2026-09-30", NOW)).toBe("under_13");
  });
});

describe("assertCanSellOrEarn", () => {
  beforeEach(() => { state.rows = []; });

  it("blocks known 13_17 and under_13 accounts with a typed error", async () => {
    for (const band of ["13_17", "under_13"]) {
      state.rows = [{ ageBand: band }];
      await expect(assertCanSellOrEarn("u1")).rejects.toMatchObject({ code: "AGE_RESTRICTED", status: 403 });
      await expect(assertCanSellOrEarn("u1")).rejects.toBeInstanceOf(AgeRestrictedError);
    }
  });
  it("allows 18_plus and legacy NULL accounts (no breakage for existing sellers)", async () => {
    state.rows = [{ ageBand: "18_plus" }];
    await expect(assertCanSellOrEarn("u1")).resolves.toBeUndefined();
    state.rows = [{ ageBand: null }];
    await expect(assertCanSellOrEarn("u1")).resolves.toBeUndefined();
    state.rows = [];
    await expect(assertCanSellOrEarn("u1")).resolves.toBeUndefined();
    expect(bandMaySellOrEarn(undefined)).toBe(true);
  });
  it("denyIfAgeRestricted sends the 403 AGE_RESTRICTED body and returns true", async () => {
    state.rows = [{ ageBand: "13_17" }];
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    expect(await denyIfAgeRestricted("u1", { status })).toBe(true);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "AGE_RESTRICTED" }));
    state.rows = [{ ageBand: "18_plus" }];
    expect(await denyIfAgeRestricted("u1", { status })).toBe(false);
  });
});
