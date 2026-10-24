/**
 * Buyer content & misc screens (docs/audit/buyer-settings.md): archive
 * stories, My sizes units, Shopping preferences ⇄ account sizes, Help reply
 * email, collection refocus, addresses signed out, legal footer year.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));
vi.mock('@/lib/accountStorage', () => ({ getAccountStorageScope: () => 'anon', resolveAccountKey: async (k: string) => k }));
vi.mock('@/lib/accountSettings', () => ({
  canSyncAccountServer: () => false, fetchAccountSettings: vi.fn(), isPermanentSettingsError: () => false,
  patchAccountSettings: vi.fn(), withTimeout: (p: Promise<unknown>) => p,
}));

import { toDisplay, toMetric, unitFor } from '@/lib/measurementUnits';
import { BUYER_SIZE_OPTIONS, DEFAULT_BUYER_SETTINGS } from '@/lib/buyerSettings';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('My sizes measurement units', () => {
  it('converts length and weight with independent units', () => {
    const units = { length: 'in', weight: 'kg' } as const;
    expect(unitFor('length', units)).toBe('in');
    expect(unitFor('weight', units)).toBe('kg');
    expect(toDisplay('length', 254, units)).toBe('100');
    expect(toDisplay('weight', 70, units)).toBe('70');
    expect(toDisplay('weight', 70, { length: 'cm', weight: 'lb' })).toBe('154.3');
    expect(toMetric('length', '10', units)).toBe(25.4);
    expect(toMetric('weight', '70', units)).toBe(70);
    expect(toMetric('weight', '', units)).toBeNull();
    expect(toMetric('weight', 'abc', units)).toBeUndefined();
  });

  it('the cm/in toggle only changes the length unit', () => {
    const src = read('app/buyer-my-sizes.tsx');
    expect(src).toContain("changeUnits('length', id as LengthUnit)");
    expect(src).toContain("changeUnits('weight', id as WeightUnit)");
    expect(src).not.toContain("unit === 'in' ? 'lb' : 'kg'");
  });
});

describe('Shopping preferences shares My sizes’ source and option set', () => {
  const src = read('app/shopping-preferences.tsx');

  it('uses the single exported size option set', () => {
    expect(BUYER_SIZE_OPTIONS.tops).toContain('3XL');
    expect(read('app/buyer-my-sizes.tsx')).toContain('BUYER_SIZE_OPTIONS');
    expect(src).toContain('BUYER_SIZE_OPTIONS.tops');
    expect(src).not.toContain("'3XL+'");
    expect(src).not.toContain("'40+'");
  });

  it('defaults preferred fit to none selected', () => {
    expect(DEFAULT_BUYER_SETTINGS.preferredFit).toBe('');
  });

  it('saves categories as they change (no Save preferences step)', () => {
    expect(src).not.toContain('Save preferences');
    expect(src).toContain('saveCategories(next, prev)');
  });

  it('exposes radio / checkbox roles with state', () => {
    expect(src).toContain('accessibilityRole="radio"');
    expect(src).toContain('accessibilityRole="checkbox"');
    expect(src).toContain('accessibilityState={{ checked: selectedCats.has(cat.key) }}');
  });
});

describe('Help reply email', () => {
  it('never invents unknown@ and asks for a reply email when the account has none', () => {
    const src = read('app/help.tsx');
    expect(src).not.toContain('unknown@brandthread.app');
    expect(src).toContain('label="Reply email"');
    expect(src).toContain('needsReplyEmail && replyEmailError(replyEmail)');
  });
});

describe('Archive stories', () => {
  it('lists expired stories and can delete them', () => {
    const src = read('app/buyer-archive.tsx');
    expect(src).toContain('api.social.highlightStories()');
    expect(src).toContain('api.social.deleteStory(story.storyId)');
    expect(src).toContain('testID="archive-loading"');
  });
});

describe('Collection refocus', () => {
  it('reloads silently after the first load', () => {
    const src = read('app/buyer-collection.tsx');
    expect(src).toContain('const silent = loadedFor.current === collectionId;');
    expect(src).toContain('void load(silent);');
  });
});

describe('Shipping addresses signed out', () => {
  it('replaces Add new address with a sign-in prompt', () => {
    const src = read('app/buyer-addresses.tsx');
    expect(src).toContain('const signedOut = !userId && !localPreview;');
    expect(src).toContain('title="Sign in to save addresses"');
    expect(src).toContain('{signedOut ? null : (');
  });
});

describe('Legal footer', () => {
  it('uses the current year', () => {
    const src = read('components/legal/LegalDocument.tsx');
    expect(src).toContain('© {new Date().getFullYear()} Brandthread, Inc.');
    expect(src).not.toContain('brandMarkText');
  });
});
