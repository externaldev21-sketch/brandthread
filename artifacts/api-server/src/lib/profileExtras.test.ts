import { describe, expect, it } from "vitest";
import {
  pronounsForStorage,
  pronounsSchema,
  publicPronouns,
  publicStyleBadge,
  styleBadgeForStorage,
  styleBadgeSchema,
} from "./profileExtras";

describe("pronouns (migration 271)", () => {
  it("accepts up to 30 chars and rejects longer", () => {
    expect(pronounsSchema.safeParse("they/them").success).toBe(true);
    expect(pronounsSchema.safeParse("x".repeat(30)).success).toBe(true);
    expect(pronounsSchema.safeParse("x".repeat(31)).success).toBe(false);
    expect(pronounsSchema.safeParse(42).success).toBe(false);
  });

  it("stores blank as null and trims", () => {
    expect(pronounsForStorage("   ")).toBeNull();
    expect(pronounsForStorage(" she/her ")).toBe("she/her");
  });

  it("public value is null for non-strings or blank", () => {
    expect(publicPronouns(null)).toBeNull();
    expect(publicPronouns(" ")).toBeNull();
    expect(publicPronouns("he/him")).toBe("he/him");
  });
});

describe("style badge (migration 271)", () => {
  it("validates label <= 24, emoji <= 8, enabled boolean, no extra keys", () => {
    expect(styleBadgeSchema.safeParse({ label: "Archive Fashion", emoji: "🎞️", enabled: true }).success).toBe(true);
    expect(styleBadgeSchema.safeParse(null).success).toBe(true);
    expect(styleBadgeSchema.safeParse({ label: "x".repeat(25), emoji: "", enabled: true }).success).toBe(false);
    expect(styleBadgeSchema.safeParse({ label: "ok", emoji: "x".repeat(9), enabled: true }).success).toBe(false);
    expect(styleBadgeSchema.safeParse({ label: "ok", emoji: "", enabled: "yes" }).success).toBe(false);
    expect(styleBadgeSchema.safeParse({ label: "ok", emoji: "", enabled: true, color: "#0f0" }).success).toBe(false);
  });

  it("stores a label-less badge as null", () => {
    expect(styleBadgeForStorage(null)).toBeNull();
    expect(styleBadgeForStorage({ label: "  ", emoji: "✨", enabled: true })).toBeNull();
    expect(styleBadgeForStorage({ label: " Y2K ", emoji: " ✨ ", enabled: false }))
      .toEqual({ label: "Y2K", emoji: "✨", enabled: false });
  });

  it("only exposes an enabled, labelled badge publicly", () => {
    expect(publicStyleBadge(null)).toBeNull();
    expect(publicStyleBadge("bad")).toBeNull();
    expect(publicStyleBadge({ label: "Y2K", emoji: "✨", enabled: false })).toBeNull();
    expect(publicStyleBadge({ label: "", emoji: "✨", enabled: true })).toBeNull();
    expect(publicStyleBadge({ label: "Y2K", emoji: "✨", enabled: true })).toEqual({ label: "Y2K", emoji: "✨" });
    expect(publicStyleBadge({ label: "Y2K", enabled: true })).toEqual({ label: "Y2K", emoji: "" });
  });
});
