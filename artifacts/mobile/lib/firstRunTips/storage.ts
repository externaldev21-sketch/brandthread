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
    setSkipAll?: (skipAll: boolean) => Promise<void>;
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

/**
 * Fast, offline-safe read used to paint the very first frame. Tips seen while
 * the account id was still loading (stored under 'anon') count for the
 * account too, so a null → real userId switch can't show a tip twice.
 */
export async function readLocalFirstRunTipsState(userId: string | null | undefined): Promise<FirstRunTipsLocalState> {
  const [seenIds, skipAll] = await Promise.all([readLocalSeenSet(userId), readLocalSkipAll(userId)]);
  if (userId) {
    const [anonSeen, anonSkip] = await Promise.all([readLocalSeenSet(null), readLocalSkipAll(null)]);
    anonSeen.forEach((id) => seenIds.add(id));
    return { seenIds, skipAll: skipAll || anonSkip };
  }
  return { seenIds, skipAll };
}

/**
 * Pulls the server state and merges it with the local cache. Seen-state only
 * ever grows: the result is server ∪ local, so a server that missed a
 * markSeen (offline, no auth in a preview, a race) can't bring a tip back.
 * Whatever this device has that the server lacks is re-sent. Falls back
 * silently to the local state on any failure; a first-run tip must never
 * hard-block a screen on a failed fetch.
 */
export async function syncFirstRunTipsFromServer(
  userId: string | null | undefined,
  api: FirstRunTipsApi,
): Promise<FirstRunTipsLocalState> {
  const local = await readLocalFirstRunTipsState(userId);
  try {
    const server = await api.firstRunTips.get();
    const serverSeen = new Set(server.seenTipIds);
    const seenIds = new Set([...serverSeen, ...local.seenIds]);
    const skipAll = server.skipAll || local.skipAll;
    for (const id of local.seenIds) {
      if (!serverSeen.has(id)) void api.firstRunTips.markSeen(id).catch(() => {});
    }
    if (local.skipAll && !server.skipAll) void api.firstRunTips.skipAll().catch(() => {});
    await Promise.all([writeLocalSeenSet(userId, seenIds), writeLocalSkipAll(userId, skipAll)]);
    return { seenIds, skipAll };
  } catch {
    return local;
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

/**
 * Settings > Tips toggle. Unlike the fire-and-forget setSkipAllTips above,
 * this awaits the server so the switch can't silently diverge: on failure the
 * local cache is restored to the previous value and the error is rethrown
 * for the screen to show.
 */
export async function updateSkipAllTips(
  userId: string | null | undefined,
  value: boolean,
  current: FirstRunTipsLocalState,
  api?: FirstRunTipsApi,
): Promise<FirstRunTipsLocalState> {
  await writeLocalSkipAll(userId, value);
  // A "Skip all" stored while the account id was still loading ('anon') is
  // OR-ed into every read, and the next server sync would re-send it — so
  // turning it off must clear that record too (as replayAllTips does).
  const anonSkip = userId && !value ? await readLocalSkipAll(null) : false;
  if (anonSkip) await writeLocalSkipAll(null, false);
  if (api) {
    try {
      if (api.firstRunTips.setSkipAll) await api.firstRunTips.setSkipAll(value);
      else if (value) await api.firstRunTips.skipAll();
      else throw new Error('This app version cannot turn "Skip all tips" off.');
    } catch (error) {
      await writeLocalSkipAll(userId, current.skipAll);
      if (anonSkip) await writeLocalSkipAll(null, true);
      throw error;
    }
  }
  return { ...current, skipAll: value };
}

/** "Replay tips" (Settings) — a genuine reset of all seen-state, local and server. */
export async function replayAllTips(
  userId: string | null | undefined,
  api?: FirstRunTipsApi,
): Promise<FirstRunTipsLocalState> {
  await Promise.all([
    writeLocalSeenSet(userId, new Set()), writeLocalSkipAll(userId, false),
    // The pre-sign-in record would otherwise keep counting as seen.
    writeLocalSeenSet(null, new Set()), writeLocalSkipAll(null, false),
  ]);
  if (api) {
    try { await api.firstRunTips.reset(); } catch { /* local reset still took effect */ }
  }
  return { seenIds: new Set(), skipAll: false };
}
