/**
 * Real 1:1 DM calls — the server's call record (POST/GET /api/call/dm/…,
 * artifacts/api-server/src/routes/call.ts) mapped onto the call UI's
 * CallSession / CallLogEntry shapes. Pure: no React, no network — unit-tested.
 *
 * The server is the source of truth for call state (ringing → accepted →
 * ended, declined, missed, cancelled), so both participants always agree on
 * what happened; media (Agora) only decides when the two sides are actually
 * connected.
 */
import type { CallEndReason, CallLogEntry, CallMode, CallPeer, CallSession } from './types';

export type DmCallStatus = 'ringing' | 'accepted' | 'declined' | 'missed' | 'cancelled' | 'ended' | 'failed';

export interface DmCallDto {
  id: string;
  conversationId: string;
  mode: CallMode;
  status: DmCallStatus;
  /** Relative to the requesting user. */
  direction: 'outgoing' | 'incoming';
  callerId: string;
  calleeId: string;
  peer: { id: string; name: string; initials: string; color: string; avatarUrl: string | null };
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  endReason: string | null;
}

export interface DmCallRtcDto {
  appId: string;
  token: string;
  channelName: string;
  uid: number;
  expiresAt: string;
}

export function isTerminalStatus(status: DmCallStatus): boolean {
  return status !== 'ringing' && status !== 'accepted';
}

export function endReasonForStatus(status: DmCallStatus): CallEndReason {
  switch (status) {
    case 'declined': return 'declined';
    case 'missed': return 'missed';
    case 'cancelled': return 'cancelled';
    case 'failed': return 'failed';
    default: return 'hangup';
  }
}

function ms(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

export function peerFromDto(call: DmCallDto): CallPeer {
  return {
    id: call.peer.id,
    name: call.peer.name || 'Someone',
    initials: call.peer.initials || (call.peer.name?.[0] ?? '?').toUpperCase(),
    color: call.peer.color || '#3A3A3C',
    avatarUri: call.peer.avatarUrl ?? null,
  };
}

/**
 * The part of a CallSession the server decides. Accepted reads "connected"
 * on both sides (timer from the server's answeredAt, so the two clocks
 * match); media attaches a moment later and the views show avatars until
 * the first video frame.
 */
export function sessionPatchFromDto(call: DmCallDto): Partial<CallSession> {
  if (isTerminalStatus(call.status)) {
    return {
      status: 'ended',
      endedAt: ms(call.endedAt) ?? Date.now(),
      endReason: endReasonForStatus(call.status),
      ...(call.answeredAt ? { connectedAt: ms(call.answeredAt) } : {}),
    };
  }
  if (call.status === 'accepted') {
    return { status: 'connected', connectedAt: ms(call.answeredAt) ?? Date.now() };
  }
  return { status: call.direction === 'incoming' ? 'incoming' : 'outgoing' };
}

/** Server call row → the call-log bubble both participants see in the thread. */
export function logEntryFromDto(call: DmCallDto): CallLogEntry | null {
  if (!isTerminalStatus(call.status)) return null;
  const startedAt = ms(call.answeredAt) ?? ms(call.createdAt) ?? Date.now();
  return {
    id: call.id,
    conversationId: call.conversationId,
    mode: call.mode,
    direction: call.direction,
    startedAt,
    durationSec: call.durationSec ?? undefined,
    reason: endReasonForStatus(call.status),
    missed: call.direction === 'incoming' && (call.status === 'missed' || call.status === 'cancelled'),
  };
}

/** Human message for a call that couldn't be placed, from the API error code. */
export function startFailureMessage(code: string | undefined, fallback?: string): string {
  switch (code) {
    case 'CALLING_NOT_CONFIGURED': return 'Calling isn’t available right now. Try again later.';
    case 'CALLEE_BUSY': return 'They’re on another call.';
    case 'CALLER_BUSY': return 'You’re already on a call.';
    case 'SIGNED_OUT': return 'Sign in to call.';
    case 'BLOCKED': return 'You can’t call this person.';
    case 'CALL_REQUEST_NOT_ACCEPTED': return 'You can call once they accept your message request.';
    case 'CALL_REQUEST_PENDING': return 'Accept the message request to call.';
    default: return fallback || 'The call couldn’t be placed. Check your connection and try again.';
  }
}

/** The ended screen's line under the name — what actually happened to the call. */
export function endedSubtitle(session: Pick<CallSession, 'direction' | 'endReason' | 'connectedAt' | 'failureMessage'>): string {
  if (session.failureMessage) return session.failureMessage;
  if (session.connectedAt) return 'Call ended';
  const outgoing = session.direction === 'outgoing';
  switch (session.endReason) {
    case 'declined': return outgoing ? 'Declined' : 'Call declined';
    case 'missed': return outgoing ? 'No answer' : 'Missed call';
    case 'cancelled': return outgoing ? 'Call cancelled' : 'Missed call';
    case 'failed': return 'Call failed';
    default: return 'Call ended';
  }
}
