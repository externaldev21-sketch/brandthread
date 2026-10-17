import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Clerk token cache. "Save login info" (Settings → Password and security)
 * decides whether the session token is written to the device's secure
 * storage (survives an app restart) or only kept in memory for this launch
 * (closing the app signs you out). The choice itself is a device-local flag,
 * read before Clerk loads, so it applies from the very next launch.
 */
const SAVE_LOGIN_FLAG_KEY = 'bt_save_login_info';
const memory = new Map<string, string>();
let saveLoginCached: boolean | null = null;

async function readPersisted(key: string): Promise<string | null> {
  return Platform.OS === 'web' ? (localStorage.getItem(key) ?? null) : SecureStore.getItemAsync(key);
}
async function writePersisted(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') localStorage.setItem(key, value);
  else await SecureStore.setItemAsync(key, value);
}
async function deletePersisted(key: string): Promise<void> {
  if (Platform.OS === 'web') localStorage.removeItem(key);
  else await SecureStore.deleteItemAsync(key);
}

export async function isSaveLoginInfoEnabled(): Promise<boolean> {
  if (saveLoginCached !== null) return saveLoginCached;
  try {
    saveLoginCached = (await readPersisted(SAVE_LOGIN_FLAG_KEY)) !== 'false';
  } catch {
    saveLoginCached = true;
  }
  return saveLoginCached;
}

/**
 * Applies "Save login info" on this device. Turning it off moves the current
 * session tokens out of secure storage into memory (you stay signed in until
 * the app is closed); turning it on writes them back.
 */
export async function setSaveLoginInfo(enabled: boolean): Promise<void> {
  const before = await isSaveLoginInfoEnabled();
  saveLoginCached = enabled;
  await writePersisted(SAVE_LOGIN_FLAG_KEY, enabled ? 'true' : 'false');
  if (before === enabled) return;
  for (const [key, value] of memory) {
    if (enabled) await writePersisted(key, value);
    else await deletePersisted(key);
  }
}

export const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    if (memory.has(key)) return memory.get(key) ?? null;
    try {
      if (!(await isSaveLoginInfoEnabled())) return null;
      const value = await readPersisted(key);
      if (value !== null) memory.set(key, value);
      return value;
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    memory.set(key, value);
    try {
      if (await isSaveLoginInfoEnabled()) await writePersisted(key, value);
      else await deletePersisted(key);
    } catch {}
  },
  async clearToken(key: string): Promise<void> {
    memory.delete(key);
    try {
      await deletePersisted(key);
    } catch {}
  },
};

/** Test-only reset of the in-memory state. */
export function resetTokenCacheForTests(): void {
  memory.clear();
  saveLoginCached = null;
}
