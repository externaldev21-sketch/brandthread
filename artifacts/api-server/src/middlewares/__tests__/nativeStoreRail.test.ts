import { describe, expect, it, vi } from "vitest";
import { isNativeAppRequest, rejectNativeStripeCheckout } from "../nativeStoreRail";

function req(platform?: string) {
  return { get: (name: string) => (name.toLowerCase() === "x-brandthread-platform" ? platform : undefined) } as any;
}

function res() {
  const r: any = {};
  r.status = vi.fn(() => r);
  r.json = vi.fn(() => r);
  return r;
}

describe("native Stripe checkout guard (QA-0001/0003/0004)", () => {
  it("recognises the iOS and Android apps only", () => {
    expect(isNativeAppRequest(req("ios"))).toBe(true);
    expect(isNativeAppRequest(req("Android"))).toBe(true);
    expect(isNativeAppRequest(req("web"))).toBe(false);
    expect(isNativeAppRequest(req(undefined))).toBe(false);
  });

  it("refuses Stripe Checkout for native requests", () => {
    const r = res();
    const next = vi.fn();
    rejectNativeStripeCheckout(req("ios"), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(409);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ code: "store_purchase_required" }));
  });

  it("lets web through", () => {
    const r = res();
    const next = vi.fn();
    rejectNativeStripeCheckout(req(undefined), r, next);
    expect(next).toHaveBeenCalled();
    expect(r.status).not.toHaveBeenCalled();
  });
});
