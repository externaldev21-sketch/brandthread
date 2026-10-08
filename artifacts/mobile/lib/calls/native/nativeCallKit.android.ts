/**
 * Android: self-managed ConnectionService (react-native-callkeep) fed by a
 * high-priority FCM data message from api-server/src/lib/voipPush.ts. The
 * FCM token comes from expo-notifications' getDevicePushTokenAsync (needs
 * google-services.json in the build). When the app is killed the headless
 * task in registerBackgroundCallTask.android.ts handles the push; while it
 * runs, this module does.
 *
 * Inert when react-native-callkeep's native module isn't in the binary
 * (Expo Go, an older build) or EXPO_PUBLIC_NATIVE_CALLS=0.
 */
import {
  inertNativeCallKit,
  nativeRingDecision,
  parseNativeCallPush,
  type NativeCallKit,
} from './nativeCallCore';
import { getCallUserId } from './callIdentity';
import {
  androidCallKeep,
  displayAndroidIncomingCall,
  endAndroidCall,
  fcmDataOf,
  setupAndroidCallKeep,
  type AndroidCallKeep,
} from './androidCallKeep';

function loadNotifications(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications');
  } catch {
    return null;
  }
}

function makeAndroidCallKit(ck: AndroidCallKeep): NativeCallKit {
  return {
    available: true,

    init(handlers) {
      void setupAndroidCallKeep(ck);
      const subs: Array<{ remove(): void }> = [
        ck.addEventListener('answerCall', ({ callUUID }: { callUUID: string }) => handlers.onAnswer(String(callUUID).toLowerCase())),
        ck.addEventListener('endCall', ({ callUUID }: { callUUID: string }) => handlers.onEnd(String(callUUID).toLowerCase())),
      ];
      const Notifications = loadNotifications();
      if (Notifications) {
        try {
          // A data-only FCM message while the app is running.
          subs.push(Notifications.addNotificationReceivedListener((n: any) => {
            const push = parseNativeCallPush(fcmDataOf(n?.request?.content?.data ?? n?.request?.trigger?.remoteMessage?.data));
            if (!push) return;
            void getCallUserId().then((userId) => {
              if (nativeRingDecision(push.calleeId, userId) === 'reject') return;
              if (push.type === 'dm_call_incoming') displayAndroidIncomingCall(ck, push);
              handlers.onPush(push);
            });
          }));
        } catch { /* notifications unavailable */ }
      }
      return () => subs.forEach((s) => { try { s.remove(); } catch { /* removed */ } });
    },

    registerToken(upload) {
      const Notifications = loadNotifications();
      if (!Notifications) return () => {};
      let cancelled = false;
      const send = (t: { type?: string; data?: unknown } | null | undefined) => {
        if (!cancelled && t && typeof t.data === 'string' && t.data) {
          upload({ token: t.data, platform: 'android', kind: 'fcm' });
        }
      };
      Notifications.getDevicePushTokenAsync().then(send).catch(() => { /* no Firebase config in this build */ });
      let sub: { remove(): void } | null = null;
      try { sub = Notifications.addPushTokenListener(send); } catch { sub = null; }
      return () => { cancelled = true; sub?.remove(); };
    },

    reportAnswered(callId) {
      try { ck.setCurrentCallActive(callId); } catch { /* no system call for this id */ }
    },

    endCall(callId, reason) {
      endAndroidCall(ck, callId, reason);
    },
  };
}

export const nativeCallKit: NativeCallKit = androidCallKeep ? makeAndroidCallKit(androidCallKeep) : inertNativeCallKit;
