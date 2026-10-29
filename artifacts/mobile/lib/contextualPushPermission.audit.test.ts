import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const notifications = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: 'ExponentPushToken[x]' })),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-constants', () => ({ default: { easConfig: { projectId: 'test-project' } } }));
vi.mock('expo-notifications', () => notifications);
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { store.delete(k); }),
    multiGet: vi.fn(async (keys: string[]) => keys.map((k) => [k, store.get(k) ?? null])),
  },
}));

import { requestContextualPushPermission } from './contextualPushPermission';
import { registerPushPrePrompt } from './pushPrePrompt';

const api = { push: { register: vi.fn(async () => ({})) } };

describe('requestContextualPushPermission concurrency', () => {
  beforeEach(() => {
    store.clear();
    store.set('onboarding_complete', 'true');
    store.set('onboarding_owner_id', 'user_1');
    vi.clearAllMocks();
    notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  });

  it('shows one pre-prompt sheet when two actions succeed at the same time', async () => {
    const sheet = vi.fn(async () => true);
    const off = registerPushPrePrompt(sheet);
    await Promise.all([
      requestContextualPushPermission('user_1', api, 'follow'),
      requestContextualPushPermission('user_1', api, 'message'),
    ]);
    off();
    expect(sheet).toHaveBeenCalledTimes(1);
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('releases the prompt claim when pacing skips the sheet', async () => {
    store.set('bt:push:preprompt-declined:v1:user_1', JSON.stringify({ count: 1, lastAt: Date.now() }));
    const sheet = vi.fn(async () => true);
    const off = registerPushPrePrompt(sheet);
    await requestContextualPushPermission('user_1', api, 'follow');
    store.delete('bt:push:preprompt-declined:v1:user_1');
    await requestContextualPushPermission('user_1', api, 'follow');
    off();
    expect(sheet).toHaveBeenCalledTimes(1);
  });
});
