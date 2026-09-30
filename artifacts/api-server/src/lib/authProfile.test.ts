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

  it("lowercases emails so the case-insensitive unique index (migration 109) always sees consistent casing", () => {
    expect(getClerkEmailAddress({
      primaryEmailAddressId: "primary",
      emailAddresses: [{ id: "primary", emailAddress: "Ava.Reyes@Example.COM" }],
    })).toBe("ava.reyes@example.com");
    expect(preserveExistingEmail("New.Case@Example.com", "old@example.com"))
      .toBe("new.case@example.com");
    // A blank sync value still falls back to the existing stored value, untouched.
    expect(preserveExistingEmail("", "Already.Stored@example.com"))
      .toBe("Already.Stored@example.com");
  });

  it("treats a missing later Apple name as absent instead of blank profile data", () => {
    expect(normalizeProfileName("  Alex   Rivera ")).toBe("Alex Rivera");
    expect(normalizeProfileName("   ")).toBeUndefined();
    expect(normalizeProfileName(undefined)).toBeUndefined();
  });
});