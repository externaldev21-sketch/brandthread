import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPORT_TIMEZONE, addZonedDays, isoWeekKey, lastFullWeek, reportTimeZone, startOfZonedDay,
  todayWindows, zonedDateKey,
} from "../reportCalendar";
import { SELLER_RISK_THRESHOLD, sellerRiskRates } from "../metricRules";

const CHI = "America/Chicago";

describe("reportTimeZone", () => {
  it("defaults to Chicago and ignores names Intl doesn't know", () => {
    expect(reportTimeZone(undefined)).toBe(DEFAULT_REPORT_TIMEZONE);
    expect(reportTimeZone("Not/AZone")).toBe(DEFAULT_REPORT_TIMEZONE);
    expect(reportTimeZone(" Europe/London ")).toBe("Europe/London");
  });
});

describe("zoned days", () => {
  it("starts the day at local midnight", () => {
    // 2026-10-13 03:00 UTC is still Oct 12 in Chicago (CDT, UTC-5).
    const start = startOfZonedDay(new Date("2026-10-13T03:00:00Z"), CHI);
    expect(start.toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });

  it("handles the DST change: Nov 1 2026 is a 25-hour day in Chicago", () => {
    const nov1 = startOfZonedDay(new Date("2026-11-01T18:00:00Z"), CHI);
    expect(nov1.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(addZonedDays(nov1, 1, CHI).toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });

  it("compares today so far with the same stretch of yesterday", () => {
    const now = new Date("2026-10-13T20:30:00Z"); // 15:30 CDT
    const w = todayWindows(now, CHI);
    expect(w.today.from.toISOString()).toBe("2026-10-13T05:00:00.000Z");
    expect(w.yesterdaySameTime.from.toISOString()).toBe("2026-10-12T05:00:00.000Z");
    expect(w.yesterdaySameTime.to.toISOString()).toBe("2026-10-12T20:30:00.000Z");
    expect(zonedDateKey(now, CHI)).toBe("2026-10-13");
  });
});

describe("lastFullWeek", () => {
  it("is the Monday–Sunday before this Monday, keyed by ISO week", () => {
    const monday9am = new Date("2026-10-12T14:00:00Z"); // Mon Oct 12, 09:00 CDT
    const w = lastFullWeek(monday9am, CHI);
    expect(w.week.from.toISOString()).toBe("2026-10-05T05:00:00.000Z");
    expect(w.week.to.toISOString()).toBe("2026-10-12T05:00:00.000Z");
    expect(w.previous.from.toISOString()).toBe("2026-09-28T05:00:00.000Z");
    expect(w.key).toBe("2026-W41");
  });

  it("gives the same week from any day of the following week", () => {
    const sunday = new Date("2026-10-18T22:00:00Z");
    expect(lastFullWeek(sunday, CHI).key).toBe("2026-W41");
  });

  it("numbers weeks that straddle a new year", () => {
    expect(isoWeekKey(new Date("2026-12-29T12:00:00Z"), CHI)).toBe("2026-W53");
    expect(isoWeekKey(new Date("2027-01-04T12:00:00Z"), CHI)).toBe("2027-W01");
  });
});

describe("sellerRiskRates", () => {
  it("flags a seller above 2% on either rate, not at exactly 2%", () => {
    expect(SELLER_RISK_THRESHOLD).toBe(0.02);
    expect(sellerRiskRates(100, 2, 0).flagged).toBe(false);
    expect(sellerRiskRates(100, 3, 0).flagged).toBe(true);
    expect(sellerRiskRates(100, 0, 3)).toMatchObject({ chargebackRate: 0.03, flagged: true });
    expect(sellerRiskRates(0, 0, 0)).toEqual({ refundRate: 0, chargebackRate: 0, flagged: false });
  });
});
