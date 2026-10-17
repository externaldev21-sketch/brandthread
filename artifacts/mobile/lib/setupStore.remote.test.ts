import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { storage.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { storage.delete(k); }),
  },
}));

const remote = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@/lib/setupRemote', () => ({
  loadRemoteSetup: remote.load,
  saveRemoteSetup: remote.save,
}));

import { completeTask, getSetupState, isAutoTrackedTask, skipTask, toRemoteState } from './setupStore';

const emptyStored = {
  started: false, dismissed: false, walkthroughShown: false, celebrated: false,
  dismissedTips: [], openedFeatures: [], tasks: {},
};

function server(overrides: Record<string, unknown> = {}) {
  return {
    derived: { verify_account: true, connect_payments: false, first_product: true },
    derivedTaskIds: ['verify_account', 'connect_payments', 'first_product'],
    state: emptyStored,
    goals: [],
    order: ['verify_account', 'connect_payments', 'first_product', 'shipping_rates', 'customize_store', 'connect_domain', 'publish_store', 'first_post', 'connect_manufacturer'],
    ...overrides,
  };
}

describe('server-backed setup checklist', () => {
  beforeEach(() => {
    storage.clear();
    remote.load.mockReset();
    remote.save.mockReset();
  });

  it('uses derived flags from the server, on a brand-new phone', async () => {
    remote.load.mockResolvedValue(server());
    const state = await getSetupState('seller-1');
    const byId = Object.fromEntries(state.tasks.map(t => [t.id, t]));
    expect(byId.first_product.completed).toBe(true);
    expect(byId.connect_payments.completed).toBe(false);
    expect(state.started).toBe(true);
  });

  it('cannot tick payments by hand — the server value wins and it is never sent', async () => {
    remote.load.mockResolvedValue(server());
    remote.save.mockResolvedValue(server());
    await completeTask('connect_payments', 'seller-2');
    const sent = remote.save.mock.calls[0][0];
    expect(sent.tasks.connect_payments).toBeUndefined();
    const reloaded = await getSetupState('seller-2');
    expect(reloaded.tasks.find(t => t.id === 'connect_payments')!.completed).toBe(false);
    expect(isAutoTrackedTask('connect_payments')).toBe(true);
    expect(isAutoTrackedTask('connect_manufacturer')).toBe(false);
  });

  it('persists skips to the server and surfaces save errors when asked', async () => {
    remote.load.mockResolvedValue(server());
    remote.save.mockRejectedValue(new Error('offline'));
    await expect(skipTask('first_post', 'seller-3', { throwOnSyncError: true })).rejects.toThrow('offline');
    remote.save.mockResolvedValue(server());
    await skipTask('first_post', 'seller-3');
    expect(remote.save.mock.calls.at(-1)![0].tasks.first_post).toEqual({ skipped: true });
  });

  it('orders tasks by the goal-based server order', async () => {
    remote.load.mockResolvedValue(server({ order: ['verify_account', 'first_post', 'shipping_rates', 'connect_payments', 'first_product', 'customize_store', 'connect_domain', 'publish_store', 'connect_manufacturer'] }));
    const state = await getSetupState('seller-4');
    expect(state.tasks.slice(0, 3).map(t => t.id)).toEqual(['verify_account', 'first_post', 'shipping_rates']);
  });

  it('keeps manual completion only for non-tracked tasks', () => {
    const remoteState = toRemoteState({
      started: true, dismissed: false, currentStep: null, dismissedTips: [], openedFeatures: [],
      walkthroughShown: false, celebrated: false, lastUpdated: 0,
      tasks: [
        { id: 'connect_manufacturer', label: '', description: '', icon: '', route: '', completed: true, skipped: false },
        { id: 'first_product', label: '', description: '', icon: '', route: '', completed: true, skipped: false },
      ],
    });
    expect(remoteState.tasks).toEqual({ connect_manufacturer: { completed: true } });
  });

  it('falls back to the cached copy offline', async () => {
    remote.load.mockResolvedValue(server());
    await getSetupState('seller-5');
    remote.load.mockRejectedValue(new Error('offline'));
    const cached = await getSetupState('seller-5');
    expect(cached.tasks.find(t => t.id === 'first_product')!.completed).toBe(true);
  });
});
