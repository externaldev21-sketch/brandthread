/**
 * orderBadgeStore — per-seller in-memory store for the new-order tab badge.
 *
 * All state is keyed by the authenticated Clerk userId so the badge is always
 * scoped to the current seller.  AsyncStorage keys follow the same pattern
 * (`bt:orders:lastViewed:<userId>`) so switching accounts on the same device
 * never leaks one seller's watermark into another seller's badge.
 *
 * Consumers:
 *   _layout.tsx — subscribes, polls GET /api/orders, renders the badge
 *   orders.tsx  — calls clearBadge(userId) on focus to zero the count instantly
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Per-user state ────────────────────────────────────────────────────────────

interface UserBadgeState {
  count: number;
  lastViewedAt: number; // ms epoch; 0 = "never viewed"
}

const _state = new Map<string, UserBadgeState>();
const _initialized = new Set<string>();
const _listeners = new Set<() => void>();

function _getOrCreate(userId: string): UserBadgeState {
  if (!_state.has(userId)) {
    _state.set(userId, { count: 0, lastViewedAt: 0 });
  }
  return _state.get(userId)!;
}

function _notify(): void {
  _listeners.forEach((l) => l());
}

function _storageKey(userId: string): string {
  return `bt:orders:lastViewed:${userId}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Read the current badge count for a seller synchronously. */
export function getBadgeCount(userId: string): number {
  return _getOrCreate(userId).count;
}

/** Read the last-viewed watermark for a seller synchronously (ms epoch). */
export function getLastViewedAt(userId: string): number {
  return _getOrCreate(userId).lastViewedAt;
}

/**
 * Update the badge count from a polling result for a specific seller.
 * `cutoffMs` is the epoch ms recorded before the fetch started.  If the seller
 * opened Orders while the request was in-flight, clearBadge() will have
 * advanced lastViewedAt past cutoffMs, and we discard this stale result.
 */
export function setBadgeCount(userId: string, n: number, cutoffMs: number): void {
  const s = _getOrCreate(userId);
  if (cutoffMs < s.lastViewedAt) return; // stale poll — seller already opened Orders
  s.count = n;
  _notify();
}

/**
 * Called when the Orders screen is focused.
 * Immediately zeros the badge and advances the watermark so subsequent polls
 * only count orders placed after this moment.
 */
export function clearBadge(userId: string): void {
  const s = _getOrCreate(userId);
  s.lastViewedAt = Date.now();
  s.count = 0;
  _notify();
  // Persist watermark for the next app launch.
  AsyncStorage.setItem(_storageKey(userId), String(s.lastViewedAt)).catch(() => {});
}

/**
 * Hydrate lastViewedAt from AsyncStorage for the given seller.
 * Safe to call multiple times — only runs once per userId per session.
 */
export async function initFromStorage(userId: string): Promise<void> {
  if (_initialized.has(userId)) return;
  _initialized.add(userId);
  try {
    const raw = await AsyncStorage.getItem(_storageKey(userId));
    const s = _getOrCreate(userId);
    if (raw && s.lastViewedAt === 0) {
      // Only apply stored value if clearBadge() hasn't already set a later one.
      s.lastViewedAt = parseInt(raw, 10) || 0;
    }
  } catch { /* ignore */ }
}

/** Subscribe to any badge change; returns an unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}
