import { describe, expect, it } from "vitest";
import { checkInviteAllowed, isOpenCohostStatus, transitionCohost, MAX_OPEN_COHOSTS } from "../liveCohost";

describe("transitionCohost", () => {
  it("follows the happy paths", () => {
    expect(transitionCohost("invited", "accept", "cohost")).toEqual({ ok: true, to: "accepted" });
    expect(transitionCohost("invited", "decline", "cohost")).toEqual({ ok: true, to: "declined" });
    expect(transitionCohost("invited", "cancel", "host")).toEqual({ ok: true, to: "cancelled" });
    expect(transitionCohost("accepted", "remove", "host")).toEqual({ ok: true, to: "removed" });
    expect(transitionCohost("accepted", "leave", "cohost")).toEqual({ ok: true, to: "left" });
  });
  it("rejects the wrong actor", () => {
    expect(transitionCohost("invited", "accept", "host")).toMatchObject({ ok: false, status: 403 });
    expect(transitionCohost("accepted", "remove", "cohost")).toMatchObject({ ok: false, status: 403 });
    expect(transitionCohost("accepted", "leave", "host")).toMatchObject({ ok: false, status: 403 });
  });
  it("rejects transitions from the wrong state, including terminal states", () => {
    expect(transitionCohost("accepted", "accept", "cohost")).toMatchObject({ ok: false, status: 409 });
    expect(transitionCohost("invited", "remove", "host")).toMatchObject({ ok: false, status: 409 });
    for (const s of ["declined", "cancelled", "removed", "left"] as const) {
      expect(transitionCohost(s, "accept", "cohost")).toMatchObject({ ok: false, status: 409 });
      expect(transitionCohost(s, "leave", "cohost")).toMatchObject({ ok: false, status: 409 });
    }
  });
  it("knows which statuses are open", () => {
    expect(isOpenCohostStatus("invited")).toBe(true);
    expect(isOpenCohostStatus("accepted")).toBe(true);
    expect(isOpenCohostStatus("left")).toBe(false);
  });
});

describe("checkInviteAllowed", () => {
  const ok = {
    hostId: "h", inviteeId: "i", streamStatus: "live", inviteeAccountType: "seller",
    inviteeSuspended: false, blocked: false, openCohostCount: 0, alreadyOpen: false,
  };
  it("allows a normal invite (seller or both)", () => {
    expect(checkInviteAllowed(ok)).toEqual({ ok: true });
    expect(checkInviteAllowed({ ...ok, inviteeAccountType: "both" })).toEqual({ ok: true });
  });
  it("rejects each bad case", () => {
    expect(checkInviteAllowed({ ...ok, streamStatus: "ended" })).toMatchObject({ ok: false, status: 410 });
    expect(checkInviteAllowed({ ...ok, inviteeId: "h" })).toMatchObject({ ok: false, status: 400 });
    expect(checkInviteAllowed({ ...ok, inviteeAccountType: "buyer" })).toMatchObject({ ok: false, status: 400 });
    expect(checkInviteAllowed({ ...ok, inviteeSuspended: true })).toMatchObject({ ok: false, status: 400 });
    expect(checkInviteAllowed({ ...ok, blocked: true })).toMatchObject({ ok: false, status: 400 });
    expect(checkInviteAllowed({ ...ok, alreadyOpen: true })).toMatchObject({ ok: false, status: 409 });
    expect(checkInviteAllowed({ ...ok, openCohostCount: MAX_OPEN_COHOSTS })).toMatchObject({ ok: false, status: 409 });
  });
});
