import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) },
}));
vi.mock('@/lib/setupRemote', () => ({
  loadRemoteSetup: vi.fn(async () => null),
  saveRemoteSetup: vi.fn(async () => null),
}));

import { completeTask, completionPercent, getSetupState, requiredTaskCount } from './setupStore';

describe('setup checklist task list (audit)', () => {
  it('lists each task once — no duplicate "Set up payments" row / React key', async () => {
    const state = await getSetupState('seller-unique');
    const ids = state.tasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Same nine tasks as the server (api-server lib/sellerSetupChecklist.ts SETUP_TASK_IDS), one optional.
    expect(ids).toHaveLength(9);
    expect(requiredTaskCount(state)).toBe(8);
  });

  it('counts connecting payments once toward progress', async () => {
    const done = await completeTask('connect_payments', 'seller-pay');
    expect(done.tasks.filter((t) => t.completed)).toHaveLength(1);
    expect(completionPercent(done)).toBe(13); // 1 of 8 required
  });
});
