import { describe, expect, it } from "vitest";
import { parcelInputError, suggestParcel } from "../parcelSuggestion";

describe("suggestParcel", () => {
  it("sums variant weights by quantity and converts to oz and lb", () => {
    const result = suggestParcel([
      { quantity: 2, weightGrams: 300 },
      { quantity: 1, weightGrams: 500 },
    ]);
    expect(result.weightGrams).toBe(1100);
    expect(result.weightOz).toBe(38.8);
    expect(result.weightLb).toBe(2.43);
    expect(result.weightKnown).toBe(true);
    expect(result.unweightedUnits).toBe(0);
  });

  it("flags units without a stored weight as a floor", () => {
    const result = suggestParcel([
      { quantity: 1, weightGrams: 400 },
      { quantity: 3, weightGrams: 0 },
      { quantity: 1, weightGrams: null },
    ]);
    expect(result.unweightedUnits).toBe(4);
    expect(result.weightKnown).toBe(false);
    expect(result.weightGrams).toBe(400);
  });

  it("reports unknown weight for an empty order", () => {
    expect(suggestParcel([])).toMatchObject({ weightGrams: 0, weightKnown: false });
  });
});

describe("parcelInputError", () => {
  it("accepts positive numbers", () => {
    expect(parcelInputError({ length: 10, width: 8, height: 4, weight: "1.5" })).toBeNull();
  });
  it("rejects missing, zero, negative and absurd values", () => {
    expect(parcelInputError({ length: 10, width: 8, height: 4 })).toMatch(/weight/);
    expect(parcelInputError({ length: 0, width: 8, height: 4, weight: 1 })).toMatch(/length/);
    expect(parcelInputError({ length: 1, width: -8, height: 4, weight: 1 })).toMatch(/width/);
    expect(parcelInputError({ length: 1, width: 8, height: 4, weight: 5000 })).toMatch(/weight/);
  });
});
