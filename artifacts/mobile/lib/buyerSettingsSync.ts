/**
 * Server sync for the buyer Settings screens.
 *
 * The settings the API can honour (read receipts, group adds, story replies,
 * personalized recommendations, login alerts, …) are saved to
 * /api/me/settings first; only once the server accepts them is the local
 * copy (lib/buyerSettings.ts, AsyncStorage) updated. A failed save throws, so
 * screens can roll the toggle back and show a real error instead of
 * pretending it saved. "Message requests" is the existing server DM-privacy
 * flag (/api/auth/privacy): on = non-followers land in requests, off = only
 * people you follow can message you.
 */
import type { BrandthreadApi, MeAppSettings } from '@/lib/api';
import { patchBuyerSettings, type BuyerSettingsState } from '@/lib/buyerSettings';

/** Local keys that live on the server under the same name. */
export const SERVER_SETTING_KEYS = [
  'readReceipts', 'activityStatus', 'groupAdds', 'storyReplies', 'hideLikeCounts',
  'personalizedRecommendations', 'sensitiveContent', 'reduceMotion', 'captions',
  'autoplayVideos', 'highQualityUploads', 'dataSaver', 'highContrast',
  'loginAlerts',
] as const satisfies readonly (keyof BuyerSettingsState & keyof MeAppSettings)[];

type ServerKey = typeof SERVER_SETTING_KEYS[number];
const SERVER_KEY_SET = new Set<string>(SERVER_SETTING_KEYS);

type SyncApi = Pick<BrandthreadApi, 'meSettings' | 'privacy'>;

/** The part of a local patch that must be saved to /api/me/settings. */
export function toServerPatch(patch: Partial<BuyerSettingsState>): Partial<MeAppSettings> {
  const out: Partial<Record<ServerKey, unknown>> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SERVER_KEY_SET.has(key) && value !== undefined) out[key as ServerKey] = value;
  }
  return out as Partial<MeAppSettings>;
}

/** Server settings + DM privacy → the local keys they own. */
export function fromServer(
  settings: Partial<MeAppSettings> | null | undefined,
  dmPrivacy?: 'requests' | 'followers_only' | null,
): Partial<BuyerSettingsState> {
  const out: Partial<Record<keyof BuyerSettingsState, unknown>> = {};
  if (settings) {
    for (const key of SERVER_SETTING_KEYS) {
      if (settings[key] !== undefined) out[key] = settings[key];
    }
  }
  if (dmPrivacy) out.messageRequests = dmPrivacy !== 'followers_only';
  return out as Partial<BuyerSettingsState>;
}

/**
 * Pulls the server copy into local storage. The server wins for every key it
 * owns; device-only keys are untouched. Throws if the settings read fails so
 * callers can show a retry, but a DM-privacy read failure alone is tolerated.
 */
export async function hydrateBuyerSettings(api: SyncApi): Promise<BuyerSettingsState> {
  const [remote, privacy] = await Promise.all([
    api.meSettings.get(),
    api.privacy.get().catch(() => null),
  ]);
  return patchBuyerSettings(fromServer(remote.settings, privacy?.dmPrivacy ?? null));
}

/**
 * Saves a settings change: server first (throws on failure, nothing local
 * changes), then the local copy from what the server returned.
 */
export async function updateBuyerSettings(api: SyncApi, patch: Partial<BuyerSettingsState>): Promise<BuyerSettingsState> {
  const serverPatch = toServerPatch(patch);
  const local: Partial<BuyerSettingsState> = { ...patch };
  if (patch.messageRequests !== undefined) {
    const res = await api.privacy.update({ dmPrivacy: patch.messageRequests ? 'requests' : 'followers_only' });
    local.messageRequests = res.dmPrivacy !== 'followers_only';
  }
  if (Object.keys(serverPatch).length > 0) {
    const res = await api.meSettings.update(serverPatch);
    Object.assign(local, fromServer(res.settings));
  }
  return patchBuyerSettings(local);
}
