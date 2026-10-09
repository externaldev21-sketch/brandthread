/**
 * Native push permission is deliberately requested only after a meaningful,
 * server-backed action.  The marker is scoped to the Clerk ID so a decision
 * made by one account on a shared device never affects another account.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

const ONBOARDING_KEY = 'onboarding_complete';
const ONBOARDING_OWNER_KEY = 'onboarding_owner_id';
const requestedKey = (userId: string) => `bt:push:permission-requested:v1:${userId}`;

type PushApi = {
  push: { register: (body: { token: string; platform?: string; accountIds?: string[] }) => Promise<unknown> };
};

let signedInAccountIds: string[] = [];

/**
 * Every account signed in on this device (account switcher). Sent with each
 * registration so each account keeps getting its own pushes here, and an
 * account signed out on this device stops getting them.
 */
export function setSignedInAccountIds(ids: readonly string[]): void {
  signedInAccountIds = [...new Set(ids.filter(Boolean))];
}

async function isOnboardedUser(userId: string): Promise<boolean> {
  const [[, complete], [, owner]] = await AsyncStorage.multiGet([
    ONBOARDING_KEY,
    ONBOARDING_OWNER_KEY,
  ]);
  return complete === 'true' && owner === userId;
}

async function registerToken(api: PushApi): Promise<void> {
  const token = await Notifications.getExpoPushTokenAsync();
  await api.push.register({ token: token.data, platform: Platform.OS, accountIds: signedInAccountIds });
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
 * Call only after a real remote value event has succeeded. A prior denial (or
 * prior OS request) is remembered per user, preventing repeated prompts.
 */
export async function requestContextualPushPermission(
  userId: string | null | undefined,
  api: PushApi,
): Promise<void> {
  if (Platform.OS === 'web' || !userId || !(await isOnboardedUser(userId))) return;
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

    // Mark before requesting to handle concurrent successful actions and a
    // dismissal/denial consistently across relaunches.
    if (await AsyncStorage.getItem(requestedKey(userId))) return;
    await AsyncStorage.setItem(requestedKey(userId), 'true');
    const result = await Notifications.requestPermissionsAsync();
    if (result.status === 'granted') await registerToken(api);
  } catch {
    // Permission and registration are intentionally non-blocking.
  }
}