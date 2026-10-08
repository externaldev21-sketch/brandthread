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
 * Providers:
 *  - Real accounts: `agoraCallProvider` (lib/calls/agoraCallProvider.ts) —
 *    server-tracked call state (ringing / accepted / declined / missed /
 *    ended, shared by both participants over /ws/calls + push) and Agora
 *    media on iOS, Android and web. Incoming calls arrive here from the
 *    socket, a push tap, or the foreground check, and render as the
 *    incoming-call screen wherever the person is in the app.
 *  - The `&demo=1` web preview only: `previewCallProvider` — a simulated
 *    call so the demo dataset has something to show without an account.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth, useUser } from '@clerk/expo';
import { hapticPrimaryAction, hapticSuccessAction, hapticDestructiveConfirm } from '@/lib/haptics';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { useApi } from '@/lib/api';
import { createPreviewCallProvider, schedulePreviewIncomingTimeout } from './previewCallProvider';
import { CallStartError, createAgoraCallProvider, type AgoraCallProvider } from './agoraCallProvider';
import { logEntryFromDto } from './dmCallClient';
import { onIncomingCallSignal } from './incomingCallSignal';
import { useNativeCallBridge } from './native/useNativeCallBridge';
import type { RtcEngine } from './rtc/types';
import type {
  CallEndReason, CallLogEntry, CallProvider, CallSession, StartCallInput,
} from './types';

interface CallSessionContextValue {
  session: CallSession | null;
  /** Most recent call-log entries, newest first, keyed by conversationId — read by the two conversation screens to render bubbles. */
  logsByConversation: Record<string, CallLogEntry[]>;
  /** Loads a conversation's call history from the server (both participants see the same entries). */
  refreshCallLog(conversationId: string): Promise<void>;
  startCall(input: StartCallInput): Promise<void>;
  /** `&demo=1` preview only: ring an incoming call without a second device. */
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
  switchCamera(): void;
  /** The live media engine for the current call (null in the demo preview / before joining). */
  rtcEngine(): RtcEngine | null;
}

const CallSessionContext = createContext<CallSessionContextValue | null>(null);

function logReasonFor(session: CallSession): CallEndReason {
  return session.endReason ?? 'hangup';
}

