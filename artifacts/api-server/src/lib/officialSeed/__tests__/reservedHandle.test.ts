import { describe, expect, it } from "vitest";
import { isPlatformImpersonationHandle, isReservedHandle, validateHandle } from "../../storeIdentity";

describe("@brandthread handle reservation", () => {
  it.each([
    "brandthread", "BrandThread", "brand_thread", "brand.thread", "brandthreadofficial",
    "official_brandthread", "brandthread_app", "br4ndthr3ad", "brandthread_agent", "the_brandthread",
  ])("reserves %s", (handle) => {
    expect(isPlatformImpersonationHandle(handle)).toBe(true);
    expect(isReservedHandle(handle)).toBe(true);
    expect(validateHandle(handle).problem?.code === "RESERVED" || validateHandle(handle).problem?.code === "INVALID").toBe(true);
  });

  it.each(["brandon", "threadhead", "brand_new_thread", "galoreyyz", "suavoworld"])("allows %s", (handle) => {
    expect(isPlatformImpersonationHandle(handle)).toBe(false);
  });
});
