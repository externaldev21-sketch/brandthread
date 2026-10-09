/**
 * Buyer app settings — follow the account (server: GET/PATCH /api/me/settings)
 * with a per-account local cache.
 *
 * - Storage is per signed-in account (lib/accountStorage). The old device-wide
 *   key is claimed once by the first signed-in account, then deleted.
 * - load: local cache, then (signed in, not the dev preview) the server copy
 *   wins for every key it has — except keys with an unsent local change.
 * - save/patch: local cache immediately; changed synced keys are queued as
 *   "pending" and sent in one debounced PATCH. A failed send stays pending
 *   and is retried on the next load.
 * - Not synced through here: sizes / style categories (buyer_preferences via
 *   useBuyerPreferences), the four push categories that already go through
 *   /api/notification-prefs, and device-only switches (biometric lock, saved
 *   login, the local two-factor placeholder).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAccountStorageScope, resolveAccountKey } from '@/lib/accountStorage';
import {
  canSyncAccountServer, fetchAccountSettings, isPermanentSettingsError, patchAccountSettings, withTimeout,
  type AccountSettings,
} from '@/lib/accountSettings';

/** Pre-scoping device-wide key (claimed once by the first signed-in account). */
const LEGACY_KEY = 'brandthread_buyer_settings_v2';

export interface BuyerSettingsState {
  privateAccount: boolean;
  activityStatus: boolean;
  readReceipts: boolean;
  storyReplies: 'everyone' | 'friends' | 'off';
  storySharing: boolean;
  allowMentions: 'everyone' | 'friends' | 'nobody';
  allowTags: 'everyone' | 'friends' | 'nobody';
  manualTagApproval: boolean;
  messageRequests: boolean;
  groupAdds: 'everyone' | 'friends';
  hiddenWords: boolean;
  hideLikeCounts: boolean;
  sensitiveContent: 'less' | 'standard' | 'more';
  autoplayVideos: boolean;
  highQualityUploads: boolean;
  dataSaver: boolean;
  orderUpdates: boolean;
  dropAlerts: boolean;
  restockAlerts: boolean;
  priceDropAlerts: boolean;
  friendActivity: boolean;
  messageNotifications: boolean;
  storyNotifications: boolean;
  marketingNotifications: boolean;
  twoFactor: boolean;
  biometricLock: boolean;
  loginAlerts: boolean;
  saveLoginInfo: boolean;
  searchable: boolean;
  contactSync: boolean;
  showShoppingActivity: boolean;
  personalizedRecommendations: boolean;
  sizeTops: string;
  sizeBottoms: string;
  sizeShoes: string;
  preferredFit: 'slim' | 'regular' | 'oversized';
  styleCategories: string[];
  language: string;
  theme: 'system' | 'dark' | 'light';
  reduceMotion: boolean;
  captions: boolean;
}

export const DEFAULT_BUYER_SETTINGS: BuyerSettingsState = {
  privateAccount: false,
  activityStatus: true,
  readReceipts: true,
  storyReplies: 'everyone',
  storySharing: true,
  allowMentions: 'everyone',
  allowTags: 'everyone',
  manualTagApproval: false,
  messageRequests: true,
  groupAdds: 'friends',
  hiddenWords: true,
  hideLikeCounts: false,
  sensitiveContent: 'standard',
  autoplayVideos: true,
  highQualityUploads: true,
  dataSaver: false,
  orderUpdates: true,
  dropAlerts: true,
  restockAlerts: true,
  priceDropAlerts: false,
  friendActivity: true,
  messageNotifications: true,
  storyNotifications: true,
  marketingNotifications: false,
  twoFactor: false,
  biometricLock: false,
  loginAlerts: true,
  saveLoginInfo: true,
  searchable: true,
  contactSync: false,
  showShoppingActivity: false,
  personalizedRecommendations: true,
  sizeTops: 'M',
  sizeBottoms: '32',
  sizeShoes: '10',
  preferredFit: 'regular',
  styleCategories: ['streetwear', 'vintage'],
  language: 'English',
  theme: 'system',
  reduceMotion: false,
  captions: true,
};

type Key = keyof BuyerSettingsState;

/** Keys that never go to /api/me/settings (see file header). */
export const LOCAL_ONLY_BUYER_SETTING_KEYS: readonly Key[] = [
  'sizeTops', 'sizeBottoms', 'sizeShoes', 'styleCategories',
  'dropAlerts', 'messageNotifications', 'orderUpdates', 'friendActivity',
  'twoFactor', 'biometricLock', 'saveLoginInfo',
];

export const SYNCED_BUYER_SETTING_KEYS: readonly Key[] = (Object.keys(DEFAULT_BUYER_SETTINGS) as Key[])
  .filter((k) => !LOCAL_ONLY_BUYER_SETTING_KEYS.includes(k));

const SYNCED = new Set<string>(SYNCED_BUYER_SETTING_KEYS);

