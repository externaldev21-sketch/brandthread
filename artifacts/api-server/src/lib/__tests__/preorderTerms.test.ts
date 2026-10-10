import { describe, expect, it } from "vitest";
import { isProductLive, validateLaunchAt } from "../productLaunch";
import {
  PREORDER_REFUND_WINDOW_DAYS,
  daysUntil,
  maxShipByDate,
  refundRuleCopy,
  validateShipBy,
} from "../preorderTerms";

const now = new Date("2026-10-01T15:30:00.000Z");
const closing = new Date("2026-10-20T00:00:00.000Z");
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

describe("PREORDER_REFUND_WINDOW_DAYS", () => {
  it("is 60", () => expect(PREORDER_REFUND_WINDOW_DAYS).toBe(60));
});

describe("validateShipBy", () => {
  it("accepts exactly day 60 after the closing date", () => {
    const r = validateShipBy({ shipBy: addDays(closing, 60), closingDate: closing, now });
    expect(r.ok).toBe(true);
  });

  it("rejects day 61 and reports the max allowed date", () => {
    const r = validateShipBy({ shipBy: addDays(closing, 61), closingDate: closing, now });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("SHIP_BY_TOO_LATE");
      expect(r.maxShipBy.toISOString()).toBe(addDays(closing, 60).toISOString());
      expect(r.message).toContain("December 19, 2026");
    }
  });

  it("accepts any time of day on day 60", () => {
    const r = validateShipBy({ shipBy: new Date("2026-12-19T23:59:00.000Z"), closingDate: closing, now });
    expect(r.ok).toBe(true);
  });

  it("anchors to now when there is no closing date", () => {
    expect(validateShipBy({ shipBy: addDays(now, 60), now }).ok).toBe(true);
    const r = validateShipBy({ shipBy: addDays(now, 61), now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SHIP_BY_TOO_LATE");
  });

  it("rejects past dates and today", () => {
    const past = validateShipBy({ shipBy: new Date("2026-09-01T00:00:00.000Z"), closingDate: closing, now });
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.code).toBe("SHIP_BY_IN_PAST");
    expect(validateShipBy({ shipBy: now, closingDate: closing, now }).ok).toBe(false);
  });

  it("accepts tomorrow", () => {
    expect(validateShipBy({ shipBy: addDays(now, 1), closingDate: closing, now }).ok).toBe(true);
  });

  it("rejects an invalid date", () => {
    const r = validateShipBy({ shipBy: new Date("nope"), now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_DATE");
  });

  it("explains when the closing date is so old no valid ship-by date exists", () => {
    const old = new Date("2026-06-01T00:00:00.000Z");
    const r = validateShipBy({ shipBy: addDays(now, 5), closingDate: old, now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CLOSING_DATE_PASSED");
  });
});

describe("helpers", () => {
  it("maxShipByDate adds the window to the anchor", () => {
    expect(maxShipByDate({ closingDate: closing }).toISOString()).toBe("2026-12-19T00:00:00.000Z");
  });
  it("daysUntil counts UTC days and never goes negative", () => {
    expect(daysUntil(new Date("2026-10-11T00:00:00.000Z"), now)).toBe(10);
    expect(daysUntil(new Date("2026-09-01T00:00:00.000Z"), now)).toBe(0);
  });
  it("refund copy names the date", () => {
    expect(refundRuleCopy(new Date("2026-12-01T00:00:00.000Z"))).toBe(
      "If it hasn't shipped by December 1, 2026 you're refunded automatically.",
    );
  });
});

describe("launch rules", () => {
  it("products with no launch row are always live", () => {
    expect(isProductLive(null, now)).toBe(true);
    expect(isProductLive(undefined, now)).toBe(true);
  });
  it("is not live before launchAt and live at/after it", () => {
    const launchAt = new Date("2026-10-05T12:00:00.000Z");
    expect(isProductLive({ launchAt, launchedAt: null }, now)).toBe(false);
    expect(isProductLive({ launchAt, launchedAt: null }, launchAt)).toBe(true);
  });
  it("is live once launchedAt is set", () => {
    expect(isProductLive({ launchAt: addDays(now, 3), launchedAt: now }, now)).toBe(true);
  });
  it("validateLaunchAt requires a future time", () => {
    expect(validateLaunchAt(addDays(now, 1), now)).toBeNull();
    expect(validateLaunchAt(now, now)).not.toBeNull();
    expect(validateLaunchAt(new Date("x"), now)).not.toBeNull();
  });
});
