import { describe, expect, it, vi } from 'vitest';

const secure = new Map<string, string>();
const local = new Map<string, string>();
let n = 0;

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => { secure.set(k, v); }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => local.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { local.set(k, v); }),
  },
}));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => `uuid-${++n}`) }));

import { getInstallId } from './installId';

describe('getInstallId on a fresh install', () => {
  it('gives concurrent first callers the same id, and that is the stored one', async () => {
    const [a, b] = await Promise.all([getInstallId(), getInstallId()]);
    expect(a).toBe(b);
    expect(secure.get('bt_install_id')).toBe(a);
    expect(await getInstallId()).toBe(a);
  });
});
