/**
 * Persistence for the reusable <FirstRunTip> system.
 *
 * Server (migration 110: first_run_tips_seen / first_run_tips_settings) is
 * the source of truth, so a tip already seen stays seen across reinstalls,
 * new devices and cleared local storage — mirrors the pattern established by
 * lib/feedGestureGuideStorage.ts for the feed's own gesture coach mark.
 *
 * A local AsyncStorage cache lets a screen know a tip's seen-state INSTANTLY
 * on mount (no network round-trip before deciding whether to render it), and
 * is synced from the server fetch. Dismissing a tip updates the local cache
 * optimistically before the server write resolves — the server call is
 * fire-and-forget, never blocking the dismiss animation.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface FirstRunTipsApi {
  firstRunTips: {
    get: () => Promise<{ seenTipIds: string[]; skipAll: boolean }>;
    markSeen: (tipId: string) => Promise<void>;
    skipAll: () => Promise<void>;
    reset: () => Promise<void>;
  };
}

function seenKey(userId: string | null | undefined): string {
  return `first_run_tips_seen:${userId ?? 'anon'}`;
}

function skipAllKey(userId: string | null | undefined): string {
  return `first_run_tips_skip_all:${userId ?? 'anon'}`;
}

async function readLocalSeenSet(userId: string | null | undefined): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(seenKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

async function writeLocalSeenSet(userId: string | null | undefined, ids: Set<string>): Promise<void> {
  try { await AsyncStorage.setItem(seenKey(userId), JSON.stringify([...ids])); } catch {}
}

async function readLocalSkipAll(userId: string | null | undefined): Promise<boolean> {
  try { return (await AsyncStorage.getItem(skipAllKey(userId))) === '1'; } catch { return false; }
}

async function writeLocalSkipAll(userId: string | null | undefined, value: boolean): Promise<void> {
  try { await AsyncStorage.setItem(skipAllKey(userId), value ? '1' : '0'); } catch {}
}

export interface FirstRunTipsLocalState {
  seenIds: Set<string>;
  skipAll: boolean;
}

/** Fast, offline-safe read used to paint the very first frame. */
export async function readLocalFirstRunTipsState(userId: string | null | undefined): Promise<FirstRunTipsLocalState> {
  const [seenIds, skipAll] = await Promise.all([readLocalSeenSet(userId), readLocalSkipAll(userId)]);
  return { seenIds, skipAll };
}

/**
 * Pulls the real server state (source of truth) and reconciles it into the
 * local cache, returning the merged result. Falls back silently to whatever
 * is already local on any network/API failure — a first-run tip must never
 * hard-block a screen on a failed fetch.
 */
export async function syncFirstRunTipsFromServer(
  userId: string | null | undefined,
  api: FirstRunTipsApi,
): Promise<FirstRunTipsLocalState> {
  try {
    const { seenTipIds, skipAll } = await api.firstRunTips.get();
    const seenIds = new Set(seenTipIds);
    await Promise.all([writeLocalSeenSet(userId, seenIds), writeLocalSkipAll(userId, skipAll)]);
    return { seenIds, skipAll };
  } catch {
    return readLocalFirstRunTipsState(userId);
  }
}

/**
 * Marks one tip seen. Updates the local cache immediately (so the caller can
 * hide the tip without waiting) and fires the server write in the
 * background — never awaited by the dismiss path.
 */
export function markTipSeen(
  userId: string | null | undefined,
  tipId: string,
  current: FirstRunTipsLocalState,
  api?: FirstRunTipsApi,
): FirstRunTipsLocalState {
  const seenIds = new Set(current.seenIds);
  seenIds.add(tipId);
  void writeLocalSeenSet(userId, seenIds);
  if (api) void api.firstRunTips.markSeen(tipId).catch(() => {});
  return { ...current, seenIds };
}

/** "Skip all tips" — suppresses every future first-run tip for this account. */
export function setSkipAllTips(
  userId: string | null | undefined,
  current: FirstRunTipsLocalState,
  api?: FirstRunTipsApi,
): FirstRunTipsLocalState {
  void writeLocalSkipAll(userId, true);
  if (api) void api.firstRunTips.skipAll().catch(() => {});
  return { ...current, skipAll: true };
}

/** "Replay tips" (Settings) — a genuine reset of all seen-state, local and server. */
export async function replayAllTips(
  userId: string | null | undefined,
  api?: FirstRunTipsApi,
): Promise<FirstRunTipsLocalState> {
  await Promise.all([writeLocalSeenSet(userId, new Set()), writeLocalSkipAll(userId, false)]);
  if (api) {
    try { await api.firstRunTips.reset(); } catch { /* local reset still took effect */ }
  }
  return { seenIds: new Set(), skipAll: false };
}
