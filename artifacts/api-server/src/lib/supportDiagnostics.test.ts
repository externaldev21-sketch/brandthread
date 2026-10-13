import { describe, expect, it } from "vitest";
import { sanitizeSupportDiagnostics } from "./supportDiagnostics";

describe("sanitizeSupportDiagnostics", () => {
  it("keeps the known device/app keys", () => {
    expect(
      sanitizeSupportDiagnostics({
        appVersion: "1.0.0",
        buildNumber: 42,
        platform: "ios",
        osVersion: "18.1",
        deviceModel: "iPhone16,1",
        updateId: "abc",
        updateChannel: "production",
        locale: "en-US",
        orderId: "ord_1",
      }),
    ).toEqual({
      appVersion: "1.0.0",
      buildNumber: "42",
      platform: "ios",
      osVersion: "18.1",
      deviceModel: "iPhone16,1",
      updateId: "abc",
      updateChannel: "production",
      locale: "en-US",
      orderId: "ord_1",
    });
  });

  it("drops unknown keys, non-scalar values and blanks", () => {
    expect(
      sanitizeSupportDiagnostics({
        appVersion: "  1.2.3 ",
        platform: { nested: true },
        osVersion: "   ",
        token: "secret",
        clerkId: "user_1",
      }),
    ).toEqual({ appVersion: "1.2.3" });
  });

  it("caps each value at 120 characters", () => {
    const out = sanitizeSupportDiagnostics({ deviceModel: "x".repeat(500) });
    expect(out?.deviceModel).toHaveLength(120);
  });

  it("returns null for missing, empty or malformed input", () => {
    expect(sanitizeSupportDiagnostics(undefined)).toBeNull();
    expect(sanitizeSupportDiagnostics(null)).toBeNull();
    expect(sanitizeSupportDiagnostics("ios")).toBeNull();
    expect(sanitizeSupportDiagnostics(["ios"])).toBeNull();
    expect(sanitizeSupportDiagnostics({ token: "x" })).toBeNull();
  });
});
