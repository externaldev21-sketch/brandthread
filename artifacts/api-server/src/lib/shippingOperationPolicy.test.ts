import { describe, expect, it } from "vitest";
import { isPendingProviderPurchase, mayReclaimVoid, mayResumePurchase } from "./shippingOperationPolicy";

describe("shipping operation recovery", () => {
  it("resumes a persisted purchase even while the order is internally locked", () => {
    expect(mayResumePurchase("label_purchasing", "purchasing")).toBe(true);
    expect(mayResumePurchase("label_purchasing")).toBe(false);
  });

  it("allows only stale void operations to be reclaimed", () => {
    const now = Date.UTC(2026, 7, 31);
    expect(mayReclaimVoid("void_pending", new Date(now - 30_000), now)).toBe(true);
    expect(mayReclaimVoid("void_pending", new Date(now - 29_999), now)).toBe(false);
    expect(mayReclaimVoid("active", new Date(now - 60_000), now)).toBe(false);
  });

  it("distinguishes async provider states from terminal failures", () => {
    expect(isPendingProviderPurchase("QUEUED")).toBe(true);
    expect(isPendingProviderPurchase("WAITING")).toBe(true);
    expect(isPendingProviderPurchase("ERROR")).toBe(false);
    expect(isPendingProviderPurchase("INVALID")).toBe(false);
  });
});