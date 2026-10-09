import { describe, expect, it } from "vitest";
import {
  autoRefundEnabled, buildTimeline, computeDeliverBy, computePayoutReleaseAt, dueWarningLevel, formatDeadline,
  payoutBufferDays, payoutMode, undeliveredRefundCents, validatePreorderListing,
  computePreorderDeliverBy, maxPreorderShipDays, preorderGraceDays, preorderMaxDeliveryDays,
} from "../policy";

const DAY = 86_400_000;

describe("delivery deadlines", () => {
  it("gives a regular order 15 days and a pre-order 60 days from purchase", () => {
    const paid = new Date("2026-03-01T12:00:00Z");
    expect(computeDeliverBy(paid, false).toISOString()).toBe("2026-03-16T12:00:00.000Z");
    expect(computeDeliverBy(paid, true).toISOString()).toBe("2026-04-30T12:00:00.000Z");
  });

  it("is an absolute instant: a daylight-saving change cannot move it", () => {
    // US clocks jump forward on 2026-03-08; +15 × 24h is still exactly 15 × 24h.
    const paid = new Date("2026-03-01T05:00:00Z");
    expect(computeDeliverBy(paid, false).valueOf() - paid.valueOf()).toBe(15 * DAY);
  });
});

describe("hold-until-delivered config", () => {
  it("defaults to HOLD with a 3-day buffer, and only an explicit opt-out pays immediately", () => {
    expect(payoutMode({})).toBe("hold");
    expect(payoutMode({ PAYOUT_MODE: "garbage" })).toBe("hold");
    expect(payoutMode({ PAYOUT_MODE: "immediate" })).toBe("immediate");
    expect(payoutBufferDays({})).toBe(3);
    expect(payoutBufferDays({ PAYOUT_RELEASE_BUFFER_DAYS: "7" })).toBe(7);
    expect(payoutBufferDays({ PAYOUT_RELEASE_BUFFER_DAYS: "-1" })).toBe(3);
    expect(autoRefundEnabled({})).toBe(true);
    expect(autoRefundEnabled({ AUTO_REFUND_ENABLED: "false" })).toBe(false);
  });

  it("releases the seller delivery + buffer after the carrier scan", () => {
    const delivered = new Date("2026-03-05T10:00:00Z");
    expect(computePayoutReleaseAt(delivered, {}).toISOString()).toBe("2026-03-08T10:00:00.000Z");
    expect(computePayoutReleaseAt(delivered, { PAYOUT_RELEASE_BUFFER_DAYS: "0" }).toISOString()).toBe(delivered.toISOString());
  });
});

describe("seller warnings", () => {
  const deliverBy = new Date("2026-03-16T12:00:00Z");
  const at = (msBefore: number) => new Date(deliverBy.valueOf() - msBefore);
  it("fires at 5 days, 2 days and 12 hours, most urgent tier only", () => {
    expect(dueWarningLevel(deliverBy, at(6 * DAY))).toBe(0);
    expect(dueWarningLevel(deliverBy, at(5 * DAY))).toBe(1);
    expect(dueWarningLevel(deliverBy, at(3 * DAY))).toBe(1);
    expect(dueWarningLevel(deliverBy, at(2 * DAY))).toBe(2);
    expect(dueWarningLevel(deliverBy, at(13 * 3_600_000))).toBe(2);
    expect(dueWarningLevel(deliverBy, at(12 * 3_600_000))).toBe(3);
    expect(dueWarningLevel(deliverBy, new Date(deliverBy.valueOf() + 1))).toBe(0);
  });
});

describe("time zones", () => {
  it("shows the same instant as different calendar dates, without moving the deadline", () => {
    const deliverBy = new Date("2026-03-16T02:30:00Z");
    expect(formatDeadline(deliverBy, "America/Los_Angeles")).toBe("Mar 15");
    expect(formatDeadline(deliverBy, "Asia/Tokyo")).toBe("Mar 16");
    expect(formatDeadline(deliverBy, "Not/AZone")).toBe("Mar 16");
    expect(formatDeadline(deliverBy, null)).toBe("Mar 16");
  });
});

describe("buyer timeline", () => {
  const base = { orderedAt: new Date("2026-03-01T00:00:00Z") };
  const keys = (steps: ReturnType<typeof buildTimeline>) => steps.map((s) => `${s.key}:${s.state}`);
  it("walks Ordered → Preparing → Shipped → Out for delivery → Delivered", () => {
    expect(keys(buildTimeline({ ...base, status: "pending", trackingStatus: null }))[0]).toBe("ordered:current");
    expect(keys(buildTimeline({ ...base, status: "processing", trackingStatus: null }))).toEqual([
      "ordered:done", "preparing:current", "shipped:upcoming", "out_for_delivery:upcoming", "delivered:upcoming",
    ]);
    expect(keys(buildTimeline({ ...base, status: "shipped", trackingStatus: "in_transit" }))[2]).toBe("shipped:current");
    expect(keys(buildTimeline({ ...base, status: "shipped", trackingStatus: "out_for_delivery" }))[3]).toBe("out_for_delivery:current");
    expect(keys(buildTimeline({ ...base, status: "delivered", trackingStatus: "delivered", deliveredAt: new Date() }))[4]).toBe("delivered:done");
  });
});

