import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';

/**
 * A random id for this install of the app. On iOS it lives in the Keychain,
 * which survives deleting and reinstalling the app, so server-side "one per
 * device" allowances (the onboarding AI sample) can't be reset by a reinstall.
 * Web and storage failures fall back to AsyncStorage. Never sent anywhere but
 * our own API.
 */
const INSTALL_ID_KEY = 'bt_install_id';
let cached: string | null = null;

async function readSecure(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try { return await SecureStore.getItemAsync(INSTALL_ID_KEY); } catch { return null; }
}

async function writeSecure(value: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try { await SecureStore.setItemAsync(INSTALL_ID_KEY, value); } catch { /* fall back to AsyncStorage */ }
}

export async function getInstallId(): Promise<string> {
  if (cached) return cached;
  const secure = await readSecure();
  if (secure) { cached = secure; return secure; }
  let local: string | null = null;
  try { local = await AsyncStorage.getItem(INSTALL_ID_KEY); } catch { /* ignore */ }
  const id = local || randomUUID();
  await writeSecure(id);
  if (!local) {
    try { await AsyncStorage.setItem(INSTALL_ID_KEY, id); } catch { /* ignore */ }
  }
  cached = id;
  return id;
}
