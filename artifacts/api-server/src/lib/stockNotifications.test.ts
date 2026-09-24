import { describe, expect, it } from "vitest";
import { isRestock, shouldAlertLowStock } from "./stockNotifications";

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
