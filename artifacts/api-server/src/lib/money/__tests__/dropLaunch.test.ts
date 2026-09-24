import { describe, it, expect, afterEach } from "vitest";
import { effectiveDropLaunchAt, isDropLive } from "../dropLaunch";

describe("effectiveDropLaunchAt", () => {
  it("returns releaseAt unchanged with no early access window", () => {
    const releaseAt = new Date("2026-01-01T18:00:00.000Z");
    expect(effectiveDropLaunchAt(releaseAt, 0, true)).toEqual(releaseAt);
    expect(effectiveDropLaunchAt(releaseAt, 30, false)).toEqual(releaseAt);
  });

  it("pulls the launch forward for a viewer with early access", () => {
    const releaseAt = new Date("2026-01-01T18:00:00.000Z");
    const result = effectiveDropLaunchAt(releaseAt, 30, true);
    expect(result.toISOString()).toBe("2026-01-01T17:30:00.000Z");
  });

  it("never grants early access to a viewer without it", () => {
    const releaseAt = new Date("2026-01-01T18:00:00.000Z");
    expect(effectiveDropLaunchAt(releaseAt, 30, false)).toEqual(releaseAt);
  });
});

describe("isDropLive — server-clock launch gating", () => {
  it("is false before releaseAt and true at/after it", () => {
    const releaseAt = new Date("2026-01-01T18:00:00.000Z");
    expect(isDropLive(releaseAt, 0, false, new Date("2026-01-01T17:59:59.999Z"))).toBe(false);
    expect(isDropLive(releaseAt, 0, false, new Date("2026-01-01T18:00:00.000Z"))).toBe(true);
    expect(isDropLive(releaseAt, 0, false, new Date("2026-01-01T18:00:00.001Z"))).toBe(true);
  });

  it("is false with no releaseAt (drop never scheduled)", () => {
    expect(isDropLive(null, 0, false)).toBe(false);
  });

  it("lets an early-access follower buy inside the window, but not a non-follower", () => {
    const releaseAt = new Date("2026-01-01T18:00:00.000Z");
    const duringWindow = new Date("2026-01-01T17:45:00.000Z"); // 15 min before release
    expect(isDropLive(releaseAt, 30, true, duringWindow)).toBe(true);
    expect(isDropLive(releaseAt, 30, false, duringWindow)).toBe(false);
    // Still gated before the early-access window itself opens.
    const beforeWindow = new Date("2026-01-01T17:00:00.000Z");
    expect(isDropLive(releaseAt, 30, true, beforeWindow)).toBe(false);
  });

  // "Server time" must mean the same UTC instant no matter what timezone the
  // process (or a buyer's device) happens to be in — gating never depends on
  // the local clock, only on the epoch millisecond releaseAt was stored as.
  describe("is timezone-independent (compares UTC instants only)", () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      process.env.TZ = originalTz;
    });

    const releaseAt = new Date("2026-06-15T04:00:00.000Z"); // midnight in New York (DST)
    const justBefore = new Date(releaseAt.getTime() - 1000);
    const justAfter = new Date(releaseAt.getTime() + 1000);

    for (const tz of ["UTC", "America/New_York", "Pacific/Kiritimati", "Pacific/Midway"]) {
      it(`process TZ=${tz} still gates on the same UTC instant`, () => {
        process.env.TZ = tz;
        expect(isDropLive(releaseAt, 0, false, justBefore)).toBe(false);
        expect(isDropLive(releaseAt, 0, false, justAfter)).toBe(true);
      });
    }
  });
});
