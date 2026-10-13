/**
 * App-wide 1:1 call session — one call at a time, alive across navigation.
 *
 * This is deliberately NOT a route. Instagram's call UI floats above the
 * whole app and survives you navigating around (minimize -> chevron -> the
 * call keeps running in a bar at the top) — a pushed screen can't do that
 * (unmounting on navigation would hang up the call). So the call screen is
 * rendered by <GlobalCallOverlay/> (mounted once in app/_layout.tsx) as an
 * absolute-fill layer, and "minimizing" is just a boolean flip, not a nav
 * action.
 *
 * PR1: only `previewCallProvider` is wired (see lib/calls/previewCallProvider.ts) —
 * a fully simulated call, no media/signaling. PR2 swaps in `agoraCallProvider`
 * (adapting the existing engine logic in app/call-screen.tsx) with no changes
 * needed here or in any screen component.
 */
import React, {
  createContext, useCallback, useContext, useMemo, useRef, useState,
} from 'react';
import { createPreviewCallProvider, schedulePreviewIncomingTimeout } from './previewCallProvider';
import type {
  CallEndReason, CallLogEntry, CallProvider, CallSession, StartCallInput,
} from './types';

const provider: CallProvider = createPreviewCallProvider();

interface CallSessionContextValue {
  session: CallSession | null;
  /** Most recent call-log entries, newest first, keyed by conversationId — read by the two conversation screens to render bubbles. */
  logsByConversation: Record<string, CallLogEntry[]>;
  startCall(input: StartCallInput): Promise<void>;
  /** Preview/QA only: ring an incoming call without a second device. */
  simulateIncomingCall(input: StartCallInput): void;
  acceptCall(): Promise<void>;
  declineOrEndCall(): Promise<void>;
  minimize(): void;
  restore(): void;
  /**
   * Dismisses a terminal (`status === 'ended'`) session back to no active
   * call. `GlobalCallOverlay` renders `CallEndedView` for as long as
   * `session.status === 'ended'` regardless of `minimized` (an ended call
   * isn't something you minimize back into — it's over), so this is the one
   * way the ended + rating screen actually goes away, whether the person
   * taps its close "X" immediately or a rating auto-dismisses it a beat
   * later. A no-op for any other status.
   */
  clearEndedCall(): void;
  toggleMute(): void;
  toggleCameraOff(): void;
  toggleSpeaker(): void;
}

const CallSessionContext = createContext<CallSessionContextValue | null>(null);

function logReasonFor(session: CallSession): CallEndReason {
  return session.endReason ?? 'hangup';
}

