/**
 * Android headless FCM handler for DM calls. A HIGH-priority data message
 * from api-server/src/lib/voipPush.ts wakes the app even when it was killed;
 * expo-task-manager runs this task (expo-notifications registerTaskAsync),
 * which shows the self-managed ConnectionService call or ends it.
 * Imported from lib/bootstrap.ts so it is defined before anything renders.
 * Does nothing without react-native-callkeep's native module.
 */
import { nativeEndReasonFor, nativeRingDecision, parseNativeCallPush } from './nativeCallCore';
import { getCallUserId } from './callIdentity';
import { androidCallKeep, displayAndroidIncomingCall, endAndroidCall, fcmDataOf } from './androidCallKeep';

export const CALL_PUSH_TASK = 'brandthread-dm-call-push';

if (androidCallKeep) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TaskManager = require('expo-task-manager');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications');
    if (!TaskManager.isTaskDefined(CALL_PUSH_TASK)) {
      TaskManager.defineTask(CALL_PUSH_TASK, async ({ data }: { data?: any }) => {
        if (!data || 'actionIdentifier' in data) return;
        const push = parseNativeCallPush(fcmDataOf(data.data ?? data));
        if (!push) return;
        // Signed out, or signed into another account since: not this device's call.
        if (nativeRingDecision(push.calleeId, await getCallUserId()) === 'reject') return;
        if (push.type === 'dm_call_incoming') displayAndroidIncomingCall(androidCallKeep!, push);
        else endAndroidCall(androidCallKeep, push.callId, nativeEndReasonFor(push.reason));
      });
    }
    Notifications.registerTaskAsync(CALL_PUSH_TASK).catch(() => { /* task manager unavailable */ });
  } catch { /* expo-task-manager not in this build */ }
}
