import { describe, expect, it } from "vitest";
import {
  getClerkEmailAddress,
  normalizeProfileName,
  preserveExistingEmail,
} from "./authProfile";

describe("Apple/private relay profile email handling", () => {
  it("prefers Clerk's primary address instead of array order", () => {
    expect(getClerkEmailAddress({
      primaryEmailAddressId: "primary",
      emailAddresses: [
        { id: "old", emailAddress: "old@example.com" },
        { id: "primary", emailAddress: "relay@privaterelay.appleid.com" },
      ],
    })).toBe("relay@privaterelay.appleid.com");
  });

  it("does not replace a usable stored email with a blank sync value", () => {
    expect(preserveExistingEmail("", "relay@privaterelay.appleid.com"))
      .toBe("relay@privaterelay.appleid.com");
    expect(preserveExistingEmail("new@example.com", "old@example.com"))
      .toBe("new@example.com");
  });

  it("treats a missing later Apple name as absent instead of blank profile data", () => {
    expect(normalizeProfileName("  Alex   Rivera ")).toBe("Alex Rivera");
    expect(normalizeProfileName("   ")).toBeUndefined();
    expect(normalizeProfileName(undefined)).toBeUndefined();
  });
});