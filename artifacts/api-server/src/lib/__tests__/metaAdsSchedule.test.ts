import { describe, expect, it } from "vitest";
import { META_MAX_FLIGHT_DAYS, validateMetaSchedule } from "../metaAdsSchedule";

const NOW = new Date("2026-10-27T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();
const check = (startTime?: string, endTime?: string, budgetType = "daily") =>
  validateMetaSchedule({ startTime, endTime, budgetType }, NOW);

describe("validateMetaSchedule", () => {
  it("accepts start-now with no end, and a future flight", () => {
    expect(check()).toEqual({ ok: true, startTime: null, endTime: null });
    expect(check(at(DAY), at(5 * DAY))).toMatchObject({ ok: true });
  });

  it("rejects a past start but allows a start computed as 'now' a moment ago", () => {
    expect(check(at(-2 * DAY))).toEqual({ ok: false, error: "Start date can't be in the past." });
    expect(check(at(-60 * 1000))).toMatchObject({ ok: true });
  });

  it("rejects an end on or before the start", () => {
    expect(check(at(2 * DAY), at(2 * DAY))).toEqual({ ok: false, error: "End date must be after the start date." });
    expect(check(at(2 * DAY), at(DAY))).toEqual({ ok: false, error: "End date must be after the start date." });
    expect(check(undefined, at(-DAY))).toEqual({ ok: false, error: "End date must be in the future." });
  });

  it("caps the flight at the max days (counting the end day)", () => {
    expect(check(at(DAY), at(DAY + META_MAX_FLIGHT_DAYS * DAY))).toMatchObject({ ok: true });
    expect(check(at(DAY), at(DAY + (META_MAX_FLIGHT_DAYS + 2) * DAY))).toEqual({
      ok: false, error: `Ads can run for up to ${META_MAX_FLIGHT_DAYS} days.`,
    });
  });

  it("needs an end of at least a day for lifetime budgets", () => {
    expect(check(at(DAY), undefined, "lifetime")).toEqual({ ok: false, error: "A lifetime budget needs an end date." });
    expect(check(at(DAY), at(DAY + 3 * 60 * 60 * 1000), "lifetime")).toMatchObject({ ok: false });
    expect(check(at(DAY), at(3 * DAY), "lifetime")).toMatchObject({ ok: true });
  });

  it("rejects unparseable dates and starts more than a year out", () => {
    expect(check("next tuesday")).toEqual({ ok: false, error: "startTime must be an ISO date" });
    expect(check(undefined, "soon")).toEqual({ ok: false, error: "endTime must be an ISO date" });
    expect(check(at(400 * DAY))).toMatchObject({ ok: false });
  });
});