export function CallSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<CallSession | null>(null);
  const [logsByConversation, setLogsByConversation] = useState<Record<string, CallLogEntry[]>>({});
  const unsubRef = useRef<(() => void) | null>(null);
  const incomingTimeoutRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<CallSession | null>(null);
  sessionRef.current = session;

  const appendLog = useCallback((finalSession: CallSession) => {
    const entry: CallLogEntry = {
      id: finalSession.callId,
      conversationId: finalSession.conversationId,
      mode: finalSession.mode,
      direction: finalSession.direction,
      startedAt: finalSession.connectedAt ?? finalSession.endedAt ?? Date.now(),
      durationSec: finalSession.connectedAt && finalSession.endedAt
        ? Math.max(0, Math.round((finalSession.endedAt - finalSession.connectedAt) / 1000))
        : undefined,
      reason: logReasonFor(finalSession),
      missed: finalSession.direction === 'incoming' && !finalSession.connectedAt,
    };
    setLogsByConversation(prev => ({
      ...prev,
      [entry.conversationId]: [entry, ...(prev[entry.conversationId] ?? [])],
    }));
  }, []);

  const teardownSubscription = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    incomingTimeoutRef.current?.();
    incomingTimeoutRef.current = null;
  }, []);

  const applyPatch = useCallback((callId: string, patch: Partial<CallSession>) => {
    setSession((prev) => {
      if (!prev || prev.callId !== callId) return prev;
      const next = { ...prev, ...patch };
      if (patch.status === 'ended') {
        teardownSubscription();
        appendLog(next);
      }
      return next;
    });
  }, [appendLog, teardownSubscription]);

  const startCall = useCallback(async (input: StartCallInput) => {
    if (sessionRef.current && sessionRef.current.status !== 'ended') return; // one call at a time
    const { callId } = await provider.start(input);
    const next: CallSession = {
      callId,
      conversationId: input.conversationId,
      surface: input.surface,
      mode: input.mode,
      direction: 'outgoing',
      status: 'outgoing',
      peer: input.peer,
      me: input.me,
      minimized: false,
      muted: false,
      cameraOff: input.mode === 'voice',
      peerCameraOff: false,
      speakerOn: input.mode === 'video',
    };
    setSession(next);
    unsubRef.current = provider.subscribe(callId, patch => applyPatch(callId, patch));
  }, [applyPatch]);

  const simulateIncomingCall = useCallback((input: StartCallInput) => {
    if (sessionRef.current && sessionRef.current.status !== 'ended') return;
    const callId = `preview_incoming_${Date.now()}`;
    const next: CallSession = {
      callId,
      conversationId: input.conversationId,
      surface: input.surface,
      mode: input.mode,
      direction: 'incoming',
      status: 'incoming',
      peer: input.peer,
      me: input.me,
      minimized: false,
      muted: false,
      cameraOff: input.mode === 'voice',
      peerCameraOff: false,
      speakerOn: input.mode === 'video',
    };
    setSession(next);
    incomingTimeoutRef.current = schedulePreviewIncomingTimeout(callId, () => {
      setSession((prev) => {
        if (!prev || prev.callId !== callId || prev.status !== 'incoming') return prev;
        const ended: CallSession = { ...prev, status: 'ended', endedAt: Date.now(), endReason: 'missed' };
        appendLog(ended);
        return ended;
      });
    });
  }, [appendLog]);

  const acceptCall = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || s.status !== 'incoming') return;
    incomingTimeoutRef.current?.();
    incomingTimeoutRef.current = null;
    await provider.accept(s.callId);
    unsubRef.current = provider.subscribe(s.callId, patch => applyPatch(s.callId, patch));
    setSession(prev => (prev ? { ...prev, status: 'connected', connectedAt: Date.now() } : prev));
  }, [applyPatch]);

  const declineOrEndCall = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || s.status === 'ended') return;
    const reason: CallEndReason = s.status === 'incoming' ? 'declined'
      : s.status === 'outgoing' ? 'cancelled'
      : 'hangup';
    teardownSubscription();
    await provider.end(s.callId, reason);
    setSession((prev) => {
      if (!prev || prev.callId !== s.callId) return prev;
      const ended = { ...prev, status: 'ended' as const, endedAt: Date.now(), endReason: reason };
      appendLog(ended);
      return ended;
    });
  }, [appendLog, teardownSubscription]);

  const minimize = useCallback(() => setSession(prev => (prev ? { ...prev, minimized: true } : prev)), []);
  const restore = useCallback(() => setSession(prev => (prev ? { ...prev, minimized: false } : prev)), []);
  const clearEndedCall = useCallback(() => {
    setSession(prev => (prev && prev.status === 'ended' ? null : prev));
  }, []);

  const toggleMute = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const next = !s.muted;
    provider.setMuted(s.callId, next);
    setSession(prev => (prev ? { ...prev, muted: next } : prev));
  }, []);

  const toggleCameraOff = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.mode !== 'video') return;
    const next = !s.cameraOff;
    provider.setCameraOff(s.callId, next);
    setSession(prev => (prev ? { ...prev, cameraOff: next } : prev));
  }, []);

  const toggleSpeaker = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const next = !s.speakerOn;
    provider.setSpeakerOn(s.callId, next);
    setSession(prev => (prev ? { ...prev, speakerOn: next } : prev));
  }, []);

  const value = useMemo<CallSessionContextValue>(() => ({
    session,
    logsByConversation,
    startCall,
    simulateIncomingCall,
    acceptCall,
    declineOrEndCall,
    minimize,
    restore,
    clearEndedCall,
    toggleMute,
    toggleCameraOff,
    toggleSpeaker,
  }), [
    session, logsByConversation, startCall, simulateIncomingCall, acceptCall,
    declineOrEndCall, minimize, restore, clearEndedCall, toggleMute, toggleCameraOff, toggleSpeaker,
  ]);

  return <CallSessionContext.Provider value={value}>{children}</CallSessionContext.Provider>;
}

export function useCallSession(): CallSessionContextValue {
  const ctx = useContext(CallSessionContext);
  if (!ctx) throw new Error('useCallSession must be used within CallSessionProvider');
  return ctx;
}

/** Call-log entries for one conversation, newest first — used by the conversation screens. */
export function useCallLog(conversationId: string): CallLogEntry[] {
  const { logsByConversation } = useCallSession();
  return logsByConversation[conversationId] ?? [];
}
