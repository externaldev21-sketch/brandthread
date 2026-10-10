/**
 * The Clerk user id native call ringing is allowed to ring for — the account
 * currently signed in on this device, or none. Written by CallSessionProvider
 * on sign-in / sign-out and read where the app may not be running React yet:
 *   • iOS: NSUserDefaults key `bt.callUserId` (RN Settings), read natively by
 *     AppDelegate.swift when a VoIP push arrives (plugins/with-voip-callkit.js).
 *   • Android: AsyncStorage, read by the headless FCM task.
 * A push whose calleeId doesn't match (or arrives signed out) doesn't ring
 * (nativeRingDecision in nativeCallCore.ts).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Settings } from 'react-native';

export const CALL_USER_ID_KEY = 'bt.callUserId';

export async function setCallUserId(userId: string | null): Promise<void> {
  try {
    if (Platform.OS === 'ios') Settings?.set?.({ [CALL_USER_ID_KEY]: userId ?? '' });
  } catch { /* Settings unavailable */ }
  try {
    if (userId) await AsyncStorage.setItem(CALL_USER_ID_KEY, userId);
    else await AsyncStorage.removeItem(CALL_USER_ID_KEY);
  } catch { /* storage unavailable */ }
}

export async function getCallUserId(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(CALL_USER_ID_KEY);
    return value || null;
  } catch {
    return null;
  }
}
