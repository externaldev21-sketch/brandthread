import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  addDays,
  briefWindow,
  localDateString,
  pickSuggestion,
  resolveTimeZone,
  zonedMidnightUtc,
} from "./morningBrief";

describe("resolveTimeZone", () => {
  it("keeps a valid IANA zone", () => {
    expect(resolveTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(resolveTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
  });

  it.each([undefined, "", "Not/AZone", "'; DROP TABLE orders; --", 42, ["UTC"], "x".repeat(80)])(
    "falls back to UTC for %j",
    (raw) => {
      expect(resolveTimeZone(raw)).toBe("UTC");
    },
  );
});

describe("seller-local day boundaries", () => {
  it("uses the seller's calendar day, not UTC's", () => {
    // 03:30 UTC on Oct 13 is still Oct 12 in Los Angeles and already Oct 13 in Tokyo.
    const at = new Date("2026-10-13T03:30:00Z");
    expect(localDateString(at, "America/Los_Angeles")).toBe("2026-10-12");
    expect(localDateString(at, "Asia/Tokyo")).toBe("2026-10-13");
    expect(localDateString(at, "UTC")).toBe("2026-10-13");
  });

  it("finds local midnight in UTC, including half-hour zones", () => {
    expect(zonedMidnightUtc("2026-10-13", "America/Los_Angeles").toISOString()).toBe("2026-10-13T07:00:00.000Z");
    expect(zonedMidnightUtc("2026-10-13", "Asia/Kolkata").toISOString()).toBe("2026-10-12T18:30:00.000Z");
    expect(zonedMidnightUtc("2026-10-13", "UTC").toISOString()).toBe("2026-10-13T00:00:00.000Z");
  });

  it("gives yesterday a 23-hour window on a spring-forward day and 25 on fall-back", () => {
    // US DST starts 2026-03-08 and ends 2026-11-01.
    const spring = briefWindow(new Date("2026-03-09T15:00:00Z"), "America/New_York");
    expect(spring.date).toBe("2026-03-09");
    expect(spring.yesterdayEnd.getTime() - spring.yesterdayStart.getTime()).toBe(23 * 3600_000);

    const fall = briefWindow(new Date("2026-11-02T15:00:00Z"), "America/New_York");
    expect(fall.yesterdayEnd.getTime() - fall.yesterdayStart.getTime()).toBe(25 * 3600_000);
  });

  it("rolls dates across month and year ends", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("pickSuggestion", () => {
  const now = new Date("2026-10-13T16:00:00Z");
  const soldOut = [{ productId: "p-out", name: "Wool Overcoat", unitsSold30d: 6 }];
  const lateOrders = [
    { orderId: "o-new", orderNumber: "BT-1002", paidAt: new Date(now.getTime() - 2.5 * DAY_MS) },
    { orderId: "o-old", orderNumber: "BT-1001", paidAt: new Date(now.getTime() - 3.2 * DAY_MS) },
  ];
  const lowStock = [
    { productId: "p-low", name: "Relaxed Denim", unitsSold30d: 9, stockLeft: 2, threshold: 0 },
  ];

  it("1. a sold-out product that still sells comes first", () => {
    expect(pickSuggestion({ now, soldOut, lateOrders, lowStock })).toEqual({
      kind: "restock",
      title: "Restock Wool Overcoat",
      detail: "Sold out. It sold 6 in the last 30 days.",
      target: { type: "product", id: "p-out" },
    });
  });

  it("skips a sold-out product with no recent sales", () => {
    const s = pickSuggestion({ now, soldOut: [{ ...soldOut[0], unitsSold30d: 0 }], lateOrders, lowStock });
    expect(s?.kind).toBe("ship");
  });

  it("2. then the oldest order waiting more than two days", () => {
    expect(pickSuggestion({ now, soldOut: [], lateOrders, lowStock })).toEqual({
      kind: "ship",
      title: "Ship BT-1001",
      detail: "3 days waiting.",
      target: { type: "order", id: "o-old" },
    });
  });

  it("an order exactly two days old is not late yet", () => {
    const s = pickSuggestion({
      now,
      soldOut: [],
      lateOrders: [{ orderId: "o", orderNumber: "BT-1", paidAt: new Date(now.getTime() - 2 * DAY_MS) }],
      lowStock: [],
    });
    expect(s).toBeNull();
  });

  it("3. then a best seller running low", () => {
    expect(pickSuggestion({ now, soldOut: [], lateOrders: [], lowStock })).toEqual({
      kind: "low_stock",
      title: "Relaxed Denim has 2 left",
      detail: "It sold 9 in the last 30 days.",
      target: { type: "product", id: "p-low" },
    });
  });

  it("low means at or below the threshold, or at most three left", () => {
    const at = (stockLeft: number, threshold: number) =>
      pickSuggestion({ now, soldOut: [], lateOrders: [], lowStock: [{ productId: "p", name: "Tee", unitsSold30d: 4, stockLeft, threshold }] });
    expect(at(8, 8)?.kind).toBe("low_stock");
    expect(at(9, 8)).toBeNull();
    expect(at(3, 1)?.kind).toBe("low_stock");
    expect(at(4, 1)).toBeNull();
    expect(at(0, 10)).toBeNull(); // sold out is rule 1, not "has 0 left"
  });

  it("4. otherwise no suggestion", () => {
    expect(pickSuggestion({ now, soldOut: [], lateOrders: [], lowStock: [] })).toBeNull();
  });

  it("rounds waiting days down", () => {
    const s = pickSuggestion({ now, soldOut: [], lateOrders: [{ orderId: "o", orderNumber: "BT-9", paidAt: new Date(now.getTime() - 2.1 * DAY_MS) }], lowStock: [] });
    expect(s?.detail).toBe("2 days waiting.");
  });
});
