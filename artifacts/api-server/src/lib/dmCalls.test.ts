import { describe, expect, it } from "vitest";
import {
  RING_TIMEOUT_SECONDS,
  callDurationSec,
  channelNameForCall,
  isAcceptedCallAbandoned,
  isRingExpired,
  nextCallStatus,
  roleOf,
  serializeCall,
  transitionPatch,
  type DmCallRow,
} from "./dmCalls";

describe("nextCallStatus", () => {
  it("callee accepts or declines a ringing call; the caller can't", () => {
    expect(nextCallStatus("accept", "callee", "ringing")).toEqual({ kind: "transition", next: "accepted" });
    expect(nextCallStatus("decline", "callee", "ringing")).toEqual({ kind: "transition", next: "declined" });
    expect(nextCallStatus("accept", "caller", "ringing")).toEqual({ kind: "forbidden" });
    expect(nextCallStatus("decline", "caller", "ringing")).toEqual({ kind: "forbidden" });
  });

  it("end depends on who hangs up and when", () => {
    expect(nextCallStatus("end", "caller", "ringing")).toEqual({ kind: "transition", next: "cancelled" });
    expect(nextCallStatus("end", "callee", "ringing")).toEqual({ kind: "transition", next: "declined" });
    expect(nextCallStatus("end", "caller", "accepted")).toEqual({ kind: "transition", next: "ended" });
    expect(nextCallStatus("end", "callee", "accepted")).toEqual({ kind: "transition", next: "ended" });
  });

  it("repeating a terminal action is idempotent", () => {
    expect(nextCallStatus("accept", "callee", "accepted")).toEqual({ kind: "idempotent" });
    expect(nextCallStatus("decline", "callee", "declined")).toEqual({ kind: "idempotent" });
    for (const s of ["ended", "cancelled", "declined", "missed", "failed"]) {
      expect(nextCallStatus("end", "caller", s)).toEqual({ kind: "idempotent" });
    }
  });

  it("rejects every other transition", () => {
    expect(nextCallStatus("accept", "callee", "declined")).toEqual({ kind: "invalid" });
    expect(nextCallStatus("accept", "callee", "missed")).toEqual({ kind: "invalid" });
    expect(nextCallStatus("decline", "callee", "accepted")).toEqual({ kind: "invalid" });
    expect(nextCallStatus("decline", "callee", "cancelled")).toEqual({ kind: "invalid" });
  });

  it("timeout only turns ringing into missed", () => {
    expect(nextCallStatus("timeout", "caller", "ringing")).toEqual({ kind: "transition", next: "missed" });
    expect(nextCallStatus("timeout", "caller", "accepted")).toEqual({ kind: "idempotent" });
  });
});

const base: DmCallRow = {
  id: "11111111-2222-3333-4444-555555555555",
  conversationId: "conv",
  callerId: "a",
  calleeId: "b",
  mode: "video",
  status: "ringing",
  channelName: "dmcall_x",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  answeredAt: null,
  endedAt: null,
  endedBy: null,
  endReason: null,
};

describe("helpers", () => {
  it("channel name is unique per call", () => {
    expect(channelNameForCall(base.id)).toBe("dmcall_11111111222233334444555555555555");
  });

  it("detects ring timeout and abandoned calls", () => {
    const t0 = base.createdAt.getTime();
    expect(isRingExpired(base, t0 + (RING_TIMEOUT_SECONDS - 1) * 1000)).toBe(false);
    expect(isRingExpired(base, t0 + RING_TIMEOUT_SECONDS * 1000)).toBe(true);
    expect(isRingExpired({ ...base, status: "accepted" }, t0 + 3_600_000)).toBe(false);
    expect(isAcceptedCallAbandoned({ ...base, status: "accepted", answeredAt: base.createdAt }, t0 + 5 * 3_600_000)).toBe(true);
    expect(isAcceptedCallAbandoned({ ...base, status: "accepted", answeredAt: base.createdAt }, t0 + 60_000)).toBe(false);
  });

  it("roles, duration and patches", () => {
    expect(roleOf(base, "a")).toBe("caller");
    expect(roleOf(base, "b")).toBe("callee");
    expect(roleOf(base, "c")).toBeNull();
    expect(callDurationSec({ answeredAt: new Date(0), endedAt: new Date(61_400) })).toBe(61);
    expect(callDurationSec({ answeredAt: null, endedAt: new Date() })).toBeNull();
    const now = new Date();
    expect(transitionPatch("accepted", "b", now)).toEqual({ status: "accepted", answeredAt: now });
    expect(transitionPatch("ended", "a", now)).toEqual({ status: "ended", endedAt: now, endedBy: "a", endReason: "hangup" });
    expect(transitionPatch("missed", null, now)).toEqual({ status: "missed", endedAt: now, endedBy: null, endReason: "missed" });
  });

  it("serializes from each viewer's point of view", () => {
    const participants = [
      { userId: "a", name: "Ava Stone", initials: "AS", color: "#111" },
      { userId: "b", name: "Maison Vela", initials: "", color: "#222" },
    ];
    const avatars = new Map([["a", "https://img/a.png"]]);
    const forA = serializeCall(base, "a", participants, avatars);
    expect(forA).toMatchObject({
      direction: "outgoing",
      peer: { id: "b", name: "Maison Vela", initials: "MV", color: "#222", avatarUrl: null },
      createdAt: "2026-01-01T00:00:00.000Z",
      answeredAt: null,
      durationSec: null,
    });
    const forB = serializeCall(base, "b", participants, avatars);
    expect(forB).toMatchObject({ direction: "incoming", peer: { id: "a", avatarUrl: "https://img/a.png" } });
  });
});