export function CallSessionProvider({ children }: { children: React.ReactNode }) {
  const api = useApi();
  const { getToken, isSignedIn, isLoaded, userId: authUserId } = useAuth();
  const { user } = useUser();
  const demo = isPreviewDemoMode();

  const [session, setSession] = useState<CallSession | null>(null);
  const [logsByConversation, setLogsByConversation] = useState<Record<string, CallLogEntry[]>>({});
  const unsubRef = useRef<(() => void) | null>(null);
  const incomingTimeoutRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef<CallSession | null>(null);
  sessionRef.current = session;
  const signedInRef = useRef(!!isSignedIn);
  signedInRef.current = !!isSignedIn;
  const userRef = useRef(user);
  userRef.current = user;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const me = useCallback(() => {
    const u = userRef.current;
    const name = u?.fullName || u?.username || 'You';
    return { id: u?.id ?? '', name, initials: (name[0] ?? '?').toUpperCase(), color: '#3A3A3C', avatarUri: u?.imageUrl ?? null };
  }, []);

  // One provider for the app's lifetime: simulated in the demo preview,
  // the real server + Agora provider everywhere else.
  const provider = useMemo<CallProvider>(() => (
    demo
      ? createPreviewCallProvider()
      : createAgoraCallProvider({
        api: api.call.dm,
        getToken: () => getTokenRef.current(),
        isSignedIn: () => signedInRef.current,
        me,
      })
  ), [demo, api, me]);
  const agora = provider.id === 'agora' ? (provider as AgoraCallProvider) : null;

  const refreshCallLog = useCallback(async (conversationId: string) => {
    if (!agora || !conversationId || !signedInRef.current) return;
    try {
      const { calls } = await api.call.dm.log(conversationId);
      const entries = calls.map(logEntryFromDto).filter((e): e is CallLogEntry => !!e);
      setLogsByConversation(prev => ({ ...prev, [conversationId]: entries }));
    } catch { /* keep what's shown */ }
  }, [agora, api]);

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
      [entry.conversationId]: [entry, ...(prev[entry.conversationId] ?? []).filter(e => e.id !== entry.id)],
    }));
    // Real calls: replace the optimistic entry with the server's record.
    if (!finalSession.failureMessage) void refreshCallLog(finalSession.conversationId);
  }, [refreshCallLog]);

  const teardownSubscription = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    incomingTimeoutRef.current?.();
    incomingTimeoutRef.current = null;
  }, []);

  const applyPatch = useCallback((callId: string, patch: Partial<CallSession>) => {
    setSession((prev) => {
      if (!prev || prev.callId !== callId || prev.status === 'ended') return prev;
      const next = { ...prev, ...patch };
      if (patch.status === 'connected' && prev.status !== 'connected') hapticSuccessAction();
      if (patch.status === 'ended') {
        teardownSubscription();
        appendLog(next);
      }
      return next;
    });
  }, [appendLog, teardownSubscription]);

  // ── Incoming calls (real provider) ─────────────────────────────────────────
  useEffect(() => {
    if (!agora) return undefined;
    const offIncoming = agora.onIncoming((incoming) => {
      const current = sessionRef.current;
      if (current && current.status !== 'ended') return; // one call at a time (server also refuses a busy callee)
      hapticPrimaryAction();
      setSession({ ...incoming, me: me() });
      unsubRef.current?.();
      unsubRef.current = agora.subscribe(incoming.callId, patch => applyPatch(incoming.callId, patch));
    });
    return offIncoming;
  }, [agora, applyPatch, me]);

  useEffect(() => {
    if (!agora || !isSignedIn) return undefined;
    agora.connect();
    void agora.checkIncoming();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void agora.checkIncoming();
    });
    const offSignal = onIncomingCallSignal(() => { void agora.checkIncoming(); });
    let offPush: (() => void) | null = null;
    if (Platform.OS !== 'web') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Notifications = require('expo-notifications');
        const sub = Notifications.addNotificationReceivedListener((n: any) => {
          if (n?.request?.content?.data?.type === 'dm_call_incoming') void agora.checkIncoming();
        });
        offPush = () => sub.remove();
      } catch { /* notifications unavailable in this build */ }
    }
    return () => { appState.remove(); offSignal(); offPush?.(); };
  }, [agora, isSignedIn]);

  useEffect(() => () => { agora?.dispose(); }, [agora]);

  const startCall = useCallback(async (input: StartCallInput) => {
    if (sessionRef.current && sessionRef.current.status !== 'ended') return; // one call at a time
    hapticPrimaryAction();
    const base: CallSession = {
      callId: `pending_${Date.now()}`,
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
    // Show "Calling…" immediately while the server records the call and the
    // media channel joins.
    setSession(base);
    try {
      const { callId } = await provider.start(input);
      setSession(prev => (prev && prev.callId === base.callId ? { ...prev, callId } : prev));
      unsubRef.current?.();
      unsubRef.current = provider.subscribe(callId, patch => applyPatch(callId, patch));
    } catch (error) {
      const failureMessage = error instanceof CallStartError ? error.message : 'The call couldn’t be placed. Try again.';
      setSession(prev => (prev && prev.callId === base.callId
        ? { ...prev, status: 'ended', endedAt: Date.now(), endReason: 'failed', failureMessage }
        : prev));
    }
  }, [applyPatch, provider]);

  const simulateIncomingCall = useCallback((input: StartCallInput) => {
    if (provider.id !== 'preview') return;
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
  }, [appendLog, provider]);

  const acceptCall = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || s.status !== 'incoming') return;
    hapticSuccessAction();
    incomingTimeoutRef.current?.();
    incomingTimeoutRef.current = null;
    if (provider.id === 'preview') {
      await provider.accept(s.callId);
      unsubRef.current = provider.subscribe(s.callId, patch => applyPatch(s.callId, patch));
      setSession(prev => (prev ? { ...prev, status: 'connected', connectedAt: Date.now() } : prev));
      return;
    }
    // Real call: the server's accepted state (via the subscription) moves
    // the UI to connected on both devices.
    try {
      await provider.accept(s.callId);
    } catch {
      applyPatch(s.callId, { status: 'ended', endedAt: Date.now(), endReason: 'failed', failureMessage: 'The call couldn’t be answered. It may have ended.' });
    }
  }, [applyPatch, provider]);

  const declineOrEndCall = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || s.status === 'ended') return;
    hapticDestructiveConfirm();
    const reason: CallEndReason = s.status === 'incoming' ? 'declined'
      : s.status === 'outgoing' ? 'cancelled'
      : 'hangup';
    if (provider.id === 'preview' || s.callId.startsWith('pending_')) {
      teardownSubscription();
      if (provider.id === 'preview') await provider.end(s.callId, reason);
      setSession((prev) => {
        if (!prev || prev.callId !== s.callId) return prev;
        const ended = { ...prev, status: 'ended' as const, endedAt: Date.now(), endReason: reason };
        appendLog(ended);
        return ended;
      });
      return;
    }
    // Real call: the server records who ended it and both sides get the same
    // final state (the subscription applies it).
    await provider.end(s.callId, reason);
    setSession((prev) => {
      if (!prev || prev.callId !== s.callId || prev.status === 'ended') return prev;
      const ended = { ...prev, status: 'ended' as const, endedAt: Date.now(), endReason: reason };
      teardownSubscription();
      appendLog(ended);
      return ended;
    });
  }, [appendLog, provider, teardownSubscription]);

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
  }, [provider]);

  const toggleCameraOff = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.mode !== 'video') return;
    const next = !s.cameraOff;
    provider.setCameraOff(s.callId, next);
    setSession(prev => (prev ? { ...prev, cameraOff: next } : prev));
  }, [provider]);

  const toggleSpeaker = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const next = !s.speakerOn;
    provider.setSpeakerOn(s.callId, next);
    setSession(prev => (prev ? { ...prev, speakerOn: next } : prev));
  }, [provider]);

  const switchCamera = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.mode !== 'video' || !agora) return;
    agora.switchCamera(s.callId);
  }, [agora]);

  // System call screen (CallKit / ConnectionService) on native builds —
  // drives the same accept / decline / end above; inert in Expo Go and web.
  useNativeCallBridge({
    enabled: !!agora && !!isSignedIn,
    userId: !isLoaded ? undefined : (isSignedIn && authUserId ? authUserId : null),
    session,
    checkIncoming: () => agora?.checkIncoming(),
    acceptCall,
    declineOrEndCall,
    endOnServer: (callId) => api.call.dm.end(callId),
    uploadToken: (token) => api.push.registerVoipToken(token),
    deregisterToken: (token) => api.push.deregisterVoipToken(token),
  });

  const rtcEngine = useCallback(() => {
    const s = sessionRef.current;
    return s && agora ? agora.engineFor(s.callId) : null;
  }, [agora]);

  const value = useMemo<CallSessionContextValue>(() => ({
    session,
    logsByConversation,
    refreshCallLog,
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
    switchCamera,
    rtcEngine,
  }), [
    session, logsByConversation, refreshCallLog, startCall, simulateIncomingCall, acceptCall,
    declineOrEndCall, minimize, restore, clearEndedCall, toggleMute, toggleCameraOff, toggleSpeaker,
    switchCamera, rtcEngine,
  ]);

  return <CallSessionContext.Provider value={value}>{children}</CallSessionContext.Provider>;
}

export function useCallSession(): CallSessionContextValue {
  const ctx = useContext(CallSessionContext);
  if (!ctx) throw new Error('useCallSession must be used within CallSessionProvider');
  return ctx;
}

/** Call-log entries for one conversation, newest first — loaded from the server for real calls. */
export function useCallLog(conversationId: string): CallLogEntry[] {
  const { logsByConversation, refreshCallLog } = useCallSession();
  useEffect(() => {
    if (conversationId) void refreshCallLog(conversationId);
  }, [conversationId, refreshCallLog]);
  return logsByConversation[conversationId] ?? [];
}
