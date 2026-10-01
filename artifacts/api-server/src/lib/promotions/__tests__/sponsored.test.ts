import { describe, expect, it } from "vitest";
import {
  PACING_INITIAL_BURST, SPONSORED_COST_PER_IMPRESSION_CENTS, SPONSORED_EVERY_N_ORGANIC,
  SPONSORED_MAX_PER_VIEWER_PER_DAY, filterEligible, flightElapsed, ineligibleReason, injectSponsored,
  pacedAllowanceCents, planSponsoredSlots, rankEligible, sponsoredInsertionPoints,
  type SponsoredCandidate, type SponsoredViewerContext,
} from "../sponsored";

const NOW = new Date("2026-06-10T12:00:00Z");
const DAY = 86_400_000;

function cand(over: Partial<SponsoredCandidate> = {}): SponsoredCandidate {
  return {
    boostId: "b1", postId: "p1", sellerId: "seller-1",
    status: "active", reviewStatus: "approved", paidAt: new Date(NOW.getTime() - DAY),
    startsAt: new Date(NOW.getTime() - DAY), endsAt: new Date(NOW.getTime() + 6 * DAY),
    budgetCents: 10_000, deliveredSpendCents: 0,
    postVisible: true, sellerOnVacation: false, text: "new drop",
    ...over,
  };
}

function ctx(over: Partial<SponsoredViewerContext> = {}): SponsoredViewerContext {
  return {
    viewerId: "viewer-1", blockedUserIds: new Set(), mutedPhrases: [],
    sessionSeenBoostIds: new Set(), servedLast24h: new Map(), now: NOW, ...over,
  };
}

describe("ineligibleReason", () => {
  it("accepts a healthy approved, paid, in-window boost", () => {
    expect(ineligibleReason(cand(), ctx())).toBeNull();
  });

  it.each([
    ["not_active", { status: "paused" }],
    ["not_active", { status: "in_review" }],
    ["not_approved", { reviewStatus: "pending" }],
    ["not_approved", { reviewStatus: "rejected" }],
    ["not_paid", { paidAt: null }],
    ["outside_window", { startsAt: new Date(NOW.getTime() + DAY) }],
    ["outside_window", { startsAt: null }],
    ["outside_window", { endsAt: new Date(NOW.getTime() - 1) }],
    ["budget_exhausted", { deliveredSpendCents: 10_000 }],
    ["post_unavailable", { postVisible: false }],
    ["own_post", { sellerId: "viewer-1" }],
    ["blocked", { sellerId: "blocked-seller" }],
    ["vacation", { sellerOnVacation: true }],
  ] as const)("rejects with %s", (reason, over) => {
    const c = cand(over as Partial<SponsoredCandidate>);
    expect(ineligibleReason(c, ctx({ blockedUserIds: new Set(["blocked-seller"]) }))).toBe(reason);
  });

  it("respects the viewer's muted words (case-insensitive, caption + hashtags)", () => {
    expect(ineligibleReason(cand({ text: "Summer SALE #deal" }), ctx({ mutedPhrases: ["sale"] }))).toBe("muted");
    expect(ineligibleReason(cand({ text: "new drop" }), ctx({ mutedPhrases: ["sale", "  "] }))).toBeNull();
  });

  it("never repeats a boost within a session", () => {
    expect(ineligibleReason(cand(), ctx({ sessionSeenBoostIds: new Set(["b1"]) }))).toBe("seen_this_session");
  });

  it("caps how often one viewer sees the same boost per day", () => {
    const served = new Map([["b1", SPONSORED_MAX_PER_VIEWER_PER_DAY]]);
    expect(ineligibleReason(cand(), ctx({ servedLast24h: served }))).toBe("daily_cap");
    expect(ineligibleReason(cand(), ctx({ servedLast24h: new Map([["b1", SPONSORED_MAX_PER_VIEWER_PER_DAY - 1]]) }))).toBeNull();
  });
});

