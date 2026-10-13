import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));

import { buildAccountStatus, STRIKE_LIMIT, toMyReport, type StrikeRow } from "../accountStatus";

const NOW = new Date("2026-10-13T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.valueOf() - n * 86_400_000);
const strike = (id: string, days: number, over: Partial<StrikeRow> = {}): StrikeRow => ({
  id, kind: "community", reason: "harassment", action: "remove_content", targetType: "comment", issuedAt: daysAgo(days), ...over,
});

describe("buildAccountStatus", () => {
  it("is in good standing with no strikes", () => {
    const s = buildAccountStatus([], { suspendedAt: null }, NOW);
    expect(s).toMatchObject({ standing: "good", headline: "Your account is in good standing", activeStrikes: 0, strikeLimit: 3 });
  });

  it("counts only strikes from the last 90 days and lists newest first", () => {
    const s = buildAccountStatus([strike("old", 120), strike("new", 2), strike("mid", 40)], { suspendedAt: null }, NOW);
    expect(s.standing).toBe("at_risk");
    expect(s.headline).toBe("2 of 3 strikes");
    expect(s.strikes.map((x) => [x.id, x.active])).toEqual([["new", true], ["mid", true], ["old", false]]);
    expect(s.strikes[0]).toMatchObject({ title: "Comment removed", reasonLabel: "Bullying or harassment" });
  });

  it("reaches the limit at 3 active strikes", () => {
    const rows = Array.from({ length: STRIKE_LIMIT }, (_, i) => strike(`s${i}`, i + 1));
    expect(buildAccountStatus(rows, { suspendedAt: null }, NOW)).toMatchObject({ standing: "limit_reached", headline: "Your account is under review" });
  });

  it("shows suspension above everything else", () => {
    expect(buildAccountStatus([], { suspendedAt: daysAgo(1) }, NOW).standing).toBe("suspended");
  });

  it("titles each kind of strike plainly", () => {
    const s = buildAccountStatus([
      strike("ip", 1, { kind: "ip", reason: "counterfeit", targetType: "product" }),
      strike("warn", 2, { action: "warn", targetType: "post" }),
      strike("susp", 3, { action: "suspend_user", targetType: "profile" }),
      strike("listing", 4, { targetType: "product", reason: "scam" }),
    ], { suspendedAt: null }, NOW);
    expect(s.strikes.map((x) => x.title)).toEqual([
      "Listing removed for intellectual property", "Warning for a post", "Account suspended", "Listing removed",
    ]);
    expect(s.strikes[0].reasonLabel).toBe("Counterfeit");
  });
});

describe("toMyReport", () => {
  const base = { id: "r1", target_type: "post", target_label: null, reason: "spam", created_at: NOW, resolved_at: null };
  it("maps the moderator outcome to what the reporter sees", () => {
    expect(toMyReport({ ...base, status: "pending", resolution_action: null })).toMatchObject({ status: "in_review", statusLabel: "In review", targetType: "Post", reasonLabel: "Spam" });
    expect(toMyReport({ ...base, status: "actioned", resolution_action: "remove_content" })).toMatchObject({ status: "removed", statusLabel: "We took action" });
    expect(toMyReport({ ...base, status: "dismissed", resolution_action: "dismiss" })).toMatchObject({ status: "no_violation", statusLabel: "No violation found" });
  });
});
