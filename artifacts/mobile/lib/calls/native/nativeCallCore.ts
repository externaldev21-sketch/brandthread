/**
 * Native incoming-call ringing (CallKit on iOS, ConnectionService on
 * Android) — the platform-independent part: payload parsing, the
 * "is the native module really there" check, and shared types. Pure: no
 * React Native imports, so it is unit-tested under Node.
 *
 * Pushes come from api-server/src/lib/voipPush.ts:
 *   iOS     APNs VoIP push   → { type, callId, conversationId, callerId, callerName, callerAvatar, hasVideo, reason? }
 *   Android FCM data message → same keys, every value a string (hasVideo "1"/"0")
 */

export type NativeCallPushType = 'dm_call_incoming' | 'dm_call_ended';

export interface NativeCallPush {
  type: NativeCallPushType;
  callId: string;
  conversationId: string | null;
  /** The Clerk user this push is for (null from servers that predate it). */
  calleeId: string | null;
  callerId: string | null;
  callerName: string;
  callerAvatar: string | null;
  hasVideo: boolean;
  /** dm_call_ended: declined | cancelled | missed | answered_elsewhere | blocked | failed */
  reason: string | null;
}

export interface NativeCallToken {
  token: string;
  platform: 'ios' | 'android';
  kind: 'voip' | 'fcm';
  environment?: 'sandbox' | 'production';
}

/** What the app does when the person acts on the system call screen. */
export interface NativeCallHandlers {
  /** Answered from CallKit / the system UI. */
  onAnswer(callId: string): void;
  /** Declined or hung up from CallKit / the system UI. */
  onEnd(callId: string): void;
  /** A VoIP / FCM call push reached the running app. */
  onPush(push: NativeCallPush): void;
}

export interface NativeCallKit {
  /** False in Expo Go, on web, in tests and in builds without the native modules. */
  readonly available: boolean;
  /** Wires system call events to the app. Returns a cleanup. */
  init(handlers: NativeCallHandlers): () => void;
  /** Starts token registration; `upload` is called with every new token. Returns a cleanup. */
  registerToken(upload: (token: NativeCallToken) => void): () => void;
  /** The call was answered inside the app (keeps the system call in sync). */
  reportAnswered(callId: string): void;
  /** Ends the system call (remote hang-up, decline elsewhere, missed, media ended). */
  endCall(callId: string, reason: NativeEndReason): void;
}

/** CallKit / ConnectionService end reasons (react-native-callkeep reportEndCallWithUUID codes). */
export const NATIVE_END_REASON = {
  failed: 1,
  remoteEnded: 2,
  unanswered: 3,
  answeredElsewhere: 4,
  declinedElsewhere: 5,
} as const;
export type NativeEndReason = keyof typeof NATIVE_END_REASON;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/**
 * Accepts the raw push dictionary (APNs) or FCM data map; returns null for
 * anything that isn't a DM call push. Never throws.
 */
export function parseNativeCallPush(raw: unknown): NativeCallPush | null {
  try {
    let data: unknown = raw;
    if (typeof data === 'string') data = JSON.parse(data);
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    const type = d.type;
    if (type !== 'dm_call_incoming' && type !== 'dm_call_ended') return null;
    const callId = str(d.callId);
    if (!callId || !UUID_RE.test(callId)) return null; // CallKit needs a UUID
    return {
      type,
      callId: callId.toLowerCase(),
      conversationId: str(d.conversationId),
      calleeId: str(d.calleeId),
      callerId: str(d.callerId),
      callerName: str(d.callerName) ?? 'Brandthread',
      callerAvatar: str(d.callerAvatar),
      hasVideo: bool(d.hasVideo),
      reason: str(d.reason),
    };
  } catch {
    return null;
  }
}

/**
 * Is this push for the account signed in on this device right now?
 * 'ring' only when someone is signed in and the push names that same user
 * (a push without calleeId — an older server — is trusted when signed in).
 * 'reject' when signed out, or signed into a different account: the ring was
 * meant for the previous account on this phone. iOS still has to report a
 * rejected VoIP push to CallKit (Apple requirement) and ends it at once with
 * a generic name (AppDelegate.swift, plugins/with-voip-callkit.js);
 * Android just ignores it.
 */
export function nativeRingDecision(pushCalleeId: string | null | undefined, signedInUserId: string | null | undefined): 'ring' | 'reject' {
  if (!signedInUserId) return 'reject';
  if (pushCalleeId && pushCalleeId !== signedInUserId) return 'reject';
  return 'ring';
}

/** Server end reason (push / call record) → system end reason. */
export function nativeEndReasonFor(reason: string | null | undefined): NativeEndReason {
  switch (reason) {
    case 'answered_elsewhere': return 'answeredElsewhere';
    case 'declined': return 'declinedElsewhere';
    case 'missed': return 'unanswered';
    case 'failed': return 'failed';
    default: return 'remoteEnded';
  }
}

/** The app's CallSession end reason → system end reason. */
export function nativeEndReasonForSession(endReason: string | undefined, connected: boolean): NativeEndReason {
  if (endReason === 'failed') return 'failed';
  if (endReason === 'missed') return 'unanswered';
  if (!connected && endReason === 'declined') return 'declinedElsewhere';
  return 'remoteEnded';
}

/**
 * Loads an optional native-backed JS package safely: null when the package
 * can't be required (web / tests), or when its native module isn't linked in
 * this binary (Expo Go, an older build). `hasNative` checks the latter.
 */
export function loadOptionalNative<T>(load: () => T, hasNative: () => boolean): T | null {
  try {
    if (!hasNative()) return null;
    const mod = load() as T & { default?: T };
    return (mod && (mod as { default?: T }).default) || mod || null;
  } catch {
    return null;
  }
}

/** EXPO_PUBLIC_NATIVE_CALLS=0 switches the native ring off without a release. */
export function nativeCallsFlagEnabled(value: string | undefined): boolean {
  return value !== '0' && value !== 'false';
}

/** A no-op implementation for web, Expo Go, tests and builds without the modules. */
export const inertNativeCallKit: NativeCallKit = {
  available: false,
  init: () => () => {},
  registerToken: () => () => {},
  reportAnswered: () => {},
  endCall: () => {},
};
