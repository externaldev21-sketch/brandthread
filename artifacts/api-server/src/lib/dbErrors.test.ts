import { describe, expect, it } from "vitest";
import { isUniqueViolation, violatedConstraint } from "./dbErrors";

describe("isUniqueViolation", () => {
  it("recognizes a raw pg unique_violation error", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("recognizes a drizzle-wrapped unique_violation via .cause", () => {
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
  });

  it("returns false for any other error shape", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe("violatedConstraint", () => {
  it("reads the constraint name off a raw pg error", () => {
    expect(violatedConstraint({ constraint: "users_email_ci_unique" })).toBe("users_email_ci_unique");
  });

  it("reads the constraint name off a drizzle-wrapped error", () => {
    expect(violatedConstraint({ cause: { constraint: "users_username_ci_unique" } })).toBe("users_username_ci_unique");
  });

  it("returns undefined when there is no constraint name", () => {
    expect(violatedConstraint({})).toBeUndefined();
    expect(violatedConstraint(null)).toBeUndefined();
  });
});
