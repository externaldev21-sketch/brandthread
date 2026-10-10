/**
 * Android ConnectionService (react-native-callkeep, SELF-MANAGED mode — no
 * "phone account" prompt, only RECORD_AUDIO) shared by the foreground module
 * (nativeCallKit.android.ts) and the headless FCM task
 * (registerBackgroundCallTask.android.ts). Only imported from Android files.
 *
 * Self-managed means the app draws the ringing UI: that is the existing
 * high-priority "calls" notification (#698) plus the in-app incoming-call
 * screen. The ConnectionService call makes Android treat it as a real call
 * (audio focus, Bluetooth headset answer, not cut off by a GSM call), and the
 * stale "Incoming call" notification is cleared when the call ends elsewhere.
 */
import { NativeModules } from 'react-native';
import {
  NATIVE_END_REASON,
  loadOptionalNative,
  nativeCallsFlagEnabled,
  type NativeCallPush,
  type NativeEndReason,
} from './nativeCallCore';

export type AndroidCallKeep = {
  setup(options: Record<string, unknown>): Promise<boolean>;
  setAvailable(available: boolean): void;
  addEventListener(type: string, handler: (payload: any) => void): { remove(): void };
  displayIncomingCall(uuid: string, handle: string, localizedCallerName?: string, handleType?: string, hasVideo?: boolean): void;
  setCurrentCallActive(uuid: string): void;
  reportEndCallWithUUID(uuid: string, reason: number): void;
};

export const androidCallKeep: AndroidCallKeep | null = nativeCallsFlagEnabled(process.env.EXPO_PUBLIC_NATIVE_CALLS)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ? loadOptionalNative<AndroidCallKeep>(() => require('react-native-callkeep'), () => !!NativeModules.RNCallKeep)
  : null;

let setupDone: Promise<unknown> | null = null;
export function setupAndroidCallKeep(ck: AndroidCallKeep): Promise<unknown> {
  if (!setupDone) {
    setupDone = ck.setup({
      ios: { appName: 'Brandthread' },
      android: {
        selfManaged: true,
        alertTitle: 'Calls',
        alertDescription: '',
        cancelButton: 'Cancel',
        okButton: 'OK',
        additionalPermissions: [],
        foregroundService: {
          channelId: 'calls',
          channelName: 'Calls',
          notificationTitle: 'Brandthread call',
        },
      },
    }).then((r) => { try { ck.setAvailable(true); } catch { /* older native */ } return r; })
      .catch(() => false);
  }
  return setupDone;
}

export function displayAndroidIncomingCall(ck: AndroidCallKeep, push: NativeCallPush): void {
  void setupAndroidCallKeep(ck).then(() => {
    try { ck.displayIncomingCall(push.callId, push.callerName, push.callerName, 'generic', push.hasVideo); } catch { /* ignore */ }
  });
}

export function endAndroidCall(ck: AndroidCallKeep | null, callId: string, reason: NativeEndReason): void {
  try { ck?.reportEndCallWithUUID(callId, NATIVE_END_REASON[reason]); } catch { /* already ended */ }
  void dismissCallNotifications(callId);
}

/** Clears the "Incoming call" notification(s) for a call that ended elsewhere. */
export async function dismissCallNotifications(callId: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications');
    const presented: Array<{ request: { identifier: string; content: { data?: Record<string, unknown> } } }> =
      await Notifications.getPresentedNotificationsAsync();
    await Promise.all(presented
      .filter((n) => {
        const d = n.request.content.data ?? {};
        return d.type === 'dm_call_incoming' && (d.callId === callId || d.targetId === callId);
      })
      .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)));
  } catch { /* notifications unavailable */ }
}

/** The data map of a headless / foreground FCM message (direct FCM or Expo-wrapped). */
export function fcmDataOf(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const d = raw as { dataString?: unknown; data?: unknown };
  if (typeof d.dataString === 'string') {
    try { return JSON.parse(d.dataString); } catch { return raw; }
  }
  return raw;
}
