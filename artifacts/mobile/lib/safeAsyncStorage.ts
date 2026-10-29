/**
 * AsyncStorage's web implementation is a thin wrapper directly over
 * `window.localStorage` (see @react-native-async-storage/async-storage's
 * lib/commonjs/AsyncStorage.js — no try/catch of its own). `localStorage`
 * throws synchronously in some real embedding contexts — a cross-origin or
 * `sandbox`-restricted iframe (the kind a hosting platform's preview pane
 * can use), Safari ITP under third-party storage blocking, or a quota
 * error from an already-full origin — and none of that is hypothetical:
 * it is the same class of failure previously seen as "Add to cart shows
 * success but the Cart screen is empty," because the write silently threw
 * past a bare `await AsyncStorage.setItem(...)` with no fallback.
 *
 * This wraps get/set/remove with a same-tab, in-memory fallback so a
 * blocked or throwing persistent store degrades to "works for this page
 * load" instead of "the write vanished and nothing downstream ever finds
 * out." The fallback is per call: a single failure (one quota error on a
 * write) must not strand everything persisted earlier, so reads keep going
 * to the real store and only a key whose own latest write/remove failed to
 * persist is answered from this tab's memory. Real cross-reload durability
 * still requires working browser storage — a platform limitation this
 * can't solve, not a bug in the write path.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Mirror of every value written (or successfully read) in this tab. */
const memoryFallback = new Map<string, string>();
/** Keys whose latest write (string) or remove (null) did not reach storage. */
const unpersisted = new Map<string, string | null>();
let storageBlocked = false;

export async function safeGetItem(key: string): Promise<string | null> {
  // This tab's latest write never reached storage: storage holds an older value.
  if (unpersisted.has(key)) return unpersisted.get(key) ?? null;
  if (!storageBlocked) {
    try {
      const value = await AsyncStorage.getItem(key);
      if (value !== null) memoryFallback.set(key, value);
      return value;
    } catch {
      /* fall through to this tab's copy for this call only */
    }
  }
  return memoryFallback.has(key) ? (memoryFallback.get(key) as string) : null;
}

export async function safeSetItem(key: string, value: string): Promise<void> {
  // Always mirrored in memory first — a subsequent read in this tab must
  // see it even if the persistent write below throws.
  memoryFallback.set(key, value);
  if (storageBlocked) { unpersisted.set(key, value); return; }
  try {
    await AsyncStorage.setItem(key, value);
    unpersisted.delete(key);
  } catch {
    unpersisted.set(key, value);
  }
}

export async function safeRemoveItem(key: string): Promise<void> {
  memoryFallback.delete(key);
  if (storageBlocked) { unpersisted.set(key, null); return; }
  try {
    await AsyncStorage.removeItem(key);
    unpersisted.delete(key);
  } catch {
    unpersisted.set(key, null);
  }
}

/** Test-only: resets the blocked flag and clears the in-memory fallback. */
export function __resetSafeStorageForTests(): void {
  storageBlocked = false;
  memoryFallback.clear();
  unpersisted.clear();
}

/** Test-only: forces every call to go through the in-memory fallback. */
export function __forceStorageBlockedForTests(blocked: boolean): void {
  storageBlocked = blocked;
}
