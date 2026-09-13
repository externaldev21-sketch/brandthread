import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
const { getItem, setItem, removeItem } = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem, setItem, removeItem },
}));

import {
  completedRequiredTaskCount,
  completeTask,
  completionPercent,
  getSetupState,
  isSetupComplete,
  nextBestAction,
  requiredTaskCount,
  setupStorageKeyForUser,
} from './setupStore';

describe('seller setup progress', () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    getItem.mockImplementation(async (key: string) => storage.get(key) ?? null);
    setItem.mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
    removeItem.mockImplementation(async (key: string) => {
      storage.delete(key);
    });
  });

  it('keeps exactly nine tasks while excluding the optional manufacturer from progress', async () => {
    const state = await getSetupState('seller-nine');
    expect(state.tasks).toHaveLength(9);
    expect(requiredTaskCount(state)).toBe(8);
    expect(completionPercent(state)).toBe(0);

    const completed = {
      ...state,
      tasks: state.tasks.map(task =>
        task.id === 'verify_account' ? { ...task, completed: true } : task,
      ),
    };
    expect(completedRequiredTaskCount(completed)).toBe(1);
    expect(completionPercent(completed)).toBe(13);

    const withOptionalDone = {
      ...completed,
      tasks: completed.tasks.map(task =>
        task.id === 'connect_manufacturer' ? { ...task, completed: true } : task,
      ),
    };
    expect(completionPercent(withOptionalDone)).toBe(13);
    expect(isSetupComplete(withOptionalDone)).toBe(false);
  });

  it('credits seller account creation only from authenticated seller onboarding truth', async () => {
    const state = await getSetupState('seller-onboarded', { onboardingComplete: true });
    expect(state.started).toBe(true);
    const accountTask = state.tasks.find(task => task.id === 'verify_account');
    expect(accountTask?.completed).toBe(true);
    expect(accountTask?.label).toBe('Create your seller account');
    expect(accountTask?.description).toContain('seller signup');
    expect(accountTask?.description).not.toContain('Stripe Identity');
    expect(accountTask?.route).toBe('/seller-verification');
    expect(completionPercent(state)).toBe(13);
    expect(setItem).toHaveBeenCalledWith(
      setupStorageKeyForUser('seller-onboarded'),
      expect.any(String),
    );

    const buyer = await getSetupState('buyer-onboarded', { onboardingComplete: false });
    expect(buyer.tasks.find(task => task.id === 'verify_account')?.completed).toBe(false);
    expect(nextBestAction(buyer).label).toBe('Create your seller account');
    expect(completionPercent(buyer)).toBe(0);

    // The existing verification screen still uses the legacy ID. A later
    // successful identity check must remain harmless and idempotent.
    const afterIdentityCheck = await completeTask('verify_account', 'seller-onboarded');
    expect(afterIdentityCheck.tasks.find(task => task.id === 'verify_account')?.completed).toBe(true);
    expect(completionPercent(afterIdentityCheck)).toBe(13);
  });

  it('isolates users and migrates the old key without reading it for signed-out state', async () => {
    const legacy = await getSetupState('legacy-owner');
    storage.set('@brandthread/setup_state', JSON.stringify({
      ...legacy,
      tasks: legacy.tasks.map(task =>
        task.id === 'first_product' ? { ...task, completed: true } : task,
      ),
    }));

    const signedOut = await getSetupState(null);
    expect(signedOut.tasks.every(task => !task.completed)).toBe(true);

    const migrated = await getSetupState('legacy-owner');
    expect(migrated.tasks.find(task => task.id === 'first_product')?.completed).toBe(true);
    expect(storage.has('@brandthread/setup_state')).toBe(false);
    expect(storage.has(setupStorageKeyForUser('legacy-owner'))).toBe(true);

    const otherUser = await getSetupState('different-owner');
    expect(otherUser.tasks.find(task => task.id === 'first_product')?.completed).toBe(false);
  });
});