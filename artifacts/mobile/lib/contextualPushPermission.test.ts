import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    multiGet: async (keys: string[]) => keys.map((k) => [k, store.get(k) ?? null]),
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => { store.set(k, v); },
  },
}));
vi.mock('expo-notifications', () => ({
  getPermissionsAsync: async () => ({ status: 'granted', canAskAgain: true }),
  requestPermissionsAsync: async () => ({ status: 'granted' }),
  getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[abc]' }),
}));

import { deviceTimeZone, registerGrantedPushToken } from './contextualPushPermission';

describe('push token registration', () => {
  beforeEach(() => {
    store.clear();
    store.set('onboarding_complete', 'true');
    store.set('onboarding_owner_id', 'user_1');
  });

  it("sends the device's IANA timezone with the token", async () => {
    const register = vi.fn(async () => ({}));
    await registerGrantedPushToken('user_1', { push: { register } });
    expect(register).toHaveBeenCalledWith({
      token: 'ExponentPushToken[abc]',
      platform: 'expo',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it('reads a non-empty timezone name', () => {
    expect(typeof deviceTimeZone()).toBe('string');
    expect(deviceTimeZone()).not.toBe('');
  });
});
