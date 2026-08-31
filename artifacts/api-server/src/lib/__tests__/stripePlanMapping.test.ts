import { describe, expect, it } from "vitest";
import { sellerPlanFromStripeLookupKey } from "../stripePlanMapping";

describe("sellerPlanFromStripeLookupKey", () => {
  it("keeps the historical $79 Pro lookup key on Growth", () => {
    expect(sellerPlanFromStripeLookupKey("brandthread_pro_monthly")).toBe("growth");
  });

  it("maps the non-conflicting $199 Pro lookup key to the highest tier", () => {
    expect(sellerPlanFromStripeLookupKey("brandthread_pro_199_monthly")).toBe("pro");
  });

  it("keeps former Scale subscribers on the renamed Pro tier", () => {
    expect(sellerPlanFromStripeLookupKey("brandthread_scale_monthly")).toBe("pro");
  });

  it("does not overwrite access for unknown or missing lookup keys", () => {
    expect(sellerPlanFromStripeLookupKey("unknown")).toBeUndefined();
    expect(sellerPlanFromStripeLookupKey(undefined)).toBeUndefined();
  });
});