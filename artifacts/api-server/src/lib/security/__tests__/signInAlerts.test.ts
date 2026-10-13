import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, notificationsFeed: {}, signInEvents: {}, users: {} }));

import {
  alertContent, deviceKeyFor, deviceLabelFor, locationFor, recordSignIn, type SignInDeps,
} from "../signInAlerts";

function fakeDeps(sessions: Array<{ sessionId: string; deviceKey: string }>, alertsOn = true) {
  const notify = vi.fn<SignInDeps["notify"]>().mockResolvedValue(undefined);
  const deps: SignInDeps = {
    async record(row) {
      if (sessions.some((s) => s.sessionId === row.sessionId)) return false;
      sessions.push({ sessionId: row.sessionId, deviceKey: row.deviceKey });
      return true;
    },
    async history(_userId, sessionId, deviceKey) {
      const prior = sessions.filter((s) => s.sessionId !== sessionId);
      return { priorSessions: prior.length, seenDevice: prior.some((s) => s.deviceKey === deviceKey) };
    },
    alertsEnabled: async () => alertsOn,
    notify,
  };
  return { deps, notify };
}

const iphone = { deviceType: "iPhone", browserName: "Brandthread", isMobile: true, city: "Portland", country: "US" };
const mac = { deviceType: "Macintosh", browserName: "Chrome", isMobile: false, city: "Austin", country: "US" };

describe("recordSignIn", () => {
  it("never alerts on an account's first session", async () => {
    const { deps, notify } = fakeDeps([]);
    expect(await recordSignIn(deps, { userId: "u", sessionId: "s1", activity: iphone })).toBe("first_session");
    expect(notify).not.toHaveBeenCalled();
  });

  it("alerts once when a new kind of device signs in", async () => {
    const { deps, notify } = fakeDeps([{ sessionId: "s1", deviceKey: deviceKeyFor(iphone) }]);
    expect(await recordSignIn(deps, { userId: "u", sessionId: "s2", activity: mac })).toBe("alerted");
    expect(notify).toHaveBeenCalledWith("u", "s2", {
      title: "New login",
      body: "Someone signed in to your account on Chrome on Macintosh near Austin, US. If this wasn't you, sign that device out.",
    });
    // The app syncs on every launch: the same session never alerts twice.
    expect(await recordSignIn(deps, { userId: "u", sessionId: "s2", activity: mac })).toBe("already_recorded");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("doesn't alert when signing in again on a device kind already seen", async () => {
    const { deps, notify } = fakeDeps([{ sessionId: "s1", deviceKey: deviceKeyFor(iphone) }]);
    expect(await recordSignIn(deps, { userId: "u", sessionId: "s3", activity: { ...iphone, city: "Seattle" } })).toBe("known_device");
    expect(notify).not.toHaveBeenCalled();
  });

  it("respects login_alerts off", async () => {
    const { deps, notify } = fakeDeps([{ sessionId: "s1", deviceKey: deviceKeyFor(iphone) }], false);
    expect(await recordSignIn(deps, { userId: "u", sessionId: "s2", activity: mac })).toBe("alerts_off");
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("device description", () => {
  it("keys on mobile/desktop, device and browser, not location", () => {
    expect(deviceKeyFor(iphone)).toBe("mobile|iphone|brandthread");
    expect(deviceKeyFor({ ...iphone, city: "Seattle" })).toBe(deviceKeyFor(iphone));
    expect(deviceKeyFor(null)).toBe("desktop||");
  });

  it("reads like Instagram's login alert", () => {
    expect(deviceLabelFor(mac)).toBe("Chrome on Macintosh");
    expect(deviceLabelFor(iphone)).toBe("iPhone");
    expect(deviceLabelFor({ browserName: "Safari", isMobile: true })).toBe("Safari on a phone");
    expect(deviceLabelFor(null)).toBe("a computer");
    expect(locationFor(mac)).toBe("Austin, US");
    expect(locationFor({ country: "US" })).toBe("US");
    expect(locationFor({})).toBeNull();
    expect(alertContent("iPhone", null).body).toBe("Someone signed in to your account on iPhone. If this wasn't you, sign that device out.");
  });
});
