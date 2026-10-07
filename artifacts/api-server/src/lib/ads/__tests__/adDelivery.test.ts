import { describe, expect, it } from "vitest";
import {
  AD_COST_PER_IMPRESSION_CENTS, adDestination, budgetExhausted, campaignToCandidate, ctaLabel, ctrPercent,
  fillDailySeries, flightDays, isAdSurface, pauseRefusal, resumeRefusal, stopRefusal,
  type AdCampaignForDelivery,
} from "../adDelivery";
import {
  SPONSORED_COST_PER_IMPRESSION_CENTS, SPONSORED_MAX_PER_VIEWER_PER_DAY, ineligibleReason, planSponsoredSlots,
  type SponsoredViewerContext,
} from "../../promotions/sponsored";

const NOW = new Date("2026-10-07T12:00:00Z");
const DAY = 86_400_000;

function campaign(over: Partial<AdCampaignForDelivery> = {}): AdCampaignForDelivery {
  return {
    id: "c1", sellerId: "seller-1", status: "active",
    paidAt: new Date(NOW.getTime() - DAY), startsAt: new Date(NOW.getTime() - DAY), endsAt: new Date(NOW.getTime() + DAY),
    budgetCents: 1_000, spentCents: 0, mediaObjectPaths: ["/objects/a.jpg"],
    headline: "Fall drop", description: "Heavyweight hoodies", ctaDestinationKind: "product", ctaDestinationId: "p1",
    sellerInGoodStanding: true, sellerOnVacation: false, productAvailable: true, productName: "Hoodie",
    ...over,
  };
}

function ctx(over: Partial<SponsoredViewerContext> = {}): SponsoredViewerContext {
  return {
    viewerId: "viewer-1", blockedUserIds: new Set(), mutedPhrases: [],
    sessionSeenBoostIds: new Set(), servedLast24h: new Map(), now: NOW, ...over,
  };
}

const reason = (c: AdCampaignForDelivery, v: Partial<SponsoredViewerContext> = {}) =>
  ineligibleReason(campaignToCandidate(c), ctx(v));

describe("ad campaign eligibility (shared Sponsored policy)", () => {
  it("bills from the single CPM constant", () => {
    expect(AD_COST_PER_IMPRESSION_CENTS).toBe(SPONSORED_COST_PER_IMPRESSION_CENTS);
    expect(AD_COST_PER_IMPRESSION_CENTS).toBe(2); // $20 CPM
  });

  it("serves a healthy paid, in-flight campaign", () => {
    expect(reason(campaign())).toBeNull();
  });

  it.each([
    ["not_active", { status: "paused" }],
    ["not_active", { status: "completed" }],
    ["not_active", { status: "pending_payment" }],
    ["not_paid", { paidAt: null }],
    ["outside_window", { startsAt: new Date(NOW.getTime() + 1000) }],
    ["outside_window", { endsAt: new Date(NOW.getTime() - 1) }],
    ["outside_window", { endsAt: null }],
    ["budget_exhausted", { spentCents: 999 }],
    ["post_unavailable", { mediaObjectPaths: [] }],
    ["post_unavailable", { sellerInGoodStanding: false }],
    ["post_unavailable", { productAvailable: false }],
    ["post_unavailable", { ctaDestinationId: null }],
    ["own_post", { sellerId: "viewer-1" }],
    ["vacation", { sellerOnVacation: true }],
  ] as const)("rejects with %s", (expected, over) => {
    expect(reason(campaign(over as Partial<AdCampaignForDelivery>))).toBe(expected);
  });

  it("ignores product availability for non-product CTAs", () => {
    expect(reason(campaign({ ctaDestinationKind: "store", ctaDestinationId: null, productAvailable: false }))).toBeNull();
  });

  it("excludes blocked sellers (either direction is resolved into blockedUserIds)", () => {
    expect(reason(campaign(), { blockedUserIds: new Set(["seller-1"]) })).toBe("blocked");
  });

  it("checks the viewer's muted words against headline, description and product name", () => {
    expect(reason(campaign(), { mutedPhrases: ["HOODIE"] })).toBe("muted");
    expect(reason(campaign(), { mutedPhrases: ["fall"] })).toBe("muted");
    expect(reason(campaign(), { mutedPhrases: ["denim"] })).toBeNull();
  });

  it("caps a campaign at 3 serves per viewer per rolling day and once per session", () => {
    expect(reason(campaign(), { servedLast24h: new Map([["c1", SPONSORED_MAX_PER_VIEWER_PER_DAY - 1]]) })).toBeNull();
    expect(reason(campaign(), { servedLast24h: new Map([["c1", SPONSORED_MAX_PER_VIEWER_PER_DAY]]) })).toBe("daily_cap");
    expect(reason(campaign(), { sessionSeenBoostIds: new Set(["c1"]) })).toBe("seen_this_session");
  });

  it("paces evenly over the flight with a small opening burst", () => {
    const fresh = campaign({ startsAt: NOW, endsAt: new Date(NOW.getTime() + 10 * DAY), budgetCents: 10_000 });
    // 10% burst = 1000 cents may deliver immediately …
    expect(reason({ ...fresh, spentCents: 998 })).toBeNull();
    // … but not more until time passes.
    expect(reason({ ...fresh, spentCents: 1_000 })).toBe("pacing");
    const halfway = { ...fresh, startsAt: new Date(NOW.getTime() - 5 * DAY), endsAt: new Date(NOW.getTime() + 5 * DAY) };
    expect(reason({ ...halfway, spentCents: 5_900 })).toBeNull();
    expect(reason({ ...halfway, spentCents: 6_000 })).toBe("pacing");
  });
});

