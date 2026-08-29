import { describe, expect, it } from "vitest";
import { hasDeletionConfirmation } from "../lib/accountDeletion";

describe("account deletion confirmation", () => {
  it("accepts only the exact permanent-deletion confirmation", () => {
    expect(hasDeletionConfirmation({ confirmation: "DELETE" })).toBe(true);
    expect(hasDeletionConfirmation({ confirmation: "delete" })).toBe(false);
    expect(hasDeletionConfirmation({ confirmation: "DELETE " })).toBe(false);
    expect(hasDeletionConfirmation({})).toBe(false);
    expect(hasDeletionConfirmation(null)).toBe(false);
  });
});