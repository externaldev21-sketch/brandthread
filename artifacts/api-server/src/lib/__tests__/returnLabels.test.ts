import { describe, expect, it } from "vitest";
import { isFirstScan, pickCheapestRate, rateCents, returnLabelIdFromMetadata } from "../returnLabels";

const rate = (id: string, amount: string) => ({ object_id: id, amount, currency: "USD", provider: "USPS" });

describe("pickCheapestRate", () => {
  it("chooses the lowest price and returns it in cents", () => {
    const best = pickCheapestRate([rate("a", "8.40"), rate("b", "5.9"), rate("c", "12")]);
    expect(best?.rate.object_id).toBe("b");
    expect(best?.priceCents).toBe(590);
  });
  it("skips unusable rates and returns null when none remain", () => {
    expect(pickCheapestRate([rate("a", "n/a"), rate("b", "0.00")])).toBeNull();
    expect(pickCheapestRate([])).toBeNull();
    expect(pickCheapestRate([rate("a", "n/a"), rate("b", "3.10")])?.rate.object_id).toBe("b");
  });
});

describe("rateCents", () => {
  it("parses decimal strings exactly", () => {
    expect(rateCents("0.07")).toBe(7);
    expect(rateCents("19")).toBe(1900);
    expect(() => rateCents("1.234")).toThrow();
  });
});

describe("scan helpers", () => {
  it("counts only physical carrier scans as the first scan", () => {
    expect(isFirstScan("accepted")).toBe(false);
    expect(isFirstScan("label_created")).toBe(false);
    expect(isFirstScan("in_transit")).toBe(true);
    expect(isFirstScan("delivered")).toBe(true);
  });
  it("reads the return label id from the transaction reference", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(returnLabelIdFromMetadata(`brandthread-return-label/${id}`)).toBe(id);
    expect(returnLabelIdFromMetadata(`brandthread-label/${id}`)).toBeNull();
    expect(returnLabelIdFromMetadata(undefined)).toBeNull();
  });
});
