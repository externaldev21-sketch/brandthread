import { describe, expect, it, vi } from 'vitest';
import { FIRST_LAUNCH_KEY, consumeFirstLaunch } from '@/lib/introSplash';

function fakeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    store,
    getItem: vi.fn(async (key: string) => (key in store ? store[key] : null)),
    setItem: vi.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
  };
}

describe('consumeFirstLaunch', () => {
  it('reports first launch and persists the flag when nothing was stored', async () => {
    const storage = fakeStorage();
    await expect(consumeFirstLaunch(storage)).resolves.toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(FIRST_LAUNCH_KEY, 'true');
  });

  it('reports a later launch once the flag is already set', async () => {
    const storage = fakeStorage({ [FIRST_LAUNCH_KEY]: 'true' });
    await expect(consumeFirstLaunch(storage)).resolves.toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('falls back to "not first" when storage throws', async () => {
    const storage = fakeStorage();
    storage.getItem.mockRejectedValueOnce(new Error('boom'));
    await expect(consumeFirstLaunch(storage)).resolves.toBe(false);
  });
});