/** Same JS type as the default (string/boolean), so a bad server value never lands in state. */
function validFor(key: Key, value: unknown): boolean {
  const def = DEFAULT_BUYER_SETTINGS[key];
  if (Array.isArray(def)) return Array.isArray(value) && value.every((v) => typeof v === 'string');
  return value !== null && value !== undefined && typeof value === typeof def;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Server copy wins for every synced key it holds, except keys with an unsent local change. */
export function applyServerBuyerSettings(
  local: BuyerSettingsState,
  server: AccountSettings,
  pendingKeys: readonly string[] = [],
): BuyerSettingsState {
  const next: BuyerSettingsState = { ...local };
  const pending = new Set(pendingKeys);
  for (const key of SYNCED_BUYER_SETTING_KEYS) {
    if (pending.has(key) || !(key in server)) continue;
    const value = server[key];
    if (validFor(key, value)) (next as unknown as Record<string, unknown>)[key] = value;
  }
  return next;
}

/** Synced keys whose value differs between two states. */
export function changedSyncedKeys(prev: BuyerSettingsState, next: BuyerSettingsState): string[] {
  return SYNCED_BUYER_SETTING_KEYS.filter((k) => !sameValue(prev[k], next[k]));
}

/** The PATCH body for a set of pending keys. */
export function buildSettingsPatch(state: BuyerSettingsState, keys: readonly string[]): AccountSettings {
  const body: AccountSettings = {};
  for (const key of keys) {
    if (SYNCED.has(key)) body[key] = state[key as Key];
  }
  return body;
}

function sanitize(raw: unknown): BuyerSettingsState {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return { ...DEFAULT_BUYER_SETTINGS, ...obj } as BuyerSettingsState;
}

const storageKey = (uid: string) => resolveAccountKey(LEGACY_KEY, 'claim', uid);
const pendingKeyFor = (key: string) => `${key}:pending`;

async function readLocal(key: string): Promise<BuyerSettingsState> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? sanitize(JSON.parse(raw)) : { ...DEFAULT_BUYER_SETTINGS };
  } catch {
    return { ...DEFAULT_BUYER_SETTINGS };
  }
}

async function readPending(key: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(pendingKeyFor(key));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string' && SYNCED.has(k)) : [];
  } catch {
    return [];
  }
}

async function writePending(key: string, keys: string[]): Promise<void> {
  try {
    if (keys.length) await AsyncStorage.setItem(pendingKeyFor(key), JSON.stringify(keys));
    else await AsyncStorage.removeItem(pendingKeyFor(key));
  } catch { /* the next save re-queues */ }
}

const SERVER_WAIT_MS = 3_000;
const REFRESH_MS = 60_000;
const FLUSH_DEBOUNCE_MS = 600;
const lastServerSync = new Map<string, number>();
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Sends every pending key for `uid`. Keys whose value changed mid-flight stay pending. */
export async function flushBuyerSettings(uid: string = getAccountStorageScope()): Promise<void> {
  const timer = flushTimers.get(uid);
  if (timer) { clearTimeout(timer); flushTimers.delete(uid); }
  if (!canSyncAccountServer(uid) || getAccountStorageScope() !== uid) return;
  const key = await storageKey(uid);
  const pending = await readPending(key);
  if (!pending.length) return;
  const sent = buildSettingsPatch(await readLocal(key), pending);
  try {
    await patchAccountSettings(sent);
  } catch (error) {
    // Validation errors can never succeed on retry — drop them; anything
    // else (offline, 5xx) stays pending for the next load.
    if (!isPermanentSettingsError(error)) return;
  }
  const [latest, stillPending] = await Promise.all([readLocal(key), readPending(key)]);
  await writePending(key, stillPending.filter((k) => !(k in sent) || !sameValue(latest[k as Key], sent[k])));
}

function scheduleFlush(uid: string): void {
  const existing = flushTimers.get(uid);
  if (existing) clearTimeout(existing);
  flushTimers.set(uid, setTimeout(() => {
    flushTimers.delete(uid);
    void flushBuyerSettings(uid).catch(() => {});
  }, FLUSH_DEBOUNCE_MS));
}

export async function loadBuyerSettings(): Promise<BuyerSettingsState> {
  const uid = getAccountStorageScope();
  const key = await storageKey(uid);
  const local = await readLocal(key);
  if (!canSyncAccountServer(uid)) return local;
  const pending = await readPending(key);
  const last = lastServerSync.get(uid) ?? 0;
  if (!pending.length && Date.now() - last < REFRESH_MS) return local;
  try {
    const remote = await withTimeout(fetchAccountSettings({ force: true }), SERVER_WAIT_MS);
    if (getAccountStorageScope() !== uid) return local;
    // Re-read: a save may have landed while the request was in flight.
    const [current, currentPending] = await Promise.all([readLocal(key), readPending(key)]);
    const merged = applyServerBuyerSettings(current, remote.settings, currentPending);
    await AsyncStorage.setItem(key, JSON.stringify(merged));
    lastServerSync.set(uid, Date.now());
    if (currentPending.length) scheduleFlush(uid);
    return merged;
  } catch {
    if (pending.length) scheduleFlush(uid);
    return local;
  }
}

async function saveFor(uid: string, settings: BuyerSettingsState): Promise<void> {
  const key = await storageKey(uid);
  const prev = await readLocal(key);
  await AsyncStorage.setItem(key, JSON.stringify(settings));
  if (!canSyncAccountServer(uid)) return;
  const changed = changedSyncedKeys(prev, settings);
  if (!changed.length) return;
  const pending = await readPending(key);
  await writePending(key, Array.from(new Set([...pending, ...changed])));
  scheduleFlush(uid);
}

export async function saveBuyerSettings(settings: BuyerSettingsState): Promise<void> {
  await saveFor(getAccountStorageScope(), settings);
}

export async function patchBuyerSettings(patch: Partial<BuyerSettingsState>) {
  const uid = getAccountStorageScope();
  const current = await readLocal(await storageKey(uid));
  const next = { ...current, ...patch };
  await saveFor(uid, next);
  return next;
}

/** Test-only. */
export function __resetBuyerSettingsForTests(): void {
  lastServerSync.clear();
  flushTimers.forEach((t) => clearTimeout(t));
  flushTimers.clear();
}
