/**
 * Native push permission is deliberately requested only after a meaningful,
 * server-backed action.  The marker is scoped to the Clerk ID so a decision
 * made by one account on a shared device never affects another account.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  parseDeclines,
  prePromptAllowed,
  showPushPrePrompt,
  type PushPrePromptReason,
} from './pushPrePrompt';

const ONBOARDING_KEY = 'onboarding_complete';
const ONBOARDING_OWNER_KEY = 'onboarding_owner_id';
const requestedKey = (userId: string) => `bt:push:permission-requested:v1:${userId}`;
const declinedKey = (userId: string) => `bt:push:preprompt-declined:v1:${userId}`;
let prompting = false;

type PushApi = {
  push: { register: (body: { token: string; platform?: string }) => Promise<unknown> };
};

async function isOnboardedUser(userId: string): Promise<boolean> {
  const [[, complete], [, owner]] = await AsyncStorage.multiGet([
    ONBOARDING_KEY,
    ONBOARDING_OWNER_KEY,
  ]);
  return complete === 'true' && owner === userId;
}

async function registerToken(api: PushApi): Promise<void> {
  const token = await Notifications.getExpoPushTokenAsync();
  await api.push.register({ token: token.data, platform: 'expo' });
}

/**
 * Register silently when access already exists. This is safe to call at app
 * startup; it never shows the operating-system permission dialog.
 */
export async function registerGrantedPushToken(
  userId: string | null | undefined,
  api: PushApi,
): Promise<void> {
  if (Platform.OS === 'web' || !userId || !(await isOnboardedUser(userId))) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') await registerToken(api);
  } catch {
    // Push is optional; the next eligible event/session can retry registration.
  }
}

/**
 * Call only after a real remote value event has succeeded (first follow,
 * first order, first message). A short sheet explains why first; the OS
 * dialog appears only after "Turn on notifications". "Not now" is paced
 * (lib/pushPrePrompt.ts). A prior OS request is remembered per user,
 * preventing repeated system prompts.
 */
export async function requestContextualPushPermission(
  userId: string | null | undefined,
  api: PushApi,
  reason: PushPrePromptReason = 'general',
): Promise<void> {
  if (Platform.OS === 'web' || !userId || !(await isOnboardedUser(userId))) return;
  let ownsPrompt = false;
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status === 'granted') {
      await registerToken(api);
      return;
    }
    if (permission.canAskAgain === false) {
      await AsyncStorage.setItem(requestedKey(userId), 'true');
      return;
    }

    if (await AsyncStorage.getItem(requestedKey(userId))) return;
    if (prompting) return;
    const declines = parseDeclines(await AsyncStorage.getItem(declinedKey(userId)));
    if (!prePromptAllowed(declines, Date.now())) return;

    prompting = true;
    ownsPrompt = true;
    const accepted = await showPushPrePrompt(reason);
    if (!accepted) {
      await AsyncStorage.setItem(declinedKey(userId), JSON.stringify({ count: declines.count + 1, lastAt: Date.now() }));
      return;
    }
    // Mark before requesting to handle concurrent successful actions and a
    // dismissal/denial consistently across relaunches.
    await AsyncStorage.setItem(requestedKey(userId), 'true');
    const result = await Notifications.requestPermissionsAsync();
    if (result.status === 'granted') await registerToken(api);
  } catch {
    // Permission and registration are intentionally non-blocking.
  } finally {
    if (ownsPrompt) prompting = false;
  }
}