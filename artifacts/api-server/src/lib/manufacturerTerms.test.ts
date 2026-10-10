import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: async () => null } } }));
// Pure helpers only: no database in this file.
vi.mock("@workspace/db", () => new Proxy({}, { get: (_target, key) => (key === "then" ? undefined : {}) }));

import {
  MANUFACTURER_TERMS_VERSION,
  acceptedCurrentManufacturerTerms,
  filterManufacturerMessage,
  manufacturerTermsAcceptanceVersion,
  stripeAccountVerified,
  verificationGapLine,
} from "./manufacturerTrust";
import { OFF_PLATFORM_MASK } from "./contentModerator";

const termsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../mobile/content/legal/manufacturer-terms.md",
);

describe("Manufacturer Terms document", () => {
  const text = readFileSync(termsPath, "utf8");

  it("carries a Version header equal to MANUFACTURER_TERMS_VERSION", () => {
    expect(text).toMatch(new RegExp(`^Version: ${MANUFACTURER_TERMS_VERSION}$`, "m"));
  });

  it("states the fee, payout, off-platform ban and 12-month non-circumvention", () => {
    expect(text).toContain("platform fee of 5%");
    expect(text).toContain("0.8% capped at US$5");
    expect(text).toContain("no listing or subscription fee");
    expect(text).toContain("Stripe Connect");
    expect(text).toContain("Orders paid outside Brandthread aren't protected");
    expect(text).toContain("For 12 months after a seller is introduced to you through Brandthread");
  });

  it("namespaces the acceptance version and only accepts the current one", () => {
    expect(manufacturerTermsAcceptanceVersion()).toBe(`manufacturer-terms/${MANUFACTURER_TERMS_VERSION}`);
    expect(acceptedCurrentManufacturerTerms({ acceptedTermsVersion: MANUFACTURER_TERMS_VERSION })).toBe(true);
    expect(acceptedCurrentManufacturerTerms({ acceptedTermsVersion: "2020-01-01" })).toBe(false);
    expect(acceptedCurrentManufacturerTerms({ acceptedTermsVersion: true })).toBe(false);
    expect(acceptedCurrentManufacturerTerms(undefined)).toBe(false);
  });
});

describe("verification helpers", () => {
  it("requires payouts, receiving and nothing past due", () => {
    expect(stripeAccountVerified({ charges_enabled: true, payouts_enabled: true })).toBe(true);
    expect(stripeAccountVerified({ charges_enabled: true, payouts_enabled: false })).toBe(false);
    expect(stripeAccountVerified({ charges_enabled: true, payouts_enabled: true, requirements: { past_due: ["tos_acceptance.date"] } })).toBe(false);
    expect(stripeAccountVerified({ charges_enabled: true, payouts_enabled: true, requirements: { disabled_reason: "rejected.fraud" } })).toBe(false);
    expect(stripeAccountVerified({
      charges_enabled: false, payouts_enabled: true, capabilities: { transfers: "active" }, tos_acceptance: { service_agreement: "recipient" },
    })).toBe(true);
  });

  it("writes one plain line for what's missing", () => {
    expect(verificationGapLine([])).toBeNull();
    expect(verificationGapLine(["payouts"])).toBe("Finish payout setup.");
    expect(verificationGapLine(["email", "payouts"])).toBe("Verify your email and finish payout setup.");
  });
});

describe("filterManufacturerMessage", () => {
  it("masks and flags everything before the first paid order", () => {
    const result = filterManufacturerMessage("wechat: amy_88, pay me directly", false);
    expect(result.content).toBe(`${OFF_PLATFORM_MASK}, pay me directly`);
    expect(result.flagged).toBe(true);
    expect(result.contactFlags).toEqual(expect.arrayContaining(["messaging_id", "off_platform_payment"]));
  });

  it("after a paid order only flags payment steering, never masks", () => {
    expect(filterManufacturerMessage("wechat: amy_88", true)).toMatchObject({ content: "wechat: amy_88", flagged: false, contactFlags: null });
    expect(filterManufacturerMessage("wechat: amy_88, pay me directly", true)).toMatchObject({
      content: "wechat: amy_88, pay me directly", flagged: true, contactFlags: ["off_platform_payment"], masked: false,
    });
  });

  it("leaves clean messages untouched", () => {
    expect(filterManufacturerMessage("Sample approved, start bulk", false)).toEqual({ content: "Sample approved, start bulk", contactFlags: null, masked: false, flagged: false });
  });
});
