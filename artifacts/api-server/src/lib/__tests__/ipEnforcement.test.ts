import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPEAT_INFRINGER_STRIKES,
  addStrike,
  canReceiveCounterNotice,
  canResolveCounterNotice,
  extractProductId,
  removeStrike,
  repeatInfringerThreshold,
  validateNotice,
} from "../ipEnforcement";

describe("repeat-infringer strikes", () => {
  it("defaults to 3 strikes and honours IP_REPEAT_INFRINGER_STRIKES", () => {
    expect(repeatInfringerThreshold({})).toBe(DEFAULT_REPEAT_INFRINGER_STRIKES);
    expect(repeatInfringerThreshold({ IP_REPEAT_INFRINGER_STRIKES: "5" })).toBe(5);
    expect(repeatInfringerThreshold({ IP_REPEAT_INFRINGER_STRIKES: "0" })).toBe(3);
    expect(repeatInfringerThreshold({ IP_REPEAT_INFRINGER_STRIKES: "abc" })).toBe(3);
  });

  it("flags exactly once, on the strike that reaches the threshold", () => {
    const first = addStrike(0, false, 3);
    expect(first).toEqual({ count: 1, flagged: false, newlyFlagged: false });
    const second = addStrike(first.count, first.flagged, 3);
    expect(second.flagged).toBe(false);
    const third = addStrike(second.count, second.flagged, 3);
    expect(third).toEqual({ count: 3, flagged: true, newlyFlagged: true });
    const fourth = addStrike(third.count, third.flagged, 3);
    expect(fourth).toEqual({ count: 4, flagged: true, newlyFlagged: false });
  });

  it("removing a strike never goes below zero and keeps the flag for a moderator to clear", () => {
    expect(removeStrike(3, true)).toEqual({ count: 2, flagged: true, newlyFlagged: false });
    expect(removeStrike(0, false).count).toBe(0);
  });
});

describe("counter-notice rules", () => {
  it("only accepts a counter-notice once, after a takedown", () => {
    expect(canReceiveCounterNotice({ takedownAt: null, counterNoticeStatus: "none" })).toBe(false);
    expect(canReceiveCounterNotice({ takedownAt: new Date(), counterNoticeStatus: "none" })).toBe(true);
    expect(canReceiveCounterNotice({ takedownAt: new Date(), counterNoticeStatus: "received" })).toBe(false);
    expect(canReceiveCounterNotice({ takedownAt: new Date(), counterNoticeStatus: "upheld" })).toBe(false);
  });

  it("only resolves a received counter-notice", () => {
    expect(canResolveCounterNotice("received")).toBe(true);
    expect(canResolveCounterNotice("none")).toBe(false);
    expect(canResolveCounterNotice("reinstated")).toBe(false);
  });
});

describe("notice intake", () => {
  it("finds a product id inside a pasted listing link", () => {
    expect(extractProductId("https://brandthread.app/product/3F2504E0-4F89-41D3-9A0C-0305E82C3301?ref=x"))
      .toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(extractProductId("https://brandthread.app/u/someone")).toBeNull();
    expect(extractProductId(null)).toBeNull();
  });

  it("requires the DMCA statements and a signature on the web form only", () => {
    expect(validateNotice({ channel: "app" })).toEqual({ ok: true, channel: "app", signature: null });
    expect(validateNotice({ channel: "web_notice", accuracyStatement: true, signature: "Jo Rights" }).ok).toBe(false);
    expect(validateNotice({ channel: "web_notice", goodFaithStatement: true, signature: "Jo Rights" }).ok).toBe(false);
    expect(validateNotice({ channel: "web_notice", goodFaithStatement: true, accuracyStatement: true, signature: " " }).ok).toBe(false);
    expect(validateNotice({ channel: "web_notice", goodFaithStatement: true, accuracyStatement: true, signature: "Jo Rights" }))
      .toEqual({ ok: true, channel: "web_notice", signature: "Jo Rights" });
  });
});
