import { describe, expect, it } from "vitest";
import { parseItemIds, partialLabelItemError } from "../partialLabel";

const item = (id: string, over: Partial<{ refundedAt: Date; deliveredAt: Date; trackingNumber: string }> = {}) => ({
  id, refundedAt: null, deliveredAt: null, trackingNumber: null, ...over,
});

describe("parseItemIds", () => {
  it("treats a missing value as a whole-order label", () => {
    expect(parseItemIds(undefined)).toBeNull();
    expect(parseItemIds(null)).toBeNull();
  });
  it("de-duplicates and rejects malformed input", () => {
    expect(parseItemIds(["a", "a", "b"])).toEqual(["a", "b"]);
    expect(parseItemIds([])).toBe("invalid");
    expect(parseItemIds("a")).toBe("invalid");
    expect(parseItemIds([1])).toBe("invalid");
  });
});

describe("partialLabelItemError", () => {
  const items = [item("a"), item("b", { trackingNumber: "T1" }), item("c", { deliveredAt: new Date() }), item("d", { refundedAt: new Date() })];
  it("allows open, untracked items", () => {
    expect(partialLabelItemError(items, [], ["a"])).toBeNull();
  });
  it("rejects foreign, tracked, delivered, refunded and already-labelled items", () => {
    expect(partialLabelItemError(items, [], ["zzz"])).toMatch(/belong/);
    expect(partialLabelItemError(items, [], ["b"])).toMatch(/already has tracking/);
    expect(partialLabelItemError(items, [], ["c"])).toMatch(/refunded or delivered/);
    expect(partialLabelItemError(items, [], ["d"])).toMatch(/refunded or delivered/);
    expect(partialLabelItemError(items, ["a"], ["a"])).toMatch(/another label/);
  });
});
