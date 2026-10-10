import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const notifications = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: 'ExponentPushToken[x]' })),
}));
const platform = vi.hoisted(() => ({ OS: 'ios' }));

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-notifications', () => notifications);
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    multiGet: vi.fn(async (keys: string[]) => keys.map((k) => [k, store.get(k) ?? null])),
  },
}));

import { requestContextualPushPermission } from './contextualPushPermission';
import { registerPushPrePrompt } from './pushPrePrompt';

const api = { push: { register: vi.fn(async () => ({})) } };

describe('requestContextualPushPermission', () => {
  beforeEach(() => {
    store.clear();
    store.set('onboarding_complete', 'true');
    store.set('onboarding_owner_id', 'user_1');
    vi.clearAllMocks();
    platform.OS = 'ios';
    notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  });

  it('"Not now" on the sheet never shows the system dialog, and is remembered', async () => {
    const reasons: string[] = [];
    const off = registerPushPrePrompt(async (r) => { reasons.push(r); return false; });
    await requestContextualPushPermission('user_1', api, 'follow');
    off();
    expect(reasons).toEqual(['follow']);
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(JSON.parse(store.get('bt:push:preprompt-declined:v1:user_1')!)).toMatchObject({ count: 1 });

    // Asked again right away: the week-long pause holds.
    const again = vi.fn(async () => true);
    const off2 = registerPushPrePrompt(again);
    await requestContextualPushPermission('user_1', api, 'order');
    off2();
    expect(again).not.toHaveBeenCalled();
  });

  it('"Turn on notifications" shows the system dialog once and registers the token', async () => {
    const off = registerPushPrePrompt(async () => true);
    await requestContextualPushPermission('user_1', api, 'message');
    await requestContextualPushPermission('user_1', api, 'message');
    off();
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(api.push.register).toHaveBeenCalledWith({ token: 'ExponentPushToken[x]', platform: 'expo' });
  });

  it('never shows the sheet when permission is already granted', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const sheet = vi.fn(async () => true);
    const off = registerPushPrePrompt(sheet);
    await requestContextualPushPermission('user_1', api, 'follow');
    off();
    expect(sheet).not.toHaveBeenCalled();
    expect(api.push.register).toHaveBeenCalled();
  });

  it('does nothing before onboarding is finished or on web', async () => {
    const sheet = vi.fn(async () => true);
    const off = registerPushPrePrompt(sheet);
    await requestContextualPushPermission('someone_else', api, 'follow');
    platform.OS = 'web';
    await requestContextualPushPermission('user_1', api, 'follow');
    off();
    expect(sheet).not.toHaveBeenCalled();
  });
});
