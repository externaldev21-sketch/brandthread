/**
 * Connects the system call screen (CallKit / ConnectionService, via
 * nativeCallKit) to the app's existing call session (CallSessionContext +
 * agoraCallProvider) — reused, not forked:
 *
 *   system Answer  → the session's acceptCall() (POST …/accept, joins Agora)
 *   system Decline → the session's declineOrEndCall() (POST …/decline or /end);
 *                    before the session has loaded, POST …/end directly
 *   VoIP/FCM push  → incoming: agora.checkIncoming() so the in-app screen
 *                    matches; ended: end the system call
 *   session ends   → end the system call (remote hang-up, missed, media ended)
 *   answered in-app→ tell the system the call is active
 *
 * Does nothing when nativeCallKit is inert (Expo Go, web, demo preview,
 * signed out, builds without the native modules) — and nothing while calls
 * are unavailable (GET /api/call/availability → configured: false, i.e. no
 * Agora credentials on the server): no VoIP / FCM token is registered and
 * CallKit / ConnectionService is never set up, so a phone can't ring for a
 * call that could never connect. Availability is only asked for when the
 * native modules are really there.
 */
import { useEffect, useRef, useState } from 'react';
import { getCallAvailability } from '@/services/manufacturerOrderFlow';
import type { CallSession } from '../types';
import { nativeCallKit } from './nativeCallKit';
import { nativeEndReasonFor, nativeEndReasonForSession, type NativeCallToken } from './nativeCallCore';
import { setCallUserId } from './callIdentity';

/**
 * Whether calling is switched on (the server's Agora credentials), asked once
 * per sign-in and only when `enabled` (signed in, real provider) on a build
 * whose native call modules exist. null = not known (yet) — treated as off.
 */
export function useNativeCallsAvailable(enabled: boolean, userId: string | null | undefined): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    setAvailable(null);
    if (!enabled || !nativeCallKit.available || !userId) return undefined;
    let live = true;
    getCallAvailability()
      .then((configured) => { if (live) setAvailable(configured === true); })
      .catch(() => { if (live) setAvailable(false); });
    return () => { live = false; };
  }, [enabled, userId]);
  return available;
}

export function useNativeCallBridge(opts: {
  enabled: boolean;
  /**
   * GET /api/call/availability (useNativeCallsAvailable). Native ringing is
   * wired only when this is exactly true; false or unknown keeps it inert.
   */
  callsAvailable: boolean | null;
  /**
   * The signed-in Clerk user id; null once auth has loaded signed out;
   * undefined while auth is still loading. Persisted for the native push
   * handlers (callIdentity.ts) so a ring for a previous account is dropped.
   */
  userId: string | null | undefined;
  session: CallSession | null;
  checkIncoming(): Promise<void> | void;
  acceptCall(): Promise<void>;
  declineOrEndCall(): Promise<void>;
  endOnServer(callId: string): Promise<unknown>;
  uploadToken(token: NativeCallToken): Promise<unknown>;
  /** Best-effort DELETE /api/push/voip-token when the account on this device changes. */
  deregisterToken(token: string): Promise<unknown>;
}): void {
  const latest = useRef(opts);
  latest.current = opts;
  const pendingAnswer = useRef<string | null>(null);
  const reported = useRef<{ callId: string; answered: boolean; ended: boolean } | null>(null);

  // Who native ringing may ring for. Cleared on sign-out, replaced on an
  // account switch — before any push for the new account can arrive.
  useEffect(() => {
    if (opts.userId === undefined) return;
    void setCallUserId(opts.userId);
  }, [opts.userId]);

  const active = opts.enabled && opts.callsAvailable === true && nativeCallKit.available;

  useEffect(() => {
    if (!active) return undefined;
    const offEvents = nativeCallKit.init({
      onAnswer(callId) {
        const s = latest.current.session;
        if (s?.callId === callId) {
          if (s.status === 'incoming') void latest.current.acceptCall();
          return;
        }
        // Answered from the lock screen before the app had the call: fetch
        // it, then accept once it lands (effect below).
        pendingAnswer.current = callId;
        void latest.current.checkIncoming();
      },
      onEnd(callId) {
        const s = latest.current.session;
        if (s?.callId === callId) {
          if (s.status !== 'ended') void latest.current.declineOrEndCall();
          return;
        }
        if (pendingAnswer.current === callId) pendingAnswer.current = null;
        // Declined before the app loaded the call — the server turns a
        // callee's /end on a ringing call into "declined" (idempotent if over).
        latest.current.endOnServer(callId).catch(() => {});
      },
      onPush(push) {
        if (push.type === 'dm_call_incoming') {
          void latest.current.checkIncoming();
          return;
        }
        const s = latest.current.session;
        // This device is the one that answered: keep its call.
        if (push.reason === 'answered_elsewhere' && s?.callId === push.callId && s.status === 'connected') return;
        nativeCallKit.endCall(push.callId, nativeEndReasonFor(push.reason));
      },
    });
    let lastToken = '';
    const offToken = nativeCallKit.registerToken((token) => {
      if (token.token === lastToken) return;
      lastToken = token.token;
      latest.current.uploadToken(token).catch(() => { lastToken = ''; });
    });
    return () => {
      offEvents();
      offToken();
      // Signing out / switching account: drop this device's token for the
      // account that is leaving. Best-effort — once the session is gone the
      // request may be refused; the push's calleeId check (callIdentity.ts)
      // and the server moving the token on the next registration cover that.
      if (lastToken) latest.current.deregisterToken(lastToken).catch(() => {});
    };
  }, [active, opts.userId]);

  const { session } = opts;
  useEffect(() => {
    if (!active || !session || session.callId.startsWith('pending_')) return;
    if (session.direction !== 'incoming') return;
    if (!reported.current || reported.current.callId !== session.callId) {
      reported.current = { callId: session.callId, answered: false, ended: false };
    }
    const r = reported.current;
    if (session.status === 'incoming' && pendingAnswer.current === session.callId) {
      pendingAnswer.current = null;
      void latest.current.acceptCall();
      return;
    }
    if (session.status === 'connected' && !r.answered) {
      r.answered = true;
      nativeCallKit.reportAnswered(session.callId);
    }
    if (session.status === 'ended' && !r.ended) {
      r.ended = true;
      nativeCallKit.endCall(session.callId, nativeEndReasonForSession(session.endReason, !!session.connectedAt));
    }
  }, [active, session]);
}
