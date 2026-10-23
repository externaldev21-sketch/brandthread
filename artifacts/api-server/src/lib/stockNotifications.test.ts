import { describe, expect, it } from "vitest";
import {
  formatAlertPrice, isOutsideSavedAlertWindow, isPriceDrop, isRestock, savedAlertCopy, shouldAlertLowStock,
} from "./stockNotifications";

describe("shouldAlertLowStock", () => {
  it("alerts the first time stock crosses into the low-stock band", () => {
    expect(shouldAlertLowStock({ previousStock: 10, newStock: 3, lowStockThreshold: 5 })).toBe(true);
  });

  it("alerts the first time stock hits zero", () => {
    expect(shouldAlertLowStock({ previousStock: 3, newStock: 0, lowStockThreshold: 5 })).toBe(true);
  });

  it("does not re-alert on a further sale while already low", () => {
    expect(shouldAlertLowStock({ previousStock: 3, newStock: 2, lowStockThreshold: 5 })).toBe(false);
  });

  it("alerts on hitting zero even when a low-stock alert already fired for this decline", () => {
    expect(shouldAlertLowStock({ previousStock: 1, newStock: 0, lowStockThreshold: 5 })).toBe(true);
  });

  it("does not re-alert on a further sale while already out of stock", () => {
    expect(shouldAlertLowStock({ previousStock: 0, newStock: 0, lowStockThreshold: 5 })).toBe(false);
  });

  it("does not alert when stock stays comfortably above the threshold", () => {
    expect(shouldAlertLowStock({ previousStock: 50, newStock: 40, lowStockThreshold: 5 })).toBe(false);
  });

  it("does not alert when stock is unchanged", () => {
    expect(shouldAlertLowStock({ previousStock: 2, newStock: 2, lowStockThreshold: 5 })).toBe(false);
  });

  it("does not alert on a restock that lands above the threshold", () => {
    expect(shouldAlertLowStock({ previousStock: 0, newStock: 100, lowStockThreshold: 5 })).toBe(false);
  });
});

describe("isRestock", () => {
  it("is true only for a 0 -> positive transition", () => {
    expect(isRestock({ previousStock: 0, newStock: 5 })).toBe(true);
    expect(isRestock({ previousStock: 0, newStock: 0 })).toBe(false);
    expect(isRestock({ previousStock: 5, newStock: 0 })).toBe(false);
    expect(isRestock({ previousStock: 2, newStock: 5 })).toBe(false);
  });
});

describe("isPriceDrop", () => {
  it("is true only when the price falls to a positive amount", () => {
    expect(isPriceDrop({ previousPriceCents: 5000, newPriceCents: 4000 })).toBe(true);
    expect(isPriceDrop({ previousPriceCents: 5000, newPriceCents: 5000 })).toBe(false);
    expect(isPriceDrop({ previousPriceCents: 4000, newPriceCents: 5000 })).toBe(false);
    expect(isPriceDrop({ previousPriceCents: 5000, newPriceCents: 0 })).toBe(false);
    expect(isPriceDrop({ previousPriceCents: Number.NaN, newPriceCents: 4000 })).toBe(false);
  });
});

describe("isOutsideSavedAlertWindow", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000);

  it("allows the first alert", () => {
    expect(isOutsideSavedAlertWindow(null, now)).toBe(true);
  });

  it("blocks a second alert inside 48 hours and allows one after", () => {
    expect(isOutsideSavedAlertWindow(hoursAgo(1), now)).toBe(false);
    expect(isOutsideSavedAlertWindow(hoursAgo(47.9), now)).toBe(false);
    expect(isOutsideSavedAlertWindow(hoursAgo(48), now)).toBe(true);
    expect(isOutsideSavedAlertWindow(hoursAgo(72), now)).toBe(true);
  });
});

describe("savedAlertCopy", () => {
  it("formats the restock and price drop alerts", () => {
    expect(savedAlertCopy({ kind: "restock", productName: "Linen Shirt" }).title).toBe("Back in stock: Linen Shirt");
    expect(savedAlertCopy({ kind: "price_drop", productName: "Linen Shirt", priceCents: 4250 }).title)
      .toBe("Price drop: Linen Shirt now $42.50");
    expect(formatAlertPrice(4000)).toBe("$40.00");
  });

  it("uses plain copy with no emoji or exclamation marks", () => {
    const all = [
      savedAlertCopy({ kind: "restock", productName: "Tee" }),
      savedAlertCopy({ kind: "price_drop", productName: "Tee", priceCents: 1000 }),
    ].flatMap((c) => [c.title, c.body]).join(" ");
    expect(all).not.toMatch(/[!\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
