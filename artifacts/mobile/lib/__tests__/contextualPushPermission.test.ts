import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  platform: { OS: 'ios' as string },
  constants: { expoConfig: { extra: { eas: { projectId: 'proj-123' } } } as any, easConfig: undefined as any },
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => h.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { h.store.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { h.store.delete(k); }),
    multiGet: vi.fn(async (keys: string[]) => keys.map((k) => [k, h.store.get(k) ?? null])),
  },
}));
vi.mock('react-native', () => ({ Platform: h.platform }));
vi.mock('expo-constants', () => ({ default: h.constants }));
vi.mock('expo-notifications', () => ({
  getPermissionsAsync: h.getPermissionsAsync,
  requestPermissionsAsync: h.requestPermissionsAsync,
  getExpoPushTokenAsync: h.getExpoPushTokenAsync,
}));

import {
  getLastPushRegistrationIssue,
  registerGrantedPushToken,
  requestOnboardingPushPermission,
  resolveEasProjectId,
} from '../contextualPushPermission';

function makeApi() {
  return { push: { register: vi.fn(async () => ({ ok: true })) } };
}

beforeEach(() => {
  h.store.clear();
  h.platform.OS = 'ios';
  h.constants.expoConfig = { extra: { eas: { projectId: 'proj-123' } } };
  h.constants.easConfig = undefined;
  h.getPermissionsAsync.mockReset();
  h.requestPermissionsAsync.mockReset();
  h.getExpoPushTokenAsync.mockReset().mockResolvedValue({ data: 'ExponentPushToken[abc]' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('resolveEasProjectId', () => {
  it('prefers app config, then EAS metadata, then env', () => {
    expect(resolveEasProjectId({ expoConfig: { extra: { eas: { projectId: 'a' } } }, easConfig: { projectId: 'b' }, env: 'c' })).toBe('a');
    expect(resolveEasProjectId({ expoConfig: { extra: {} }, easConfig: { projectId: 'b' }, env: 'c' })).toBe('b');
    expect(resolveEasProjectId({ env: ' c ' })).toBe('c');
    expect(resolveEasProjectId({ env: '' })).toBeNull();
  });
});

describe('requestOnboardingPushPermission', () => {
  it('asks the OS and registers the token with the projectId when granted', async () => {
    h.getPermissionsAsync.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    h.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const api = makeApi();
    const outcome = await requestOnboardingPushPermission('user_1', api);
    expect(h.requestPermissionsAsync).toHaveBeenCalledOnce();
    expect(h.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-123' });
    expect(api.push.register).toHaveBeenCalledWith({ token: 'ExponentPushToken[abc]', platform: 'expo' });
    expect(outcome).toEqual({ status: 'granted', registration: { ok: true, token: 'ExponentPushToken[abc]' } });
    expect(await getLastPushRegistrationIssue()).toBeNull();
  });

  it('resolves (never throws) on denial and does not register', async () => {
    h.getPermissionsAsync.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    h.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const api = makeApi();
    await expect(requestOnboardingPushPermission('user_1', api)).resolves.toEqual({ status: 'denied' });
    expect(api.push.register).not.toHaveBeenCalled();
  });

  it('skips the prompt entirely on web', async () => {
    h.platform.OS = 'web';
    await expect(requestOnboardingPushPermission('user_1', makeApi())).resolves.toEqual({ status: 'unsupported' });
    expect(h.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('resolves with an error outcome when the permission API throws', async () => {
    h.getPermissionsAsync.mockRejectedValue(new Error('native module missing'));
    await expect(requestOnboardingPushPermission('user_1', makeApi())).resolves.toEqual({ status: 'error', message: 'native module missing' });
  });

  it('reports a typed missing_project_id failure, warns and records it, instead of calling Expo without one', async () => {
    h.constants.expoConfig = { extra: {} };
    h.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const api = makeApi();
    const outcome = await requestOnboardingPushPermission('user_1', api);
    expect(h.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'granted', registration: { ok: false, reason: 'missing_project_id' } });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('EXPO_PUBLIC_EAS_PROJECT_ID'));
    expect(await getLastPushRegistrationIssue()).toMatchObject({ reason: 'missing_project_id' });
  });

  it('records token and server registration failures with the real message', async () => {
    h.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    h.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('No "projectId" found'));
    const first = await requestOnboardingPushPermission('user_1', makeApi());
    expect(first).toMatchObject({ registration: { ok: false, reason: 'token_failed', message: expect.stringContaining('No "projectId" found') } });

    const api = makeApi();
    api.push.register.mockRejectedValueOnce(new Error('HTTP 500'));
    const second = await requestOnboardingPushPermission('user_1', api);
    expect(second).toMatchObject({ registration: { ok: false, reason: 'register_failed' } });
    expect(await getLastPushRegistrationIssue()).toMatchObject({ reason: 'register_failed', message: expect.stringContaining('HTTP 500') });
  });
});

describe('registerGrantedPushToken', () => {
  it('registers only for an onboarded owner with existing permission, and clears a stale issue on success', async () => {
    h.store.set('onboarding_complete', 'true');
    h.store.set('onboarding_owner_id', 'user_1');
    h.store.set('bt:push:last-registration-issue:v1', JSON.stringify({ ok: false, reason: 'token_failed', message: 'old' }));
    h.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const api = makeApi();
    await expect(registerGrantedPushToken('user_1', api)).resolves.toMatchObject({ ok: true });
    expect(h.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(await getLastPushRegistrationIssue()).toBeNull();
    await expect(registerGrantedPushToken('user_2', api)).resolves.toBeNull();
  });
});
