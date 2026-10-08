/**
 * iOS: CallKit (react-native-callkeep) + PushKit VoIP tokens
 * (react-native-voip-push-notification).
 *
 * The incoming call is reported to CallKit natively, in AppDelegate.swift
 * (plugins/with-voip-callkit.js), the moment the VoIP push lands — that is
 * what Apple requires and what lets a killed app ring. This module is the JS
 * half: it uploads the VoIP token, turns CallKit answer / end actions into
 * the app's existing accept / decline / end calls (CallSessionContext), and
 * ends the CallKit call when the app's call ends.
 *
 * Inert (inertNativeCallKit) when the native modules aren't in the binary:
 * Expo Go, web, an older build, or EXPO_PUBLIC_NATIVE_CALLS=0.
 */
import { NativeModules } from 'react-native';
import {
  NATIVE_END_REASON,
  inertNativeCallKit,
  loadOptionalNative,
  nativeCallsFlagEnabled,
  parseNativeCallPush,
  type NativeCallKit,
} from './nativeCallCore';

type CallKeep = {
  setup(options: Record<string, unknown>): Promise<boolean>;
  addEventListener(type: string, handler: (payload: any) => void): { remove(): void };
  answerIncomingCall(uuid: string): void;
  reportEndCallWithUUID(uuid: string, reason: number): void;
  getInitialEvents?(): Promise<Array<{ name: string; data: any }>>;
  clearInitialEvents?(): void;
};
type VoipPush = {
  addEventListener(type: 'register' | 'notification' | 'didLoadWithEvents', handler: (payload: any) => void): void;
  removeEventListener(type: 'register' | 'notification' | 'didLoadWithEvents'): void;
  registerVoipToken(): void;
};

const enabled = nativeCallsFlagEnabled(process.env.EXPO_PUBLIC_NATIVE_CALLS);
const CallKeepModule = enabled
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ? loadOptionalNative<CallKeep>(() => require('react-native-callkeep'), () => !!NativeModules.RNCallKeep)
  : null;
const VoipModule = enabled
  ? loadOptionalNative<VoipPush>(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    () => require('react-native-voip-push-notification'),
    () => !!NativeModules.RNVoipPushNotificationManager,
  )
  : null;

let setupDone: Promise<unknown> | null = null;
function setupOnce(ck: CallKeep): Promise<unknown> {
  if (!setupDone) {
    setupDone = ck.setup({
      ios: {
        appName: 'Brandthread',
        supportsVideo: true,
        maximumCallGroups: '1',
        maximumCallsPerCallGroup: '1',
        includesCallsInRecents: false,
      },
      // Required by callkeep's typings even on iOS; unused here.
      android: { alertTitle: 'Calls', alertDescription: '', cancelButton: 'Cancel', okButton: 'OK', selfManaged: true },
    }).catch(() => false);
  }
  return setupDone;
}

function makeIosCallKit(ck: CallKeep, voip: VoipPush): NativeCallKit {
  return {
    available: true,

    init(handlers) {
      void setupOnce(ck);
      const subs = [
        ck.addEventListener('answerCall', ({ callUUID }: { callUUID: string }) => handlers.onAnswer(String(callUUID).toLowerCase())),
        ck.addEventListener('endCall', ({ callUUID }: { callUUID: string }) => handlers.onEnd(String(callUUID).toLowerCase())),
        // Actions taken on the lock screen before JS was running (cold start).
        ck.addEventListener('didLoadWithEvents', (events: Array<{ name: string; data: any }>) => {
          for (const e of events ?? []) {
            const id = e?.data?.callUUID ? String(e.data.callUUID).toLowerCase() : null;
            if (!id) continue;
            if (e.name === 'RNCallKeepPerformAnswerCallAction') handlers.onAnswer(id);
            if (e.name === 'RNCallKeepPerformEndCallAction') handlers.onEnd(id);
          }
        }),
      ];
      const onPush = (payload: unknown) => {
        const push = parseNativeCallPush(payload);
        if (push) handlers.onPush(push);
      };
      voip.addEventListener('notification', onPush);
      voip.addEventListener('didLoadWithEvents', (events: Array<{ name: string; data: unknown }>) => {
        for (const e of events ?? []) {
          if (e?.name === 'RNVoipPushRemoteNotificationReceivedEvent') onPush(e.data);
        }
      });
      return () => {
        subs.forEach((s) => { try { s.remove(); } catch { /* already removed */ } });
        try { voip.removeEventListener('notification'); } catch { /* not registered */ }
        try { voip.removeEventListener('didLoadWithEvents'); } catch { /* not registered */ }
      };
    },

    registerToken(upload) {
      voip.addEventListener('register', (token: unknown) => {
        if (typeof token === 'string' && token) {
          // Development builds are signed with the sandbox aps-environment.
          upload({ token, platform: 'ios', kind: 'voip', environment: __DEV__ ? 'sandbox' : 'production' });
        }
      });
      // AppDelegate already registered with PushKit at launch; this re-emits the token.
      try { voip.registerVoipToken(); } catch { /* module unavailable */ }
      return () => { try { voip.removeEventListener('register'); } catch { /* not registered */ } };
    },

    reportAnswered(callId) {
      try { ck.answerIncomingCall(callId); } catch { /* no CallKit call for this id */ }
    },

    endCall(callId, reason) {
      try { ck.reportEndCallWithUUID(callId, NATIVE_END_REASON[reason]); } catch { /* already ended */ }
    },
  };
}

export const nativeCallKit: NativeCallKit = CallKeepModule && VoipModule
  ? makeIosCallKit(CallKeepModule, VoipModule)
  : inertNativeCallKit;
