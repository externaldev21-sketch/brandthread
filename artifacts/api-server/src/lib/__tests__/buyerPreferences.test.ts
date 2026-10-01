import { describe, expect, it } from "vitest";
import { applyPatch, buyerPreferencesPatchSchema, mergeSizes, toDto } from "../buyerPreferences";

const parse = (v: unknown) => buyerPreferencesPatchSchema.safeParse(v);

describe("buyerPreferencesPatchSchema", () => {
  it("accepts a partial patch and null clears", () => {
    expect(parse({ sizes: { tops: "M", shoes: null, measurements: { heightCm: 180 } } }).success).toBe(true);
    expect(parse({}).success).toBe(true);
  });
  it("rejects unknown keys, empty/long sizes, out-of-range measurements", () => {
    expect(parse({ admin: true }).success).toBe(false);
    expect(parse({ sizes: { hats: "M" } }).success).toBe(false);
    expect(parse({ sizes: { tops: "" } }).success).toBe(false);
    expect(parse({ sizes: { tops: "x".repeat(17) } }).success).toBe(false);
    expect(parse({ sizes: { measurements: { heightCm: 5 } } }).success).toBe(false);
    expect(parse({ sizes: { measurements: { weightKg: "80" } } }).success).toBe(false);
    expect(parse({ sizes: { measurements: { waistCm: NaN } } }).success).toBe(false);
  });
  it("enforces array limits", () => {
    expect(parse({ likedBrandIds: Array(201).fill("b") }).success).toBe(false);
    expect(parse({ styleInterests: ["x".repeat(41)] }).success).toBe(false);
    expect(parse({ styleInterests: Array(51).fill("a") }).success).toBe(false);
  });
});

describe("mergeSizes", () => {
  it("merges without touching omitted keys and clears on null", () => {
    const cur = { tops: "M", shoes: "10", measurements: { heightCm: 180, waistCm: 80 } };
    const next = mergeSizes(cur, { tops: "L", shoes: null, measurements: { waistCm: null, chestCm: 100 } });
    expect(next).toEqual({ tops: "L", measurements: { heightCm: 180, chestCm: 100 } });
    expect(cur.tops).toBe("M");
  });
  it("drops an empty measurements object", () => {
    expect(mergeSizes({ measurements: { heightCm: 170 } }, { measurements: { heightCm: null } })).toEqual({});
  });
});

describe("applyPatch / toDto", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  it("starts from defaults and dedupes arrays", () => {
    const v = applyPatch(null, { styleInterests: ["a", "a", "b"] }, now);
    expect(v).toMatchObject({ sizes: {}, likedBrandIds: [], styleInterests: ["a", "b"], surveyCompletedAt: null });
  });
  it("stamps survey completion once and can clear it", () => {
    const first = applyPatch(null, { surveyCompleted: true }, now);
    const later = applyPatch(first, { surveyCompleted: true }, new Date("2026-02-01"));
    expect(later.surveyCompletedAt).toEqual(now);
    expect(applyPatch(first, { surveyCompleted: false }, now).surveyCompletedAt).toBeNull();
  });
  it("toDto returns defaults for no row", () => {
    expect(toDto(null)).toEqual({ sizes: {}, likedBrandIds: [], styleInterests: [], surveyCompletedAt: null, updatedAt: null });
  });
});
