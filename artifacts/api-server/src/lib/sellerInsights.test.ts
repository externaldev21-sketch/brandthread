import { describe, expect, it } from "vitest";
import {
  K_ANONYMITY_MIN, applyKAnonymity, conversionPct, deltaPct, funnelRates, goalPacing, goalWindow,
  locationLabel, parseInsightRange, rangeLabel, rangeWindow, resolveDevice, viewerKeyFor,
} from "./sellerInsights";

const NOW = new Date("2026-09-30T02:30:00Z"); // 22:30 on Tue Sep 29 at UTC-4
const TZ = -240;

describe("ranges", () => {
  it("defaults unknown ranges to today (the Dashboard default)", () => {
    expect(parseInsightRange("week")).toBe("week");
    expect(parseInsightRange("7d")).toBe("today");
    expect(parseInsightRange(undefined)).toBe("today");
  });
  it("today: local calendar day, hourly, capped at the end of the current hour", () => {
    const w = rangeWindow("today", NOW, TZ);
    expect(w.start.toISOString()).toBe("2026-09-29T04:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-09-30T03:00:00.000Z");
    expect(w.step).toBe("1 hour");
    expect(w.previous).toEqual({ start: new Date("2026-09-28T05:00:00.000Z"), end: w.start });
  });
  it("week: Sunday-first local week, daily, never past today", () => {
    const w = rangeWindow("week", NOW, TZ);
    expect(w.start.toISOString()).toBe("2026-09-27T04:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-09-30T04:00:00.000Z");
    expect(w.step).toBe("1 day");
  });
  it("month and year use the calendar, not trailing windows", () => {
    const m = rangeWindow("month", NOW, TZ);
    expect(m.start.toISOString()).toBe("2026-09-01T04:00:00.000Z");
    expect(m.step).toBe("1 day");
    const y = rangeWindow("year", NOW, TZ);
    expect(y.start.toISOString()).toBe("2026-01-01T04:00:00.000Z");
    expect(y.end.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(y.step).toBe("1 month");
    expect(y.previous?.start.toISOString()).toBe("2025-04-03T04:00:00.000Z");
  });
  it("all: anchored to the first data point with granularity by age, and no previous period", () => {
    const young = rangeWindow("all", NOW, TZ, new Date("2026-09-10T12:00:00Z"));
    expect(young.step).toBe("1 day");
    expect(young.start.toISOString()).toBe("2026-09-10T04:00:00.000Z");
    expect(young.previous).toBeNull();
    expect(rangeWindow("all", NOW, TZ, new Date("2026-03-01T00:00:00Z")).step).toBe("1 week");
    expect(rangeWindow("all", NOW, TZ, new Date("2024-03-01T00:00:00Z")).step).toBe("1 month");
    // A seller with no anchor at all still gets a valid (today) window.
    const none = rangeWindow("all", NOW, TZ, null);
    expect(none.end.getTime()).toBeGreaterThan(none.start.getTime());
  });
  it("labels every range", () => {
    expect(rangeLabel("today")).toBe("Today");
    expect(rangeLabel("all")).toBe("All time");
  });
});

describe("deltas and conversion math", () => {
  it("compares against the previous period and refuses to divide by zero", () => {
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(50, 100)).toBe(-50);
    expect(deltaPct(0, 0)).toBe(0);
    expect(deltaPct(5, 0)).toBeNull();
    expect(deltaPct(5, null)).toBeNull();
  });
  it("returns null with no denominator and caps at 100", () => {
    expect(conversionPct(3, 0)).toBeNull();
    expect(conversionPct(5, 4)).toBe(100);
    expect(conversionPct(1, 3)).toBe(33.3);
  });
  it("computes view->cart, cart->purchase and view->purchase", () => {
    expect(funnelRates({ views: 200, addToCarts: 20, purchases: 5 })).toEqual({ viewToCartPct: 10, cartToPurchasePct: 25, viewToPurchasePct: 2.5 });
    expect(funnelRates({ views: 0, addToCarts: 0, purchases: 2 })).toEqual({ viewToCartPct: null, cartToPurchasePct: null, viewToPurchasePct: null });
  });
});

describe("k-anonymity", () => {
  it("hides buckets below the threshold and counts them", () => {
    const r = applyKAnonymity([{ people: 12 }, { people: 5 }, { people: 4 }, { people: 1 }]);
    expect(r.shown.map((b) => b.people)).toEqual([12, 5]);
    expect(r.hiddenBuckets).toBe(2);
    expect(K_ANONYMITY_MIN).toBe(5);
  });
  it("normalises shipping addresses and drops unusable ones", () => {
    expect(locationLabel({ country: " us ", state: "ca" })).toEqual({ country: "US", region: "CA" });
    expect(locationLabel({ country: "", state: "CA" })).toBeNull();
    expect(locationLabel(null)).toBeNull();
  });
});

describe("devices", () => {
  it("prefers the app's declared platform", () => {
    expect(resolveDevice("ios", "Mozilla/5.0 (Linux; Android 14)")).toBe("ios");
    expect(resolveDevice("tv", "Mozilla/5.0 (Linux; Android 14)")).toBe("android");
  });
  it("sniffs browsers and native networking stacks", () => {
    expect(resolveDevice(undefined, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
    expect(resolveDevice(undefined, "Brandthread/1.0 CFNetwork/1485 Darwin/23.1.0")).toBe("ios");
    expect(resolveDevice(undefined, "okhttp/4.12.0")).toBe("android");
    expect(resolveDevice(undefined, "Mozilla/5.0 (Macintosh) Chrome/120")).toBe("web");
    expect(resolveDevice(undefined, "")).toBeNull();
    expect(resolveDevice(undefined, "curl/8.0")).toBeNull();
  });
});

describe("goals", () => {
  it("builds local week / month / quarter / year windows", () => {
    expect(goalWindow("week", NOW, TZ).start.toISOString()).toBe("2026-09-27T04:00:00.000Z");
    expect(goalWindow("month", NOW, TZ)).toEqual({ start: new Date("2026-09-01T04:00:00.000Z"), end: new Date("2026-10-01T04:00:00.000Z") });
    expect(goalWindow("quarter", NOW, TZ)).toEqual({ start: new Date("2026-07-01T04:00:00.000Z"), end: new Date("2026-10-01T04:00:00.000Z") });
    expect(goalWindow("year", NOW, TZ).end.toISOString()).toBe("2027-01-01T04:00:00.000Z");
  });
  it("projects pace from the elapsed fraction of the period", () => {
    const window = goalWindow("month", NOW, TZ);
    const behind = goalPacing(100_00, 1000_00, NOW, window);
    expect(behind.status).toBe("behind");
    expect(behind.progressPct).toBe(10);
    expect(behind.remaining).toBe(900_00);
    expect(behind.projected).not.toBeNull();
    expect(behind.daysLeft).toBe(2); // ends Oct 1 local midnight, ~25.5h away
    expect(goalPacing(1000_00, 1000_00, NOW, window).status).toBe("achieved");
    expect(goalPacing(0, 100, window.start, window).status).toBe("not_started");
    const onTrack = goalPacing(990_00, 1000_00, NOW, window);
    expect(onTrack.status).toBe("on_track");
  });
});

describe("hashing", () => {
  it("is stable per seller and uncorrelatable across sellers", () => {
    expect(viewerKeyFor("s1", "u1")).toBe(viewerKeyFor("s1", "u1"));
    expect(viewerKeyFor("s1", "u1")).not.toBe(viewerKeyFor("s2", "u1"));
    expect(viewerKeyFor("s1", "u1")).not.toContain("u1");
  });
});
