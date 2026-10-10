/**
 * useIsOffline — true ONLY while the device is actually offline.
 *
 * No native dependency is available (no netinfo / expo-network), so this
 * combines: web `online`/`offline` window events, and a reachability probe
 * (any HTTP response = reachable; only a thrown network error = offline).
 * The probe runs when the browser reports offline, when a failed read is
 * classified as a network-level failure (lib/networkNotice.ts), and — while
 * offline — on a short interval so the banner auto-dismisses on recovery.
 * Server 5xx never flips it. Starts online; a healthy connection never
 * triggers a probe at all.
 */
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { API_BASE_URL } from '@/lib/api';
import { getNetworkNotice, subscribeNetworkNotice } from '@/lib/networkNotice';
import {
  OFFLINE_POLL_MS,
  PROBE_TIMEOUT_MS,
  nextOffline,
  probeUrl,
  shouldProbe,
  type ConnectivityEvent,
} from '@/lib/offlineState';

let offline = false;
let started = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function apply(event: ConnectivityEvent) {
  const next = nextOffline(offline, event);
  if (next !== offline) {
    offline = next;
    syncPoll();
    emit();
  }
}

async function probe(): Promise<boolean> {
  const url = probeUrl(API_BASE_URL);
  if (!url) return true; // nothing to probe against: never claim offline
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS) : null;
  try {
    await fetch(url, { method: 'GET', cache: 'no-store', signal: controller?.signal });
    return true; // any HTTP status proves the network works
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Re-check connectivity now; resolves to the new offline flag. */
export async function recheckConnectivity(): Promise<boolean> {
  const reached = await probe();
  apply({ type: 'probe', reached });
  return offline;
}

function handle(event: ConnectivityEvent) {
  apply(event);
  if (shouldProbe(event)) void recheckConnectivity();
}

function syncPoll() {
  if (offline && !pollTimer) {
    pollTimer = setInterval(() => { void recheckConnectivity(); }, OFFLINE_POLL_MS);
  } else if (!offline && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function start() {
  if (started) return;
  started = true;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.addEventListener('offline', () => handle({ type: 'browser-offline' }));
    window.addEventListener('online', () => { apply({ type: 'browser-online' }); void recheckConnectivity(); });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) handle({ type: 'browser-offline' });
  }
  let lastId = getNetworkNotice()?.id;
  subscribeNetworkNotice(() => {
    const n = getNetworkNotice();
    if (n && n.id !== lastId && n.kind === 'offline') handle({ type: 'suspect-offline' });
    lastId = n?.id ?? lastId;
  });
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const getSnapshot = () => offline;

export function useIsOffline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
