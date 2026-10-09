import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const notifications = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: 'ExponentPushToken[x]' })),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-notifications', () => notifications);
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => { store.set(key, value); },
    multiGet: async (keys: string[]) => keys.map((key) => [key, store.get(key) ?? null]),
  },
}));

import { requestContextualPushPermission, requestOnboardingPushPermission } from './contextualPushPermission';

describe('onboarding push soft-ask (BT-268)', () => {
  beforeEach(() => {
    store.clear();
    notifications.getPermissionsAsync.mockReset();
    notifications.requestPermissionsAsync.mockReset();
  });

  it('Continue shows the OS permission dialog', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    expect(await requestOnboardingPushPermission('user_1')).toBe(true);
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('never asks again once asked, even from a later contextual prompt', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: true });
    notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await requestOnboardingPushPermission('user_1');
    store.set('onboarding_complete', 'true');
    store.set('onboarding_owner_id', 'user_1');
    await requestContextualPushPermission('user_1', { push: { register: vi.fn() } });
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('skips the dialog when already granted or blocked in Settings', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    expect(await requestOnboardingPushPermission('user_1')).toBe(true);
    notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: false });
    expect(await requestOnboardingPushPermission('user_1')).toBe(false);
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('never throws into onboarding', async () => {
    notifications.getPermissionsAsync.mockRejectedValue(new Error('no native module'));
    expect(await requestOnboardingPushPermission('user_1')).toBe(false);
  });
});
