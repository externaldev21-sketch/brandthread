/**
 * push.deregister / push.deregisterVoipToken called request() without the
 * client's cache scope, so a successful DELETE cleared the 'anonymous' API
 * cache instead of the signed-in account's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default } }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ getToken: vi.fn(async () => 'token'), userId: 'user-1' }) }));
const storage = vi.hoisted(() => ({
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => undefined),
  getAllKeys: vi.fn(async () => [] as string[]),
  multiRemove: vi.fn(async () => undefined),
  removeItem: vi.fn(async () => undefined),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));
vi.mock('@/lib/networkNotice', () => ({
  ApiError: class ApiError extends Error { constructor(public status: number, public body: string) { super(body); } },
  dismissNetworkNotice: vi.fn(),
  reportNetworkError: vi.fn(),
}));

import { createApi } from './api';

const userKey = 'bt:api-cache:v1:user-1:joined:%2Fapi%2Fv1%2Fbuyer%2Faddresses';
const anonKey = 'bt:api-cache:v1:anonymous:joined:%2Fapi%2Fv1%2Fbuyer%2Faddresses';

beforeEach(() => {
  storage.multiRemove.mockClear();
  storage.getAllKeys.mockResolvedValue([userKey, anonKey]);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '{"ok":true}' }) as unknown as Response));
});

describe('push token DELETEs clear the signed-in account\'s cache', () => {
  const client = () => createApi(async () => 'token', () => 'user-1');

  it('deregisterVoipToken', async () => {
    await client().push.deregisterVoipToken('t'.repeat(64));
    expect(storage.multiRemove).toHaveBeenCalledWith([userKey]);
  });

  it('deregister', async () => {
    await client().push.deregister('ExponentPushToken[x]');
    expect(storage.multiRemove).toHaveBeenCalledWith([userKey]);
  });
});
