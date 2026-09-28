/**
 * 1:1 DM calling — shared types.
 *
 * Mirrors the same "one provider interface, swappable implementation" shape
 * as lib/live/types.ts. PR1 only ships `previewCallProvider` (a fully
 * simulated call, no network/media) so the whole Instagram-mirror UI can be
 * built and screenshotted without real Agora credentials. PR2 adds
 * `agoraCallProvider`, which adapts the already-working Agora engine logic
 * in app/call-screen.tsx to this same interface — no UI changes needed.
 */

export type CallMode = 'voice' | 'video';

/** Who the call is with, from the local user's point of view. */
export interface CallPeer {
  id: string;
  name: string;
  initials: string;
  /** Per-user identity color (theme-exempt — same convention as avatars elsewhere). */
  color: string;
  avatarUri?: string | null;
}

export type CallDirection = 'outgoing' | 'incoming';

/**
 * The call state machine. One `CallSession` exists at a time (no multi-call).
 *
 *   idle -> outgoing -> connected -> ended -> idle
 *   idle -> incoming -> connected -> ended -> idle
 *   outgoing/incoming -> ended (declined / cancelled / missed / failed) -> idle
 *
 * `minimized` is orthogonal to `status`: any active (non-idle, non-ended)
 * call can be minimized to the floating CallBar and restored, same as
 * Instagram's chevron-to-minimize / tap-bar-to-restore behavior.
 */
export type CallStatus = 'outgoing' | 'incoming' | 'connected' | 'ended';

export type CallEndReason =
  | 'hangup'        // either side pressed end/decline after connecting
  | 'declined'      // callee declined before connecting
  | 'cancelled'     // caller ended before the callee answered
  | 'missed'        // incoming call rang out with no answer/decline
  | 'failed';       // could not connect (no credentials, network, etc.)

export interface CallSession {
  callId: string;
  /** The conversation this call belongs to — used for the call-log bubble and Agora channel derivation. */
  conversationId: string;
  /** 'buyer' | 'seller' — which conversation screen/thread this call is anchored to. */
  surface: 'buyer' | 'seller';
  mode: CallMode;
  direction: CallDirection;
  status: CallStatus;
  peer: CallPeer;
  me: CallPeer;
  minimized: boolean;
  muted: boolean;
  /** Video only. Mirrors the peer's remote camera-off state, not just our own. */
  cameraOff: boolean;
  peerCameraOff: boolean;
  speakerOn: boolean;
  /** Wall-clock ms when the two sides actually connected (status -> 'connected'). Undefined until then. */
  connectedAt?: number;
  /** Wall-clock ms when the call ended. Only set once status === 'ended'. */
  endedAt?: number;
  endReason?: CallEndReason;
}

/** A single call-log entry rendered as a bubble in the conversation thread. */
export interface CallLogEntry {
  id: string;
  conversationId: string;
  mode: CallMode;
  direction: CallDirection;
  /** ms epoch the call was placed/received. */
  startedAt: number;
  /** Only set for calls that connected. */
  durationSec?: number;
  reason: CallEndReason;
  /** True when the call never connected and the local user is the one who didn't answer. */
  missed: boolean;
}

export interface StartCallInput {
  conversationId: string;
  surface: 'buyer' | 'seller';
  mode: CallMode;
  peer: CallPeer;
  me: CallPeer;
}

/**
 * A call provider owns the actual media/signaling. The UI (CallSessionContext
 * + screens) only ever talks to this interface, never to Agora/WebRTC
 * directly, so PR2 can swap in real signaling with zero UI changes.
 */
export interface CallProvider {
  id: 'preview' | 'agora';
  /** Place an outgoing call. Resolves once the provider has begun dialing (not once answered). */
  start(input: StartCallInput): Promise<{ callId: string }>;
  /** Accept an incoming call (only meaningful for providers that can receive one, e.g. once PR2 adds signaling). */
  accept(callId: string): Promise<void>;
  /** Decline/hang up/cancel — the one action for every "stop the call" case. */
  end(callId: string, reason: CallEndReason): Promise<void>;
  setMuted(callId: string, muted: boolean): void;
  setCameraOff(callId: string, cameraOff: boolean): void;
  setSpeakerOn(callId: string, speakerOn: boolean): void;
  /**
   * Subscribe to provider-driven session updates (status changes, peer
   * camera state, connection loss). Returns an unsubscribe function.
   */
  subscribe(callId: string, listener: (patch: Partial<CallSession>) => void): () => void;
}
