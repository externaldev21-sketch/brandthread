import { describe, expect, it } from "vitest";
import {
  USER_APP_SETTINGS_DEFAULTS,
  maskReadReceipt,
  mergeUserAppSettings,
  patchInvalidatesForYou,
  resolveUserAppSettings,
  userAppSettingsPatchSchema,
} from "../userAppSettings";
import { describeDevice, shouldSendLoginAlert } from "../loginAlertRules";

describe("user app settings", () => {
  it("fills every default when nothing is stored", () => {
    expect(resolveUserAppSettings(null)).toEqual(USER_APP_SETTINGS_DEFAULTS);
    expect(resolveUserAppSettings("garbage")).toEqual(USER_APP_SETTINGS_DEFAULTS);
  });

  it("keeps valid stored keys and drops invalid or unknown ones", () => {
    const resolved = resolveUserAppSettings({ readReceipts: false, sensitiveContent: "huge", bogus: 1, groupAdds: "friends" });
    expect(resolved.readReceipts).toBe(false);
    expect(resolved.groupAdds).toBe("friends");
    expect(resolved.sensitiveContent).toBe("standard");
    expect(resolved).not.toHaveProperty("bogus");
  });

  it("rejects unknown keys and bad values in a patch", () => {
    expect(userAppSettingsPatchSchema.safeParse({ nope: true }).success).toBe(false);
    expect(userAppSettingsPatchSchema.safeParse({ readReceipts: "no" }).success).toBe(false);
    expect(userAppSettingsPatchSchema.safeParse({ appLanguage: "not a lang!" }).success).toBe(false);
    expect(userAppSettingsPatchSchema.safeParse({ appLanguage: "pt-BR", hideLikeCounts: true }).success).toBe(true);
  });

  it("merges a patch over stored settings without touching other keys", () => {
    const next = mergeUserAppSettings({ loginAlerts: false }, { hideLikeCounts: true });
    expect(next.loginAlerts).toBe(false);
    expect(next.hideLikeCounts).toBe(true);
    expect(next.readReceipts).toBe(true);
  });

  it("invalidates the For You cache only when personalization flips", () => {
    const base = resolveUserAppSettings(null);
    expect(patchInvalidatesForYou(base, { ...base, hideLikeCounts: true })).toBe(false);
    expect(patchInvalidatesForYou(base, { ...base, personalizedRecommendations: false })).toBe(true);
  });
});

describe("read receipt masking", () => {
  const mine = { fromId: "me", status: "read", readAt: "2026-10-01T00:00:00.000Z" };
  const theirs = { fromId: "them", status: "read", readAt: "2026-10-01T00:00:00.000Z" };

  it("hides that the other person read my message when they turned receipts off", () => {
    expect(maskReadReceipt(mine, "me", false)).toEqual({ fromId: "me", status: "delivered", readAt: undefined });
  });

  it("leaves my message alone when receipts are shared", () => {
    expect(maskReadReceipt(mine, "me", true)).toEqual(mine);
  });

  it("never changes messages the viewer received", () => {
    expect(maskReadReceipt(theirs, "me", false)).toEqual(theirs);
  });
});

describe("login alerts", () => {
  it("alerts only for a new session on an account with prior sessions and alerts on", () => {
    expect(shouldSendLoginAlert({ isNewSession: true, priorSessionCount: 1, loginAlertsEnabled: true })).toBe(true);
    expect(shouldSendLoginAlert({ isNewSession: true, priorSessionCount: 0, loginAlertsEnabled: true })).toBe(false);
    expect(shouldSendLoginAlert({ isNewSession: false, priorSessionCount: 3, loginAlertsEnabled: true })).toBe(false);
    expect(shouldSendLoginAlert({ isNewSession: true, priorSessionCount: 3, loginAlertsEnabled: false })).toBe(false);
  });

  it("labels common devices", () => {
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(describeDevice("Mozilla/5.0 (Linux; Android 15)")).toBe("Android device");
    expect(describeDevice(null)).toBe("Unknown device");
  });
});
