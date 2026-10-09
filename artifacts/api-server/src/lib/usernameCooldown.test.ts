import { describe, expect, it } from "vitest";
import { decideUsernameChange, usernameNextChangeAt, USERNAME_COOLDOWN_MS } from "./usernameCooldown";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-30T12:00:00Z");

describe("usernameNextChangeAt", () => {
  it("is null when never changed", () => {
    expect(usernameNextChangeAt(null, now)).toBeNull();
  });
  it("blocks at 29 days and allows at 30 days", () => {
    expect(usernameNextChangeAt(new Date(now.getTime() - 29 * DAY), now)).not.toBeNull();
    expect(usernameNextChangeAt(new Date(now.getTime() - 30 * DAY), now)).toBeNull();
    expect(usernameNextChangeAt(new Date(now.getTime() - 30 * DAY + 1000), now)).not.toBeNull();
  });
  it("reports exactly changedAt + 30 days", () => {
    const changed = new Date(now.getTime() - 5 * DAY);
    expect(usernameNextChangeAt(changed, now)?.getTime()).toBe(changed.getTime() + USERNAME_COOLDOWN_MS);
  });
  it("accepts ISO strings", () => {
    expect(usernameNextChangeAt(new Date(now.getTime() - DAY).toISOString(), now)).not.toBeNull();
  });
});

describe("decideUsernameChange", () => {
  it("first-ever set is free and starts the clock", () => {
    expect(decideUsernameChange({ current: null, requested: "maya", changedAt: null, now }))
      .toEqual({ kind: "allowed", stamp: true });
  });
  it("same handle is a no-op even inside the cooldown", () => {
    expect(decideUsernameChange({ current: "maya", requested: "maya", changedAt: new Date(now.getTime() - DAY), now }))
      .toEqual({ kind: "unchanged" });
  });
  it("a handle never changed through the profile can change once", () => {
    expect(decideUsernameChange({ current: "maya", requested: "maya2", changedAt: null, now }))
      .toEqual({ kind: "allowed", stamp: true });
  });
  it("blocks a change at 29 days with nextChangeAt", () => {
    const changedAt = new Date(now.getTime() - 29 * DAY);
    const decision = decideUsernameChange({ current: "maya", requested: "maya2", changedAt, now });
    expect(decision.kind).toBe("blocked");
    if (decision.kind === "blocked") {
      expect(decision.nextChangeAt.getTime()).toBe(changedAt.getTime() + 30 * DAY);
    }
  });
  it("allows a change at 30 days", () => {
    expect(decideUsernameChange({ current: "maya", requested: "maya2", changedAt: new Date(now.getTime() - 30 * DAY), now }))
      .toEqual({ kind: "allowed", stamp: true });
  });
  it("clearing is always allowed and stamps only when the clock is not running", () => {
    expect(decideUsernameChange({ current: "maya", requested: "", changedAt: null, now }))
      .toEqual({ kind: "allowed", stamp: true });
    expect(decideUsernameChange({ current: "maya", requested: "", changedAt: new Date(now.getTime() - DAY), now }))
      .toEqual({ kind: "allowed", stamp: false });
    expect(decideUsernameChange({ current: null, requested: "", changedAt: null, now }))
      .toEqual({ kind: "unchanged" });
  });
  it("re-setting after clearing cannot dodge the cooldown", () => {
    const clearedAt = new Date(now.getTime() - DAY);
    expect(decideUsernameChange({ current: null, requested: "maya", changedAt: clearedAt, now }).kind).toBe("blocked");
  });
});
