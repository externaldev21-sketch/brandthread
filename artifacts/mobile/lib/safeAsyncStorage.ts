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
 * out." Once a call throws, every later call in this tab skips straight to
 * the fallback (no repeated failing round-trips) — real cross-reload
 * durability still requires working browser storage, but that's a
 * platform limitation this can't solve, not a bug in the write path.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const memoryFallback = new Map<string, string>();
let storageBlocked = false;

export async function safeGetItem(key: string): Promise<string | null> {
  if (!storageBlocked) {
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      storageBlocked = true;
    }
  }
  return memoryFallback.has(key) ? (memoryFallback.get(key) as string) : null;
}

export async function safeSetItem(key: string, value: string): Promise<void> {
  // Always mirrored in memory first — a subsequent read in this tab must
  // see it even if the persistent write below throws.
  memoryFallback.set(key, value);
  if (!storageBlocked) {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      storageBlocked = true;
    }
  }
}

export async function safeRemoveItem(key: string): Promise<void> {
  memoryFallback.delete(key);
  if (!storageBlocked) {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      storageBlocked = true;
    }
  }
}

/** Test-only: resets the blocked flag and clears the in-memory fallback. */
export function __resetSafeStorageForTests(): void {
  storageBlocked = false;
  memoryFallback.clear();
}

/** Test-only: forces every call to go through the in-memory fallback. */
export function __forceStorageBlockedForTests(blocked: boolean): void {
  storageBlocked = blocked;
}
