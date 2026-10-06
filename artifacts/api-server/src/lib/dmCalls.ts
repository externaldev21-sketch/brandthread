/**
 * 1:1 DM calls — pure state machine + serialization (no I/O).
 *
 * Status machine (see routes/call.ts, /api/call/dm/calls…):
 *   ringing  → accepted  (callee accepts)
 *   ringing  → declined  (callee declines, or callee ends while ringing)
 *   ringing  → cancelled (caller ends while ringing)
 *   ringing  → missed    (no answer within RING_TIMEOUT_SECONDS)
 *   accepted → ended     (either side ends)
 * Anything else is an invalid transition (409 INVALID_CALL_STATE), except
 * repeating the same terminal action, which is an idempotent no-op.
 */

export const RING_TIMEOUT_SECONDS = 45;
/**
 * Safety net for an accepted call whose clients both vanished without
 * calling /end (app killed, phone died): after this long it no longer counts
 * as "live", so neither side is stuck as permanently busy.
 */
export const MAX_ACCEPTED_CALL_SECONDS = 4 * 60 * 60;

export const DM_CALL_MODES = ["voice", "video"] as const;
export type DmCallMode = (typeof DM_CALL_MODES)[number];

export const DM_CALL_STATUSES = [
  "ringing", "accepted", "declined", "missed", "cancelled", "ended", "failed",
] as const;
export type DmCallStatus = (typeof DM_CALL_STATUSES)[number];

export const LIVE_CALL_STATUSES: DmCallStatus[] = ["ringing", "accepted"];
export const TERMINAL_CALL_STATUSES: DmCallStatus[] = ["declined", "missed", "cancelled", "ended", "failed"];

export type DmCallAction = "accept" | "decline" | "end" | "timeout";
export type DmCallRole = "caller" | "callee";

export type DmCallTransition =
  | { kind: "transition"; next: DmCallStatus }
  | { kind: "idempotent" }
  | { kind: "forbidden" }
  | { kind: "invalid" };

export function isTerminalCallStatus(status: string): boolean {
  return (TERMINAL_CALL_STATUSES as string[]).includes(status);
}

export function isDmCallMode(value: unknown): value is DmCallMode {
  return value === "voice" || value === "video";
}

/** Decide what `action` by `role` does to a call currently in `status`. */
export function nextCallStatus(action: DmCallAction, role: DmCallRole, status: string): DmCallTransition {
  switch (action) {
    case "accept":
      if (role !== "callee") return { kind: "forbidden" };
      if (status === "ringing") return { kind: "transition", next: "accepted" };
      if (status === "accepted") return { kind: "idempotent" };
      return { kind: "invalid" };
    case "decline":
      if (role !== "callee") return { kind: "forbidden" };
      if (status === "ringing") return { kind: "transition", next: "declined" };
      if (status === "declined") return { kind: "idempotent" };
      return { kind: "invalid" };
    case "end":
      if (status === "ringing") return { kind: "transition", next: role === "caller" ? "cancelled" : "declined" };
      if (status === "accepted") return { kind: "transition", next: "ended" };
      // Hanging up a call that already finished (the other side declined /
      // it timed out a moment earlier / a retried request) is a no-op.
      if (isTerminalCallStatus(status)) return { kind: "idempotent" };
      return { kind: "invalid" };
    case "timeout":
      if (status === "ringing") return { kind: "transition", next: "missed" };
      return { kind: "idempotent" };
    default:
      return { kind: "invalid" };
  }
}

export type DmCallRow = {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  mode: string;
  status: string;
  channelName: string;
  createdAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  endedBy: string | null;
  endReason: string | null;
};

export function roleOf(call: Pick<DmCallRow, "callerId" | "calleeId">, userId: string): DmCallRole | null {
  if (call.callerId === userId) return "caller";
  if (call.calleeId === userId) return "callee";
  return null;
}

export function channelNameForCall(callId: string): string {
  return `dmcall_${callId.replaceAll("-", "")}`;
}

/** A ringing call nobody answered within RING_TIMEOUT_SECONDS. */
export function isRingExpired(call: Pick<DmCallRow, "status" | "createdAt">, now = Date.now()): boolean {
  return call.status === "ringing"
    && now - new Date(call.createdAt).getTime() >= RING_TIMEOUT_SECONDS * 1000;
}

/** An accepted call that has been "live" implausibly long (abandoned by both clients). */
export function isAcceptedCallAbandoned(
  call: Pick<DmCallRow, "status" | "answeredAt" | "createdAt">,
  now = Date.now(),
): boolean {
  if (call.status !== "accepted") return false;
  const since = new Date(call.answeredAt ?? call.createdAt).getTime();
  return now - since >= MAX_ACCEPTED_CALL_SECONDS * 1000;
}

export type DmCallPeerSource = { userId: string; name: string; initials: string; color: string };

export type DmCallPeer = {
  id: string;
  name: string;
  initials: string;
  color: string;
  avatarUrl: string | null;
};

export type DmCallJson = {
  id: string;
  conversationId: string;
  mode: DmCallMode;
  status: DmCallStatus;
  direction: "outgoing" | "incoming";
  callerId: string;
  calleeId: string;
  peer: DmCallPeer;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  endReason: string | null;
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}

export function callDurationSec(call: Pick<DmCallRow, "answeredAt" | "endedAt">): number | null {
  if (!call.answeredAt || !call.endedAt) return null;
  const ms = new Date(call.endedAt).getTime() - new Date(call.answeredAt).getTime();
  return Math.max(0, Math.round(ms / 1000));
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

/** Serialize a call from `viewerId`'s point of view (direction + peer). */
export function serializeCall(
  call: DmCallRow,
  viewerId: string,
  participants: DmCallPeerSource[],
  avatars: Map<string, string | null> = new Map(),
): DmCallJson {
  const outgoing = call.callerId === viewerId;
  const peerId = outgoing ? call.calleeId : call.callerId;
  const p = participants.find((x) => x.userId === peerId);
  const name = p?.name?.trim() || "Someone";
  return {
    id: call.id,
    conversationId: call.conversationId,
    mode: call.mode as DmCallMode,
    status: call.status as DmCallStatus,
    direction: outgoing ? "outgoing" : "incoming",
    callerId: call.callerId,
    calleeId: call.calleeId,
    peer: {
      id: peerId,
      name,
      initials: p?.initials?.trim() || initialsFrom(name),
      color: p?.color || "#8B5CF6",
      avatarUrl: avatars.get(peerId) ?? null,
    },
    createdAt: iso(call.createdAt)!,
    answeredAt: iso(call.answeredAt),
    endedAt: iso(call.endedAt),
    durationSec: callDurationSec(call),
    endReason: call.endReason ?? null,
  };
}

/** Column values written when a call moves into `next`. */
export function transitionPatch(
  next: DmCallStatus,
  actorId: string | null,
  now = new Date(),
): Partial<Pick<DmCallRow, "status" | "answeredAt" | "endedAt" | "endedBy" | "endReason">> {
  if (next === "accepted") return { status: next, answeredAt: now };
  const endReason = next === "ended" ? "hangup" : next;
  return { status: next, endedAt: now, endedBy: actorId, endReason };
}
