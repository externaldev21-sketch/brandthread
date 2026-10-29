/**
 * Native push permission is deliberately requested only after a meaningful,
 * server-backed action (or an explicit request from notification settings).
 * The marker is scoped to the Clerk ID so a decision made by one account on
 * a shared device never affects another account.
 *
 * Registration needs the EAS project ID: getExpoPushTokenAsync() cannot mint
 * a token on a real device without it. It is read from the build's app config
 * (extra.eas.projectId, written by `eas init`), the EAS build metadata
 * (Constants.easConfig.projectId), or EXPO_PUBLIC_EAS_PROJECT_ID. When it is
 * missing or registration fails, the reason is logged with console.warn and
 * kept (getLastPushRegistrationIssue) so Settings > Push notifications can
 * show it, instead of being swallowed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  parseDeclines,
  prePromptAllowed,
  showPushPrePrompt,
  type PushPrePromptReason,
} from './pushPrePrompt';
import { deviceTimeZone } from './deviceTimeZone';

const ONBOARDING_KEY = 'onboarding_complete';
const ONBOARDING_OWNER_KEY = 'onboarding_owner_id';
const LAST_ISSUE_KEY = 'bt:push:last-registration-issue:v1';
const requestedKey = (userId: string) => `bt:push:permission-requested:v1:${userId}`;
const declinedKey = (userId: string) => `bt:push:preprompt-declined:v1:${userId}`;
let prompting = false;

export const EAS_PROJECT_ID_ENV = 'EXPO_PUBLIC_EAS_PROJECT_ID';

type PushApi = {
  push: { register: (body: { token: string; platform?: string; accountIds?: string[]; timezone?: string }) => Promise<unknown> };
};

let signedInAccountIds: string[] = [];

/**
 * Every account signed in on this device (account switcher). Sent with each
 * registration so each account keeps getting its own pushes here, and an
 * account signed out on this device stops getting them.
 */
export function setSignedInAccountIds(ids: readonly string[]): void {
  signedInAccountIds = [...new Set(ids.filter(Boolean))];
}
export type PushRegistrationFailureReason =
  | 'missing_project_id'
  | 'token_failed'
  | 'register_failed';

export type PushRegistrationResult =
  | { ok: true; token: string }
  | { ok: false; reason: PushRegistrationFailureReason; message: string };

export type PushPermissionOutcome =
  | { status: 'granted'; registration: PushRegistrationResult }
  | { status: 'denied' | 'unsupported' }
  | { status: 'error'; message: string };

type ProjectIdSources = {
  expoConfig?: { extra?: { eas?: { projectId?: unknown } } } | null;
  easConfig?: { projectId?: unknown } | null;
  env?: unknown;
};

/** First non-empty project ID from app config, EAS build metadata, then env. */
export function resolveEasProjectId(sources: ProjectIdSources): string | null {
  const candidates = [sources.expoConfig?.extra?.eas?.projectId, sources.easConfig?.projectId, sources.env];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

export function describePushRegistrationIssue(result: PushRegistrationResult | null): string | null {
  if (!result || result.ok) return null;
  return result.message;
}

function currentProjectId(): string | null {
  return resolveEasProjectId({
    expoConfig: Constants.expoConfig as ProjectIdSources['expoConfig'],
    easConfig: (Constants as unknown as { easConfig?: ProjectIdSources['easConfig'] }).easConfig,
    // Must stay a literal property access so Metro inlines it at build time.
    env: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
  });
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error ?? 'unknown error');
}

async function recordIssue(result: PushRegistrationResult): Promise<void> {
  try {
    if (result.ok) await AsyncStorage.removeItem(LAST_ISSUE_KEY);
    else await AsyncStorage.setItem(LAST_ISSUE_KEY, JSON.stringify(result));
  } catch {
    // Storage is only used to surface the issue in Settings.
  }
}

/** The most recent registration failure on this device, or null if the last attempt succeeded / none ran. */
export async function getLastPushRegistrationIssue(): Promise<PushRegistrationResult | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_ISSUE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PushRegistrationResult;
    return parsed && parsed.ok === false && typeof parsed.message === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

