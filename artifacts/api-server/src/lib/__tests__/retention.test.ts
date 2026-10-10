import { describe, expect, it } from "vitest";
import { pauseEnd, pauseState, vacationMessage } from "../subscriptionPause";
import { isWinbackDue, winbackEmail } from "../sellerWinback";

const now = new Date("2026-10-10T12:00:00Z");
const DAY = 86_400_000;

describe("pause", () => {
  it("offers a pause on an active plan that hasn't paused in 6 months", () => {
    expect(pauseState({ status: "active", pause_collection: null, metadata: {} } as any, now)).toEqual({ paused: false, canPause: true, nextPauseAt: null });
    const recent = String(now.getTime() - 30 * DAY);
    expect(pauseState({ status: "active", pause_collection: null, metadata: { lastPausedAt: recent } } as any, now))
      .toMatchObject({ paused: false, canPause: false });
    const old = String(now.getTime() - 200 * DAY);
    expect(pauseState({ status: "active", pause_collection: null, metadata: { lastPausedAt: old } } as any, now)).toMatchObject({ canPause: true });
  });
  it("doesn't offer it during a trial or past due", () => {
    expect(pauseState({ status: "trialing", pause_collection: null, metadata: {} } as any, now)).toMatchObject({ canPause: false });
  });
  it("reports an active pause", () => {
    const resumes = Math.floor((now.getTime() + 10 * DAY) / 1000);
    expect(pauseState({ status: "active", pause_collection: { behavior: "void", resumes_at: resumes }, metadata: {} } as any, now))
      .toEqual({ paused: true, resumesAt: new Date(resumes * 1000) });
  });
  it("lasts 30 days and tells buyers when the store is back", () => {
    expect(pauseEnd(now).toISOString()).toBe("2026-11-09T12:00:00.000Z");
    expect(vacationMessage(new Date("2026-11-09T12:00:00Z"))).toBe("We're taking a short break. Back on Nov 9.");
  });
});

describe("win-back", () => {
  it("is due 7 to 14 days after a plan ended", () => {
    expect(isWinbackDue({ status: "canceled", periodEnd: new Date(now.getTime() - 6 * DAY) }, now)).toBe(false);
    expect(isWinbackDue({ status: "canceled", periodEnd: new Date(now.getTime() - 8 * DAY) }, now)).toBe(true);
    expect(isWinbackDue({ status: "expired", periodEnd: new Date(now.getTime() - 13 * DAY) }, now)).toBe(true);
    expect(isWinbackDue({ status: "canceled", periodEnd: new Date(now.getTime() - 20 * DAY) }, now)).toBe(false);
    expect(isWinbackDue({ status: "active", periodEnd: new Date(now.getTime() - 8 * DAY) }, now)).toBe(false);
  });
  it("names the store and what's saved", () => {
    const email = winbackEmail({ brandName: "Halo", productCount: 12 });
    expect(email.subject).toBe("Halo is ready when you are");
    expect(email.html).toContain("Your 12 products are saved");
    expect(email.html).toContain("/plans");
  });
});