describe("pacing", () => {
  it("flightElapsed clamps to 0..1", () => {
    const s = new Date(NOW.getTime() - DAY);
    const e = new Date(NOW.getTime() + DAY);
    expect(flightElapsed(s, e, NOW)).toBeCloseTo(0.5);
    expect(flightElapsed(s, e, new Date(s.getTime() - 5))).toBe(0);
    expect(flightElapsed(s, e, new Date(e.getTime() + 5))).toBe(1);
  });

  it("allows only a small opening burst on day zero", () => {
    const c = cand({ startsAt: NOW, endsAt: new Date(NOW.getTime() + 7 * DAY), budgetCents: 10_000 });
    expect(pacedAllowanceCents(c, NOW)).toBe(Math.floor(10_000 * PACING_INITIAL_BURST));
  });

  it("blocks a boost that is ahead of its pacing curve and frees it as time passes", () => {
    const startsAt = new Date(NOW.getTime() - DAY);
    const endsAt = new Date(NOW.getTime() + 6 * DAY); // 1/7 elapsed
    const allowance = pacedAllowanceCents({ budgetCents: 10_000, startsAt, endsAt }, NOW);
    const ahead = cand({ startsAt, endsAt, deliveredSpendCents: allowance }); // next impression would exceed it
    expect(ineligibleReason(ahead, ctx())).toBe("pacing");
    const later = new Date(NOW.getTime() + 2 * DAY);
    expect(ineligibleReason(ahead, ctx({ now: later }))).toBeNull();
  });

  it("never allows more than the budget regardless of elapsed time", () => {
    const c = cand({ endsAt: new Date(NOW.getTime() + 1000), deliveredSpendCents: 9_999 });
    expect(pacedAllowanceCents(c, NOW)).toBeLessThanOrEqual(c.budgetCents);
    expect(ineligibleReason(c, ctx())).toBe("budget_exhausted");
  });
});

describe("rankEligible", () => {
  it("serves the most under-delivered boost first, then the soonest to end", () => {
    const behind = cand({ boostId: "behind", deliveredSpendCents: 0 });
    const ahead = cand({ boostId: "ahead", deliveredSpendCents: 1_000 });
    expect(rankEligible([ahead, behind], NOW).map((c) => c.boostId)).toEqual(["behind", "ahead"]);
    const soon = cand({ boostId: "soon", endsAt: new Date(NOW.getTime() + DAY) });
    const late = cand({ boostId: "late" });
    expect(rankEligible([late, soon], NOW)[0].boostId).toBe("soon");
  });
});

describe("sponsoredInsertionPoints (frequency cap)", () => {
  it("never places a Sponsored item first and waits N organic items", () => {
    const points = sponsoredInsertionPoints(0, 20);
    expect(points[0]).toBe(SPONSORED_EVERY_N_ORGANIC - 1);
    expect(points).not.toContain(-1);
  });

  it("is at most one per N organic items, continuing across pages", () => {
    const pageSize = 20;
    const all: number[] = [];
    for (let page = 0; page < 5; page += 1) {
      for (const p of sponsoredInsertionPoints(page * pageSize, pageSize)) all.push(page * pageSize + p);
    }
    for (let i = 1; i < all.length; i += 1) {
      expect(all[i] - all[i - 1]).toBe(SPONSORED_EVERY_N_ORGANIC);
    }
    expect(all.length).toBe(Math.floor((5 * pageSize) / SPONSORED_EVERY_N_ORGANIC));
  });

  it("yields nothing for a short page", () => {
    expect(sponsoredInsertionPoints(0, SPONSORED_EVERY_N_ORGANIC - 1)).toEqual([]);
    expect(sponsoredInsertionPoints(0, 0)).toEqual([]);
  });
});

describe("planSponsoredSlots", () => {
  it("fills slots with distinct boosts from distinct sellers", () => {
    const candidates = [
      cand({ boostId: "a", sellerId: "s1" }),
      cand({ boostId: "b", sellerId: "s1" }),
      cand({ boostId: "c", sellerId: "s2" }),
    ];
    const slots = planSponsoredSlots({ candidates, ctx: ctx(), organicOffset: 0, organicCount: 30 });
    expect(slots.length).toBe(2); // only two distinct sellers
    expect(new Set(slots.map((s) => s.candidate.boostId)).size).toBe(slots.length);
    expect(new Set(slots.map((s) => s.candidate.sellerId)).size).toBe(slots.length);
  });

  it("returns nothing when no candidate is eligible", () => {
    const slots = planSponsoredSlots({
      candidates: [cand({ reviewStatus: "pending" }), cand({ boostId: "x", sellerId: "viewer-1" })],
      ctx: ctx(), organicOffset: 0, organicCount: 30,
    });
    expect(slots).toEqual([]);
  });

  it("filterEligible drops everything the viewer should not see", () => {
    const list = [cand(), cand({ boostId: "x", status: "paused" })];
    expect(filterEligible(list, ctx()).map((c) => c.boostId)).toEqual(["b1"]);
  });
});

describe("injectSponsored", () => {
  it("splices sponsored items after their organic index without dropping anything", () => {
    const out = injectSponsored(["o0", "o1", "o2", "o3"], [{ afterIndex: 1, item: "S" }]);
    expect(out).toEqual(["o0", "o1", "S", "o2", "o3"]);
    expect(injectSponsored(["o0"], [])).toEqual(["o0"]);
  });

  it("uses a positive per-impression cost", () => {
    expect(SPONSORED_COST_PER_IMPRESSION_CENTS).toBeGreaterThan(0);
  });
});
