import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { storage.set(k, v); }),
  },
}));

import { FOLLOW_THRESHOLD, readDismissed, shouldShowBrandsRow, writeDismissed } from './brandsYouMightLike';

const base = { signedIn: true, dismissed: false, brandCount: 6, followedBrandCount: 0 };

describe('shouldShowBrandsRow', () => {
  it('shows for a signed-in buyer with recommendations who follows few brands', () => {
    expect(shouldShowBrandsRow(base)).toBe(true);
    expect(shouldShowBrandsRow({ ...base, followedBrandCount: FOLLOW_THRESHOLD - 1 })).toBe(true);
  });
  it('hides when dismissed, signed out, empty, or once the follow threshold is reached', () => {
    expect(shouldShowBrandsRow({ ...base, dismissed: true })).toBe(false);
    expect(shouldShowBrandsRow({ ...base, signedIn: false })).toBe(false);
    expect(shouldShowBrandsRow({ ...base, brandCount: 0 })).toBe(false);
    expect(shouldShowBrandsRow({ ...base, followedBrandCount: FOLLOW_THRESHOLD })).toBe(false);
  });
});

describe('dismissal persistence', () => {
  beforeEach(() => storage.clear());
  it('is stored per user', async () => {
    expect(await readDismissed('u1')).toBe(false);
    await writeDismissed('u1');
    expect(await readDismissed('u1')).toBe(true);
    expect(await readDismissed('u2')).toBe(false);
  });
});
