import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storage } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
  },
}));

import {
  completeTask,
  getSetupState,
  skipTask,
  type SetupTaskId,
} from '@/lib/setupStore';
import {
  completeSetupTaskAfter,
  completeSetupTaskWhen,
} from '@/lib/setupCompletion';

function taskState(id: SetupTaskId) {
  return getSetupState().then(state => state.tasks.find(task => task.id === id));
}

describe('seller setup completion behavior', () => {
  beforeEach(() => {
    storage.clear();
  });

  const successfulActions: Array<[SetupTaskId, string]> = [
    ['first_product', 'created product'],
    ['shipping_rates', 'created shipping rate'],
    ['customize_store', 'applied storefront theme'],
    ['first_post', 'published post'],
    ['connect_manufacturer', 'saved manufacturer'],
  ];

  it.each(successfulActions)('completes %s only after %s succeeds', async (id) => {
    const result = await completeSetupTaskAfter(id, async () => ({ id: 'saved' }));

    expect(result).toEqual({ id: 'saved' });
    expect(await taskState(id)).toMatchObject({ completed: true, skipped: false });
  });

  it.each(successfulActions)('does not complete %s when its action fails', async (id) => {
    await expect(
      completeSetupTaskAfter(id, async () => {
        throw new Error('request failed');
      }),
    ).rejects.toThrow('request failed');

    expect(await taskState(id)).toMatchObject({ completed: false, skipped: false });
  });

  it.each(successfulActions)('does not complete %s when a successful response is not final', async (id) => {
    const result = await completeSetupTaskAfter(
      id,
      async () => ({ status: 'draft' as const }),
      response => response.status === ('complete' as string),
    );

    expect(result).toEqual({ status: 'draft' });
    expect(await taskState(id)).toMatchObject({ completed: false, skipped: false });
  });

  const confirmedServerTruth: Array<[SetupTaskId, string]> = [
    ['verify_account', 'verified identity'],
    ['connect_payments', 'connected account with charges and payouts enabled'],
    ['connect_domain', 'verified DNS'],
    ['publish_store', 'published storefront'],
  ];

  it.each(confirmedServerTruth)('completes %s when server truth confirms %s', async (id) => {
    await expect(completeSetupTaskWhen(id, true)).resolves.toBe(true);
    expect(await taskState(id)).toMatchObject({ completed: true, skipped: false });
  });

  it.each(confirmedServerTruth)('does not complete %s while server truth is unconfirmed', async (id) => {
    await expect(completeSetupTaskWhen(id, false)).resolves.toBe(false);
    expect(await taskState(id)).toMatchObject({ completed: false, skipped: false });
  });

  it('does not complete pending verification, pending payouts, pending DNS, or a failed publish', async () => {
    const pendingChecks: Array<[SetupTaskId, boolean]> = [
      ['verify_account', false],
      ['connect_payments', false],
      ['connect_domain', false],
      ['publish_store', false],
    ];

    await Promise.all(pendingChecks.map(([id, confirmed]) => completeSetupTaskWhen(id, confirmed)));

    const state = await getSetupState();
    for (const [id] of pendingChecks) {
      expect(state.tasks.find(task => task.id === id)?.completed).toBe(false);
    }
  });

  it('does not complete products or posts for drafts, edits, or cancelled actions', async () => {
    await completeSetupTaskAfter(
      'first_product',
      async () => ({ mode: 'draft' as const }),
      result => result.mode === ('published' as string),
    );
    await completeSetupTaskAfter(
      'first_post',
      async () => ({ mode: 'edit' as const }),
      result => result.mode === ('published' as string),
    );
    await completeSetupTaskAfter(
      'first_post',
      async () => ({ mode: 'cancelled' as const }),
      result => result.mode === ('published' as string),
    );

    const untouched = await getSetupState();

    expect(untouched.tasks.find(task => task.id === 'first_product')).toMatchObject({
      completed: false,
      skipped: false,
    });
    expect(untouched.tasks.find(task => task.id === 'first_post')).toMatchObject({
      completed: false,
      skipped: false,
    });
  });

  it('reloads persisted completion when the checklist is opened again', async () => {
    await completeTask('shipping_rates');

    const returnedChecklistState = await getSetupState();

    expect(returnedChecklistState.tasks.find(task => task.id === 'shipping_rates')).toMatchObject({
      completed: true,
      skipped: false,
    });
  });

  it('keeps manual complete and manual skip behavior distinct', async () => {
    await completeTask('customize_store');
    await skipTask('connect_domain');

    const state = await getSetupState();
    expect(state.tasks.find(task => task.id === 'customize_store')).toMatchObject({
      completed: true,
      skipped: false,
    });
    expect(state.tasks.find(task => task.id === 'connect_domain')).toMatchObject({
      completed: false,
      skipped: true,
    });
  });
});