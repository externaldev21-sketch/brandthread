import { describe, expect, it } from "vitest";
import { deriveSellerVerified } from "../sellerEligibility";

describe("deriveSellerVerified", () => {
  const eligible = {
    verified: true, verificationStatus: "verified", activeStanding: true, policyRestricted: false,
  };

  it("requires all server-owned eligibility criteria", () => {
    expect(deriveSellerVerified(eligible)).toBe(true);
    // Identity completion alone must never grant public verified status.
    expect(deriveSellerVerified({ ...eligible, verified: false })).toBe(false);
    expect(deriveSellerVerified({ ...eligible, activeStanding: false })).toBe(false);
    expect(deriveSellerVerified({ ...eligible, policyRestricted: true })).toBe(false);
    expect(deriveSellerVerified({ ...eligible, verificationStatus: "pending" })).toBe(false);
  });

  it("immediately revokes a previously eligible seller on standing changes", () => {
    expect(deriveSellerVerified(eligible)).toBe(true);
    expect(deriveSellerVerified({ ...eligible, activeStanding: false })).toBe(false);
    expect(deriveSellerVerified({ ...eligible, policyRestricted: true })).toBe(false);
  });
});