describe("ad slot placement", () => {
  it("places one ad per 6 organic items, never first, one campaign/seller per page", () => {
    const candidates = [
      campaign({ id: "a", sellerId: "s-a" }),
      campaign({ id: "b", sellerId: "s-a" }),
      campaign({ id: "c", sellerId: "s-c" }),
    ].map(campaignToCandidate);
    const slots = planSponsoredSlots({ candidates, ctx: ctx(), organicOffset: 0, organicCount: 18 });
    expect(slots.map((s) => s.afterIndex)).toEqual([5, 11]);
    expect(new Set(slots.map((s) => s.candidate.sellerId)).size).toBe(slots.length);
    expect(planSponsoredSlots({ candidates, ctx: ctx(), organicOffset: 0, organicCount: 5 })).toEqual([]);
  });

  it("continues the 1-in-6 rhythm across pages", () => {
    const candidates = [campaignToCandidate(campaign())];
    expect(planSponsoredSlots({ candidates, ctx: ctx(), organicOffset: 4, organicCount: 6 }).map((s) => s.afterIndex)).toEqual([1]);
  });
});

describe("budget + lifecycle", () => {
  it("completes when the remaining budget can't buy another impression", () => {
    expect(budgetExhausted(998, 1_000)).toBe(false);
    expect(budgetExhausted(1_000, 1_000)).toBe(true);
    expect(budgetExhausted(4, 5)).toBe(true); // odd budgets: the last cent is unspendable
  });

  it("pause only from active", () => {
    expect(pauseRefusal({ status: "active" })).toBeNull();
    expect(pauseRefusal({ status: "paused" })).toBe("not_active");
    expect(pauseRefusal({ status: "completed" })).toBe("already_completed");
  });

  it("resume only while paused, with budget left and before endsAt", () => {
    const paused = { status: "paused", spentCents: 0, budgetCents: 500, endsAt: new Date(NOW.getTime() + DAY) };
    expect(resumeRefusal(paused, NOW)).toBeNull();
    expect(resumeRefusal({ ...paused, status: "active" }, NOW)).toBe("not_paused");
    expect(resumeRefusal({ ...paused, spentCents: 500 }, NOW)).toBe("budget_spent");
    expect(resumeRefusal({ ...paused, endsAt: new Date(NOW.getTime() - 1) }, NOW)).toBe("ended");
    expect(resumeRefusal({ ...paused, status: "completed" }, NOW)).toBe("already_completed");
  });

  it("stop from active or paused", () => {
    expect(stopRefusal({ status: "active" })).toBeNull();
    expect(stopRefusal({ status: "paused" })).toBeNull();
    expect(stopRefusal({ status: "draft" })).toBe("not_active");
    expect(stopRefusal({ status: "completed" })).toBe("already_completed");
  });
});

describe("destinations, labels and results shaping", () => {
  it("resolves the CTA destination", () => {
    expect(adDestination({ sellerId: "s", ctaDestinationKind: "product", ctaDestinationId: "p" }))
      .toEqual({ kind: "product", productId: "p", sellerId: "s" });
    expect(adDestination({ sellerId: "s", ctaDestinationKind: "store", ctaDestinationId: null })).toEqual({ kind: "store", sellerId: "s" });
    expect(adDestination({ sellerId: "s", ctaDestinationKind: "profile", ctaDestinationId: null })).toEqual({ kind: "profile", sellerId: "s" });
    expect(adDestination({ sellerId: "s", ctaDestinationKind: "contact", ctaDestinationId: null })).toEqual({ kind: "contact", sellerId: "s" });
    expect(adDestination({ sellerId: "s", ctaDestinationKind: "product", ctaDestinationId: null })).toEqual({ kind: "store", sellerId: "s" });
    expect(ctaLabel("shop_now")).toBe("Shop now");
    expect(ctaLabel(null)).toBe("Learn more");
  });

  it("validates surfaces", () => {
    expect(isAdSurface("following")).toBe(true);
    expect(isAdSurface("for_you")).toBe(true);
    expect(isAdSurface("discover")).toBe(true);
    expect(isAdSurface("home")).toBe(false);
  });

  it("computes CTR and fills the daily series", () => {
    expect(ctrPercent(1, 3)).toBe(33.33);
    expect(ctrPercent(5, 0)).toBe(0);
    const days = flightDays(new Date("2026-10-05T22:00:00Z"), new Date("2026-10-07T01:00:00Z"));
    expect(days).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(fillDailySeries(days, new Map([["2026-10-06", { impressions: 4, spendCents: 8 }]]), new Map([["2026-10-07", 1]])))
      .toEqual([
        { date: "2026-10-05", impressions: 0, clicks: 0, spendCents: 0 },
        { date: "2026-10-06", impressions: 4, clicks: 0, spendCents: 8 },
        { date: "2026-10-07", impressions: 0, clicks: 1, spendCents: 0 },
      ]);
  });
});
