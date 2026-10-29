import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
  },
}));

import { readLocalFirstRunTipsState, syncFirstRunTipsFromServer, updateSkipAllTips } from './storage';

describe('updateSkipAllTips off (audit)', () => {
  beforeEach(() => { store.clear(); });

  it('also clears a "Skip all" recorded before the account id loaded, so it stays off', async () => {
    store.set('first_run_tips_skip_all:anon', '1');
    let serverSkip = true;
    const api = {
      firstRunTips: {
        get: vi.fn(async () => ({ seenTipIds: [], skipAll: serverSkip })),
        markSeen: vi.fn(async () => {}),
        skipAll: vi.fn(async () => { serverSkip = true; }),
        setSkipAll: vi.fn(async (v: boolean) => { serverSkip = v; }),
        reset: vi.fn(async () => {}),
      },
    };
    await updateSkipAllTips('user_1', false, { seenIds: new Set(), skipAll: true }, api);
    expect((await readLocalFirstRunTipsState('user_1')).skipAll).toBe(false);
    expect((await syncFirstRunTipsFromServer('user_1', api)).skipAll).toBe(false);
    expect(api.firstRunTips.skipAll).not.toHaveBeenCalled();
    expect(serverSkip).toBe(false);
  });

  it('restores the pre-sign-in record when the server refuses', async () => {
    store.set('first_run_tips_skip_all:anon', '1');
    const api = {
      firstRunTips: {
        get: vi.fn(), markSeen: vi.fn(), skipAll: vi.fn(), reset: vi.fn(),
        setSkipAll: vi.fn(async () => { throw new Error('Server error'); }),
      },
    };
    await expect(updateSkipAllTips('user_1', false, { seenIds: new Set(), skipAll: true }, api as any)).rejects.toThrow();
    expect(store.get('first_run_tips_skip_all:anon')).toBe('1');
  });
});
