/**
 * Real-time media for 1:1 DM calls (Agora). One engine instance per call,
 * created by lib/calls/agoraCallProvider.ts. Platform implementations:
 *   rtcEngine.ts      — iOS / Android, react-native-agora
 *   rtcEngine.web.ts  — web, agora-rtc-sdk-ng
 * Both expose the same surface so the provider and the video views never
 * branch on platform.
 */
import type { CallMode } from '../types';

export interface RtcCredentials {
  appId: string;
  token: string;
  channelName: string;
  uid: number;
  expiresAt?: string;
}

/** Observable media state the call UI renders from. */
export interface RtcMediaState {
  joined: boolean;
  /** Agora uid of the other participant once they're in the channel. */
  remoteUid: number | null;
  remoteVideoOn: boolean;
  localVideoOn: boolean;
}

export interface RtcEngineEvents {
  remoteJoined(uid: number): void;
  remoteLeft(uid: number): void;
  remoteVideoChanged(on: boolean): void;
  tokenWillExpire(): void;
  error(message: string): void;
}

export interface RtcEngine {
  readonly mode: CallMode;
  join(creds: RtcCredentials): Promise<void>;
  leave(): Promise<void>;
  setMuted(muted: boolean): void;
  setCameraOff(off: boolean): void;
  setSpeakerOn(on: boolean): void;
  switchCamera(): void;
  renewToken(token: string): void;
  getState(): RtcMediaState;
  /** Media-state changes (video views re-render from this). */
  onState(listener: (state: RtcMediaState) => void): () => void;
  /** Web only: hands the engine the DOM element a track should play into. No-op on native. */
  attachVideo(which: 'local' | 'remote', element: unknown | null): void;
}

export const INITIAL_RTC_STATE: RtcMediaState = {
  joined: false,
  remoteUid: null,
  remoteVideoOn: false,
  localVideoOn: false,
};

/** Tiny state holder shared by both platform engines. */
export function createRtcStateStore() {
  let state: RtcMediaState = { ...INITIAL_RTC_STATE };
  const listeners = new Set<(s: RtcMediaState) => void>();
  return {
    get: () => state,
    set(patch: Partial<RtcMediaState>) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l(state));
    },
    subscribe(listener: (s: RtcMediaState) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
