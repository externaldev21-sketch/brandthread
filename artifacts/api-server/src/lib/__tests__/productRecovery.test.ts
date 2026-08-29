import { describe, expect, it } from "vitest";
import { canRestoreProduct, PRODUCT_DELETE_RECOVERY_WINDOW_MS } from "../productRecovery";

describe("product deletion recovery policy", () => {
  const now = new Date("2030-01-01T00:00:00.000Z");

  it("uses a short, exported recovery window", () => {
    expect(PRODUCT_DELETE_RECOVERY_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it("allows restore only before a deletion deadline", () => {
    expect(canRestoreProduct({ deletedAt: now, recoverableUntil: new Date(now.getTime() + 1), removalKind: "seller_deleted" }, now)).toBe(true);
    expect(canRestoreProduct({ deletedAt: now, recoverableUntil: now, removalKind: "seller_deleted" }, now)).toBe(false);
    expect(canRestoreProduct({ deletedAt: now, recoverableUntil: new Date(now.getTime() - 1), removalKind: "seller_deleted" }, now)).toBe(false);
  });

  it("does not make undeleted or permanently removed products recoverable", () => {
    expect(canRestoreProduct({ deletedAt: null, recoverableUntil: new Date(now.getTime() + 1), removalKind: "seller_deleted" }, now)).toBe(false);
    expect(canRestoreProduct({ deletedAt: now, recoverableUntil: null, removalKind: "seller_deleted" }, now)).toBe(false);
    expect(canRestoreProduct({ deletedAt: now, recoverableUntil: new Date(now.getTime() + 1), removalKind: "moderation_removed" }, now)).toBe(false);
  });
});