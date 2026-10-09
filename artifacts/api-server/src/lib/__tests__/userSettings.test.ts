import { describe, expect, it } from "vitest";
import {
  MAX_PATCH_BYTES, mergeUserSettings, parseUserSettingsPatch, sanitizeStored, storedSizeOk, toUserSettingsDto,
} from "../userSettings";

describe("parseUserSettingsPatch", () => {
  it("accepts known keys with the right types, and null to reset", () => {
    const r = parseUserSettingsPatch({
      dataSaver: true, theme: "dark", language: "Français", storyReplies: "off",
      pronouns: "they/them", gender: null, preferredFit: "slim",
      socialPrivacy: { whoCanSeePosts: "friends", searchable: false },
    });
    expect(r.ok).toBe(true);
    expect(parseUserSettingsPatch({}).ok).toBe(true);
  });
  it("rejects unknown keys and wrong value types", () => {
    expect(parseUserSettingsPatch({ isAdmin: true }).ok).toBe(false);
    expect(parseUserSettingsPatch({ dataSaver: "yes" }).ok).toBe(false);
    expect(parseUserSettingsPatch({ theme: "purple" }).ok).toBe(false);
    expect(parseUserSettingsPatch({ language: "" }).ok).toBe(false);
    expect(parseUserSettingsPatch({ pronouns: "x".repeat(41) }).ok).toBe(false);
    expect(parseUserSettingsPatch({ socialPrivacy: { whoCanMessageMe: "requests" } }).ok).toBe(false);
    // These have their own server homes (or are device-only): never accepted here.
    for (const key of ["sizeTops", "styleCategories", "dropAlerts", "biometricLock", "saveLoginInfo", "twoFactor"]) {
      expect(parseUserSettingsPatch({ [key]: true }).ok).toBe(false);
    }
  });
  it("rejects non-objects and oversized payloads", () => {
    expect(parseUserSettingsPatch(null).ok).toBe(false);
    expect(parseUserSettingsPatch([1]).ok).toBe(false);
    const big = parseUserSettingsPatch({ language: "a", pad: "x".repeat(MAX_PATCH_BYTES) });
    expect(big).toMatchObject({ ok: false, status: 413 });
  });
});

describe("mergeUserSettings", () => {
  it("replaces present keys, removes nulls, keeps the rest", () => {
    const next = mergeUserSettings(
      { dataSaver: true, theme: "dark", captions: false },
      { theme: "light", captions: null, reduceMotion: true },
    );
    expect(next).toEqual({ dataSaver: true, theme: "light", reduceMotion: true });
  });
  it("replaces the socialPrivacy object as a whole", () => {
    const next = mergeUserSettings(
      { socialPrivacy: { whoCanSeePosts: "friends", searchable: false } },
      { socialPrivacy: { searchable: true } },
    );
    expect(next.socialPrivacy).toEqual({ searchable: true });
  });
  it("drops stored keys the allowlist no longer knows", () => {
    expect(sanitizeStored({ legacyThing: 1, dataSaver: true, theme: "nope" })).toEqual({ dataSaver: true });
    expect(sanitizeStored("garbage")).toEqual({});
  });
  it("size check and dto", () => {
    expect(storedSizeOk({ dataSaver: true })).toBe(true);
    expect(toUserSettingsDto(null)).toEqual({ settings: {}, updatedAt: null });
    const at = new Date("2026-01-01T00:00:00Z");
    expect(toUserSettingsDto({ settings: { theme: "dark" }, updatedAt: at }))
      .toEqual({ settings: { theme: "dark" }, updatedAt: at.toISOString() });
  });
});