async function registerToken(api: PushApi): Promise<PushRegistrationResult> {
  const projectId = currentProjectId();
  let result: PushRegistrationResult;
  if (!projectId) {
    result = {
      ok: false,
      reason: 'missing_project_id',
      message: `Push notifications can't be set up on this build: no EAS project ID. Set ${EAS_PROJECT_ID_ENV} (or run \`eas init\` to add extra.eas.projectId to app.json) and rebuild.`,
    };
  } else {
    let token: string | null = null;
    try {
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      result = { ok: true, token };
    } catch (error) {
      result = { ok: false, reason: 'token_failed', message: `Couldn't get a push token from Expo: ${errorText(error)}` };
    }
    if (token) {
      try {
        const timezone = deviceTimeZone();
        await api.push.register({ token, platform: 'expo', ...(signedInAccountIds.length ? { accountIds: signedInAccountIds } : {}), ...(timezone ? { timezone } : {}) });
      } catch (error) {
        result = { ok: false, reason: 'register_failed', message: `Couldn't register this device for push: ${errorText(error)}` };
      }
    }
  }
  if (!result.ok) console.warn(`[push] ${result.reason}: ${result.message}`);
  await recordIssue(result);
  return result;
}

async function isOnboardedUser(userId: string): Promise<boolean> {
  const [[, complete], [, owner]] = await AsyncStorage.multiGet([
    ONBOARDING_KEY,
    ONBOARDING_OWNER_KEY,
  ]);
  return complete === 'true' && owner === userId;
}

/**
 * Register silently when access already exists. This is safe to call at app
 * startup; it never shows the operating-system permission dialog.
 */
export async function registerGrantedPushToken(
  userId: string | null | undefined,
  api: PushApi,
): Promise<PushRegistrationResult | null> {
  if (Platform.OS === 'web' || !userId || !(await isOnboardedUser(userId))) return null;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return await registerToken(api);
  } catch (error) {
    console.warn(`[push] permission check failed: ${errorText(error)}`);
  }
  return null;
}

/**
 * Onboarding "Never miss what matters" → Continue. Shows the OS prompt (once
 * per account) and registers the token when granted. Never throws and never
 * blocks: denial, web and errors all resolve so onboarding can continue.
 */
export async function requestOnboardingPushPermission(
  userId: string | null | undefined,
  api: PushApi,
): Promise<PushPermissionOutcome> {
  if (Platform.OS === 'web') return { status: 'unsupported' };
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status === 'granted') return { status: 'granted', registration: await registerToken(api) };
    if (permission.canAskAgain === false) {
      if (userId) await AsyncStorage.setItem(requestedKey(userId), 'true');
      return { status: 'denied' };
    }
    if (userId) await AsyncStorage.setItem(requestedKey(userId), 'true');
    const result = await Notifications.requestPermissionsAsync();
    if (result.status !== 'granted') return { status: 'denied' };
    return { status: 'granted', registration: await registerToken(api) };
  } catch (error) {
    const message = errorText(error);
    console.warn(`[push] onboarding permission request failed: ${message}`);
    return { status: 'error', message };
  }
}

/**
 * Call only after a real remote value event has succeeded (first follow,
 * first order, first message). A short sheet explains why first; the OS
 * dialog appears only after "Turn on notifications". "Not now" is paced
 * (lib/pushPrePrompt.ts). A prior OS request is remembered per user,
 * preventing repeated system prompts.
 */
export async function requestContextualPushPermission(
  userId: string | null | undefined,
  api: PushApi,
  reason: PushPrePromptReason = 'general',
): Promise<void> {
  if (Platform.OS === 'web' || !userId || !(await isOnboardedUser(userId))) return;
  let ownsPrompt = false;
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status === 'granted') {
      await registerToken(api);
      return;
    }
    if (permission.canAskAgain === false) {
      await AsyncStorage.setItem(requestedKey(userId), 'true');
      return;
    }

    if (await AsyncStorage.getItem(requestedKey(userId))) return;
    if (prompting) return;
    // Claim the prompt before the next await: two actions succeeding together
    // (a follow and a message) must not both pass the check and stack sheets.
    prompting = true;
    ownsPrompt = true;
    const declines = parseDeclines(await AsyncStorage.getItem(declinedKey(userId)));
    if (!prePromptAllowed(declines, Date.now())) return;

    const accepted = await showPushPrePrompt(reason);
    if (!accepted) {
      await AsyncStorage.setItem(declinedKey(userId), JSON.stringify({ count: declines.count + 1, lastAt: Date.now() }));
      return;
    }
    // Mark before requesting to handle concurrent successful actions and a
    // dismissal/denial consistently across relaunches.
    await AsyncStorage.setItem(requestedKey(userId), 'true');
    const result = await Notifications.requestPermissionsAsync();
    if (result.status === 'granted') await registerToken(api);
  } catch (error) {
    // Permission and registration are intentionally non-blocking.
    console.warn(`[push] contextual permission request failed: ${errorText(error)}`);
  } finally {
    if (ownsPrompt) prompting = false;
  }
}
