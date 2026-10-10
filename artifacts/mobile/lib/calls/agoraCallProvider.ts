/**
 * The real CallProvider for 1:1 DM calls (the "PR2" slot CallSessionContext
 * was built for): server-tracked call state + Agora media.
 *
 *  - Placing a call: POST /api/call/dm/calls → the server records a ringing
 *    call, pushes "Incoming call" to the other person and sends them a
 *    `call.incoming` socket event; we join the call's Agora channel right
 *    away with the token it returns.
 *  - The other side accepts / declines on their device; their action reaches
 *    us as `call.updated` (socket, with polling as a fallback), and the UI
 *    moves to connected / ended from the SERVER's state, so both sides
 *    always agree on what happened (and both see the same call-log entry).
 *  - Ending, muting, camera and speaker drive the Agora engine directly.
 *
 * Keys stay server-side: the client only ever receives short-lived Agora
 * tokens. Without AGORA_APP_ID / AGORA_APP_CERTIFICATE the server answers
 * 503 CALLING_NOT_CONFIGURED and the call ends with that message — never a
 * simulated call.
 */
import { ApiError } from '@/lib/networkNotice';
import { createRtcEngine } from './rtc/rtcEngine';
import type { RtcEngine } from './rtc/types';
import {
  isTerminalStatus, peerFromDto, sessionPatchFromDto, startFailureMessage,
  type DmCallDto, type DmCallRtcDto,
} from './dmCallClient';
import { connectCallEvents, type CallEventsConnection } from './callEvents';
import type { CallEndReason, CallPeer, CallProvider, CallSession, StartCallInput } from './types';

type Listener = (patch: Partial<CallSession>) => void;

export interface DmCallApi {
  create(body: { conversationId: string; mode: 'voice' | 'video' }): Promise<{ call: DmCallDto; rtc: DmCallRtcDto }>;
  accept(id: string): Promise<{ call: DmCallDto; rtc: DmCallRtcDto }>;
  decline(id: string): Promise<{ call: DmCallDto }>;
  end(id: string): Promise<{ call: DmCallDto }>;
  token(id: string): Promise<{ rtc: DmCallRtcDto }>;
  get(id: string): Promise<{ call: DmCallDto }>;
  incoming(): Promise<{ call: DmCallDto | null }>;
}

export class CallStartError extends Error {
  constructor(public readonly code: string | undefined, message: string) {
    super(message);
  }
}

interface Handle {
  call: DmCallDto;
  engine: RtcEngine | null;
  listeners: Set<Listener>;
  poll: ReturnType<typeof setInterval> | null;
  remoteLeftTimer: ReturnType<typeof setTimeout> | null;
}

const POLL_MS = 3_000;

export interface AgoraCallProvider extends CallProvider {
  /** Fires when someone starts ringing this user (socket, push tap, or foreground check). */
  onIncoming(listener: (session: CallSession) => void): () => void;
  /** GET /api/call/dm/incoming — catch up after a push tap / reconnect / foreground. */
  checkIncoming(): Promise<void>;
  switchCamera(callId: string): void;
  engineFor(callId: string): RtcEngine | null;
  /** Starts the realtime socket (signed-in only). */
  connect(): void;
  dispose(): void;
}

