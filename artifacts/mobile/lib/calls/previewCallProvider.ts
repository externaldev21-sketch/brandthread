/**
 * Simulated CallProvider — no network, no media, no native SDK.
 *
 * Used in dev web preview (`?bt_preview=buyer|seller`, same convention as
 * lib/live/liveProvider.ts) and by default until PR2 wires the real Agora
 * provider, so the whole Instagram-mirror call UI (outgoing, incoming,
 * in-call, minimize, ended + rating, call-log bubbles) can be built and
 * screenshotted end to end with zero backend/credentials.
 *
 * Behavior, tuned to be demoable and screenshot-able:
 *  - An outgoing call "rings" for RING_MS, then auto-connects (simulating the
 *    other person picking up), unless ended first.
 *  - An incoming call (triggered via `simulateIncomingCall`, exposed for
 *    manual QA / preview-mode deep links) rings until accepted, declined, or
 *    it times out into a missed call.
 *  - Once connected, the peer's camera toggles off after a few seconds so
 *    the "{name}'s camera is off" state is reachable without extra steps.
 */
import type { CallEndReason, CallProvider, CallSession, StartCallInput } from './types';

const RING_MS = 2200;
const INCOMING_TIMEOUT_MS = 30000;
const PEER_CAMERA_TOGGLE_MS = 4000;

type Listener = (patch: Partial<CallSession>) => void;

interface Handle {
  callId: string;
  timers: ReturnType<typeof setTimeout>[];
  listeners: Set<Listener>;
}

const handles = new Map<string, Handle>();

function emit(callId: string, patch: Partial<CallSession>) {
  const h = handles.get(callId);
  if (!h) return;
  h.listeners.forEach(l => l(patch));
}

function clearTimers(h: Handle) {
  h.timers.forEach(clearTimeout);
  h.timers = [];
}

function schedule(h: Handle, ms: number, fn: () => void) {
  h.timers.push(setTimeout(fn, ms));
}

let callCounter = 0;
function newCallId(): string {
  callCounter += 1;
  return `preview_call_${Date.now()}_${callCounter}`;
}

export function createPreviewCallProvider(): CallProvider {
  return {
    id: 'preview',

    async start(input: StartCallInput) {
      const callId = newCallId();
      const h: Handle = { callId, timers: [], listeners: new Set() };
      handles.set(callId, h);

      schedule(h, RING_MS, () => {
        if (!handles.has(callId)) return;
        emit(callId, { status: 'connected', connectedAt: Date.now() });
        if (input.mode === 'video') {
          schedule(h, PEER_CAMERA_TOGGLE_MS, () => emit(callId, { peerCameraOff: true }));
        }
      });

      return { callId };
    },

    async accept(callId: string) {
      const h = handles.get(callId);
      if (!h) return;
      clearTimers(h);
      emit(callId, { status: 'connected', connectedAt: Date.now() });
    },

    async end(callId: string, reason: CallEndReason) {
      const h = handles.get(callId);
      if (!h) return;
      clearTimers(h);
      emit(callId, { status: 'ended', endedAt: Date.now(), endReason: reason });
      handles.delete(callId);
    },

    setMuted() {
      // Simulated: no real audio stream to mute. Local-only UI state, handled by the context.
    },

    setCameraOff() {
      // Simulated: no real camera. Local-only UI state, handled by the context.
    },

    setSpeakerOn() {
      // Simulated: no real audio route to switch.
    },

    subscribe(callId: string, listener: Listener) {
      const h = handles.get(callId);
      if (!h) return () => {};
      h.listeners.add(listener);
      return () => h.listeners.delete(listener);
    },
  };
}

/**
 * Preview-only helper: simulate a call ringing IN, so QA/screenshots can
 * reach the incoming-call screen without a second device or real signaling.
 * Not part of the CallProvider interface — the context calls this directly
 * when running in preview mode and a debug trigger fires (see
 * lib/calls/CallSessionContext.tsx `simulateIncomingCall`).
 */
export function schedulePreviewIncomingTimeout(
  callId: string,
  onTimeout: () => void,
): () => void {
  const h: Handle = { callId, timers: [], listeners: new Set() };
  handles.set(callId, h);
  schedule(h, INCOMING_TIMEOUT_MS, onTimeout);
  return () => clearTimers(h);
}