describe("pre-order listing", () => {
  it("requires the promised ship date, and a future one when supplied", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    expect(validatePreorderListing({ effectiveIsPreorder: false, suppliedShipDate: undefined, effectiveShipDate: null, now })).toBeNull();
    expect(validatePreorderListing({ effectiveIsPreorder: true, suppliedShipDate: undefined, effectiveShipDate: null, now })?.code)
      .toBe("PREORDER_SHIP_DATE_REQUIRED");
    expect(validatePreorderListing({ effectiveIsPreorder: true, suppliedShipDate: "", effectiveShipDate: null, now })?.code)
      .toBe("PREORDER_SHIP_DATE_REQUIRED");
    expect(validatePreorderListing({ effectiveIsPreorder: true, suppliedShipDate: "nope", effectiveShipDate: null, now })?.code)
      .toBe("PREORDER_SHIP_DATE_INVALID");
    expect(validatePreorderListing({ effectiveIsPreorder: true, suppliedShipDate: "2025-01-01", effectiveShipDate: new Date("2025-01-01"), now })?.code)
      .toBe("PREORDER_SHIP_DATE_INVALID");
    expect(validatePreorderListing({ effectiveIsPreorder: true, suppliedShipDate: "2026-04-01", effectiveShipDate: new Date("2026-04-01"), now })).toBeNull();
    // An edit that leaves an existing date alone passes.
    expect(validatePreorderListing({ effectiveIsPreorder: true, suppliedShipDate: undefined, effectiveShipDate: new Date("2026-02-01"), now })).toBeNull();
  });
});

describe("partial-shipment refund amount", () => {
  const items = [
    { id: "a", priceCents: 3000, quantity: 1 },
    { id: "b", priceCents: 2000, quantity: 1 },
  ];
  it("spreads shipping/tax over the undelivered items by value", () => {
    expect(undeliveredRefundCents({
      chargedCents: 5500, alreadyRefundedCents: 0, allItems: items, undeliveredItemIds: ["b"], alreadyRefundedItemIds: [],
    })).toBe(2200);
  });
  it("refunds the whole remainder when every live item is undelivered", () => {
    expect(undeliveredRefundCents({
      chargedCents: 5500, alreadyRefundedCents: 0, allItems: items, undeliveredItemIds: ["a", "b"], alreadyRefundedItemIds: [],
    })).toBe(5500);
    // After b was refunded (2200), a is the only live item: it gets exactly what is left.
    expect(undeliveredRefundCents({
      chargedCents: 5500, alreadyRefundedCents: 2200, allItems: items, undeliveredItemIds: ["a"], alreadyRefundedItemIds: ["b"],
    })).toBe(3300);
  });
  it("never strands or invents a cent across uneven splits", () => {
    const three = [1, 2, 3].map((n) => ({ id: `i${n}`, priceCents: 333, quantity: 1 }));
    const first = undeliveredRefundCents({ chargedCents: 1000, alreadyRefundedCents: 0, allItems: three, undeliveredItemIds: ["i1"], alreadyRefundedItemIds: [] });
    const second = undeliveredRefundCents({ chargedCents: 1000, alreadyRefundedCents: first, allItems: three, undeliveredItemIds: ["i2"], alreadyRefundedItemIds: ["i1"] });
    const third = undeliveredRefundCents({ chargedCents: 1000, alreadyRefundedCents: first + second, allItems: three, undeliveredItemIds: ["i3"], alreadyRefundedItemIds: ["i1", "i2"] });
    expect(first + second + third).toBe(1000);
  });
  it("is zero when nothing is undelivered", () => {
    expect(undeliveredRefundCents({ chargedCents: 100, alreadyRefundedCents: 0, allItems: items, undeliveredItemIds: [], alreadyRefundedItemIds: [] })).toBe(0);
  });
});

describe("pre-order deadline", () => {
  const paid = new Date("2026-03-01T12:00:00Z");
  const day = (n: number) => new Date(paid.valueOf() + n * DAY);

  it("is the promised ship date + 15 days, capped at 180 days from purchase", () => {
    expect(computePreorderDeliverBy(paid, day(90)).toISOString()).toBe(day(105).toISOString());
    expect(computePreorderDeliverBy(paid, day(170)).toISOString()).toBe(day(180).toISOString());
  });

  it("counts a ship date already past from purchase, and falls back to 60 days without one", () => {
    expect(computePreorderDeliverBy(paid, day(-3)).toISOString()).toBe(day(15).toISOString());
    expect(computePreorderDeliverBy(paid, null).toISOString()).toBe(day(60).toISOString());
  });

  it("reads its config from env with safe bounds", () => {
    expect(preorderGraceDays({})).toBe(15);
    expect(preorderGraceDays({ PREORDER_DELIVERY_GRACE_DAYS: "21" })).toBe(21);
    expect(preorderGraceDays({ PREORDER_DELIVERY_GRACE_DAYS: "0" })).toBe(15);
    expect(preorderMaxDeliveryDays({})).toBe(180);
    expect(preorderMaxDeliveryDays({ PREORDER_MAX_DELIVERY_DAYS: "120" })).toBe(120);
    expect(preorderMaxDeliveryDays({ PREORDER_MAX_DELIVERY_DAYS: "400" })).toBe(180);
    expect(maxPreorderShipDays({})).toBe(165);
    expect(computePreorderDeliverBy(paid, day(100), { PREORDER_MAX_DELIVERY_DAYS: "90" }).toISOString()).toBe(day(90).toISOString());
  });
});