export function createAgoraCallProvider(deps: {
  api: DmCallApi;
  getToken: () => Promise<string | null>;
  isSignedIn: () => boolean;
  me: () => CallPeer;
}): AgoraCallProvider {
  const handles = new Map<string, Handle>();
  const incomingListeners = new Set<(session: CallSession) => void>();
  let socket: CallEventsConnection | null = null;

  function emit(h: Handle, patch: Partial<CallSession>) {
    h.listeners.forEach((l) => l(patch));
  }

  function stopTimers(h: Handle) {
    if (h.poll) clearInterval(h.poll);
    h.poll = null;
    if (h.remoteLeftTimer) clearTimeout(h.remoteLeftTimer);
    h.remoteLeftTimer = null;
  }

  async function teardown(h: Handle) {
    stopTimers(h);
    const engine = h.engine;
    h.engine = null;
    await engine?.leave().catch(() => {});
  }

  /** Applies the server's latest view of a call (socket event, poll or action response). */
  function applyServerCall(call: DmCallDto) {
    const h = handles.get(call.id);
    if (!h) return;
    const wasTerminal = isTerminalStatus(h.call.status);
    h.call = call;
    if (wasTerminal) return;
    emit(h, sessionPatchFromDto(call));
    if (isTerminalStatus(call.status)) void teardown(h);
  }

  function startPolling(h: Handle) {
    if (h.poll) return;
    h.poll = setInterval(() => {
      if (isTerminalStatus(h.call.status)) { stopTimers(h); return; }
      deps.api.get(h.call.id).then(({ call }) => applyServerCall(call)).catch(() => {});
    }, POLL_MS);
  }

  function makeEngine(h: Handle): RtcEngine {
    return createRtcEngine(h.call.mode, {
      remoteJoined: () => {
        if (h.remoteLeftTimer) { clearTimeout(h.remoteLeftTimer); h.remoteLeftTimer = null; }
      },
      remoteLeft: () => {
        // The other app left the channel (hung up, crashed, lost network).
        // Give their own "end" a moment to arrive; if the server still says
        // accepted, end it from here so neither side is stuck in a dead call.
        if (h.remoteLeftTimer) clearTimeout(h.remoteLeftTimer);
        h.remoteLeftTimer = setTimeout(() => {
          if (h.call.status === 'accepted') {
            deps.api.end(h.call.id).then(({ call }) => applyServerCall(call)).catch(() => {});
          }
        }, 4_000);
      },
      remoteVideoChanged: (on) => {
        if (h.call.mode === 'video' && h.call.status === 'accepted') emit(h, { peerCameraOff: !on });
      },
      tokenWillExpire: () => {
        deps.api.token(h.call.id).then(({ rtc }) => h.engine?.renewToken(rtc.token)).catch(() => {});
      },
      error: () => { /* transient SDK errors; a real drop surfaces as remoteLeft / server end */ },
    });
  }

  function sessionFromIncoming(call: DmCallDto): CallSession {
    return {
      callId: call.id,
      conversationId: call.conversationId,
      surface: 'buyer',
      mode: call.mode,
      direction: 'incoming',
      status: 'incoming',
      peer: peerFromDto(call),
      me: deps.me(),
      minimized: false,
      muted: false,
      cameraOff: call.mode === 'voice',
      peerCameraOff: false,
      speakerOn: call.mode === 'video',
    };
  }

  function receiveIncoming(call: DmCallDto) {
    if (call.direction !== 'incoming' || call.status !== 'ringing') return;
    if (handles.has(call.id)) return;
    const h: Handle = { call, engine: null, listeners: new Set(), poll: null, remoteLeftTimer: null };
    handles.set(call.id, h);
    startPolling(h); // caller cancelling / ring timeout reaches us even without the socket
    const session = sessionFromIncoming(call);
    incomingListeners.forEach((l) => l(session));
  }

  const provider: AgoraCallProvider = {
    id: 'agora',

    async start(input: StartCallInput) {
      if (!deps.isSignedIn()) throw new CallStartError('SIGNED_OUT', startFailureMessage('SIGNED_OUT'));
      let created: { call: DmCallDto; rtc: DmCallRtcDto };
      try {
        created = await deps.api.create({ conversationId: input.conversationId, mode: input.mode });
      } catch (error) {
        const code = error instanceof ApiError ? error.code : undefined;
        // 403s carry a policy code (lib/callPolicy.ts on the server): blocked,
        // or a message request that hasn't been accepted yet.
        const message = error instanceof ApiError && error.status === 403
          ? startFailureMessage(code, 'You can’t call this person.')
          : startFailureMessage(code);
        throw new CallStartError(code, message);
      }
      const h: Handle = { call: created.call, engine: null, listeners: new Set(), poll: null, remoteLeftTimer: null };
      handles.set(created.call.id, h);
      h.engine = makeEngine(h);
      try {
        await h.engine.join(created.rtc);
      } catch (error) {
        await deps.api.end(created.call.id).catch(() => {});
        await teardown(h);
        handles.delete(created.call.id);
        throw new CallStartError('MEDIA', error instanceof Error ? error.message : startFailureMessage(undefined));
      }
      startPolling(h);
      return { callId: created.call.id };
    },

    async accept(callId: string) {
      const h = handles.get(callId);
      if (!h) return;
      const { call, rtc } = await deps.api.accept(callId);
      h.call = call;
      if (call.status !== 'accepted') { applyServerCall(call); return; }
      h.engine = makeEngine(h);
      try {
        await h.engine.join(rtc);
      } catch {
        const ended = await deps.api.end(callId).catch(() => null);
        if (ended) applyServerCall(ended.call);
        return;
      }
      startPolling(h);
      emit(h, sessionPatchFromDto(call));
    },

    async end(callId: string, _reason: CallEndReason) {
      const h = handles.get(callId);
      if (!h) return;
      const decline = h.call.direction === 'incoming' && h.call.status === 'ringing';
      try {
        const { call } = decline ? await deps.api.decline(callId) : await deps.api.end(callId);
        applyServerCall(call);
      } catch {
        // Network failure: still leave the media channel locally; the
        // server's ring timeout / the other side's leave-detection closes it.
        await teardown(h);
      }
    },

    setMuted(callId, muted) { handles.get(callId)?.engine?.setMuted(muted); },
    setCameraOff(callId, off) { handles.get(callId)?.engine?.setCameraOff(off); },
    setSpeakerOn(callId, on) { handles.get(callId)?.engine?.setSpeakerOn(on); },
    switchCamera(callId) { handles.get(callId)?.engine?.switchCamera(); },
    engineFor(callId) { return handles.get(callId)?.engine ?? null; },

    subscribe(callId, listener) {
      const h = handles.get(callId);
      if (!h) return () => {};
      h.listeners.add(listener);
      return () => { h.listeners.delete(listener); };
    },

    onIncoming(listener) {
      incomingListeners.add(listener);
      return () => { incomingListeners.delete(listener); };
    },

    async checkIncoming() {
      if (!deps.isSignedIn()) return;
      try {
        const { call } = await deps.api.incoming();
        if (call) receiveIncoming(call);
      } catch { /* offline — the socket / next foreground retries */ }
    },

    connect() {
      if (socket || !deps.isSignedIn()) return;
      socket = connectCallEvents({
        getToken: deps.getToken,
        onEvent: (event) => {
          if (event.type === 'call.incoming') receiveIncoming(event.call);
          else applyServerCall(event.call);
        },
        onConnected: () => {
          void provider.checkIncoming();
          handles.forEach((h) => {
            if (!isTerminalStatus(h.call.status)) {
              deps.api.get(h.call.id).then(({ call }) => applyServerCall(call)).catch(() => {});
            }
          });
        },
      });
    },

    dispose() {
      socket?.close();
      socket = null;
      handles.forEach((h) => { void teardown(h); });
      handles.clear();
    },
  };
  return provider;
}
