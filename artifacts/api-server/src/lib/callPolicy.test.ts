import { describe, expect, it } from "vitest";
import { canCall, CALL_POLICY_MESSAGES } from "./callPolicy";

const A = "user-a";
const B = "user-b";
const accepted = { isRequest: false, requestedBy: null };

describe("canCall — 1:1 DM call policy matrix", () => {
  it("a normal conversation can ring", () => {
    expect(canCall({ callerId: A, calleeId: B, blocked: false, conversation: accepted })).toEqual({ ok: true });
  });

  it("a muted chat still rings (mute is not a call rule)", () => {
    const mutedUntil = new Date(Date.now() + 8 * 60 * 60 * 1000);
    expect(canCall({ callerId: A, calleeId: B, blocked: false, conversation: accepted, calleeMutedUntil: mutedUntil }))
      .toEqual({ ok: true });
  });

  it("a block in either direction refuses with the same BLOCKED code", () => {
    // `blocked` is "either user blocked the other" — the caller can't tell which.
    const r = canCall({ callerId: A, calleeId: B, blocked: true, conversation: accepted });
    expect(r).toEqual({ ok: false, status: 403, code: "BLOCKED", error: CALL_POLICY_MESSAGES.BLOCKED });
    const reverse = canCall({ callerId: B, calleeId: A, blocked: true, conversation: accepted });
    expect(reverse).toMatchObject({ ok: false, code: "BLOCKED" });
  });

  it("block wins over a pending request", () => {
    expect(canCall({ callerId: A, calleeId: B, blocked: true, conversation: { isRequest: true, requestedBy: A } }))
      .toMatchObject({ code: "BLOCKED" });
  });

  it("the requester of an unaccepted message request cannot call", () => {
    expect(canCall({ callerId: A, calleeId: B, blocked: false, conversation: { isRequest: true, requestedBy: A } }))
      .toEqual({ ok: false, status: 403, code: "CALL_REQUEST_NOT_ACCEPTED", error: CALL_POLICY_MESSAGES.CALL_REQUEST_NOT_ACCEPTED });
  });

  it("the recipient can't call back until they accept (calling never accepts implicitly)", () => {
    expect(canCall({ callerId: B, calleeId: A, blocked: false, conversation: { isRequest: true, requestedBy: A } }))
      .toMatchObject({ ok: false, code: "CALL_REQUEST_PENDING" });
  });

  it("once the request is accepted both sides can call", () => {
    expect(canCall({ callerId: A, calleeId: B, blocked: false, conversation: accepted })).toEqual({ ok: true });
    expect(canCall({ callerId: B, calleeId: A, blocked: false, conversation: accepted })).toEqual({ ok: true });
  });

  it("a null is_request (legacy row) counts as accepted", () => {
    expect(canCall({ callerId: A, calleeId: B, blocked: false, conversation: { isRequest: null, requestedBy: null } }))
      .toEqual({ ok: true });
  });
});
