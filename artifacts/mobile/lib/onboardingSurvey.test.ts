import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
  },
}));

import {
  EMPTY_SURVEY, buildSurveyPatch, flushPendingBuyerSurvey, hasSurveyAnswers, pendingSurveyKey,
  sanitizeDraftSurvey, saveBuyerSurvey, setLikedBrand, toggleSize,
} from './onboardingSurvey';

describe('survey state helpers', () => {
  it('toggleSize picks, replaces and clears a size without mutating', () => {
    const a = toggleSize({}, 'tops', 'M');
    expect(a).toEqual({ tops: 'M' });
    expect(toggleSize(a, 'tops', 'L')).toEqual({ tops: 'L' });
    expect(toggleSize(a, 'tops', 'M')).toEqual({});
    expect(a).toEqual({ tops: 'M' });
  });

  it('setLikedBrand adds once and removes', () => {
    expect(setLikedBrand(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(setLikedBrand(['a'], 'a', true)).toEqual(['a']);
    expect(setLikedBrand(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(setLikedBrand(['a'], 'z', false)).toEqual(['a']);
  });

  it('hasSurveyAnswers is false for a fully skipped survey', () => {
    expect(hasSurveyAnswers(EMPTY_SURVEY)).toBe(false);
    expect(hasSurveyAnswers({ sizes: { shoes: '10' }, likedBrandIds: [] })).toBe(true);
    expect(hasSurveyAnswers({ sizes: {}, likedBrandIds: ['b1'] })).toBe(true);
  });
});

describe('buildSurveyPatch', () => {
  it('returns null when everything was skipped (nothing is cleared server-side)', () => {
    expect(buildSurveyPatch(EMPTY_SURVEY, ['Minimal'])).toBeNull();
  });

  it('includes only answered fields plus the style mirror and completion stamp', () => {
    expect(buildSurveyPatch({ sizes: { tops: 'M' }, likedBrandIds: [] }, [])).toEqual({
      surveyCompleted: true, sizes: { tops: 'M' },
    });
    expect(buildSurveyPatch({ sizes: { tops: 'M', shoes: '10' }, likedBrandIds: ['b1', 'b2'] }, ['Streetwear'])).toEqual({
      surveyCompleted: true,
      sizes: { tops: 'M', shoes: '10' },
      likedBrandIds: ['b1', 'b2'],
      styleInterests: ['Streetwear'],
    });
  });
});

describe('sanitizeDraftSurvey', () => {
  it('tolerates old drafts with no survey', () => {
    expect(sanitizeDraftSurvey(undefined)).toEqual(EMPTY_SURVEY);
    expect(sanitizeDraftSurvey('junk')).toEqual(EMPTY_SURVEY);
  });
  it('keeps only valid sizes and unique string brand ids', () => {
    expect(sanitizeDraftSurvey({
      sizes: { tops: 'M', shoes: '99', bottoms: 32 },
      likedBrandIds: ['a', 'a', 5, '', 'b'],
    })).toEqual({ sizes: { tops: 'M' }, likedBrandIds: ['a', 'b'] });
  });
});

describe('saveBuyerSurvey / flushPendingBuyerSurvey', () => {
  beforeEach(() => storage.clear());
  const survey = { sizes: { tops: 'M' as const }, likedBrandIds: ['b1'] };

  it('skips the API entirely when the survey is empty', async () => {
    const update = vi.fn();
    expect(await saveBuyerSurvey('u1', EMPTY_SURVEY, ['x'], { buyer: { preferences: { update } } })).toBe('skipped');
    expect(update).not.toHaveBeenCalled();
  });

  it('saves via the preferences API and clears any queue', async () => {
    const update = vi.fn(async () => ({}));
    storage.set(pendingSurveyKey('u1'), '{}');
    expect(await saveBuyerSurvey('u1', survey, [], { buyer: { preferences: { update } } })).toBe('saved');
    expect(update).toHaveBeenCalledWith({ surveyCompleted: true, sizes: { tops: 'M' }, likedBrandIds: ['b1'] });
    expect(storage.has(pendingSurveyKey('u1'))).toBe(false);
  });

  it('queues per user on failure without throwing, then flushes later', async () => {
    const failing = vi.fn(async () => { throw new Error('offline'); });
    expect(await saveBuyerSurvey('u1', survey, [], { buyer: { preferences: { update: failing } } })).toBe('queued');
    expect(storage.has(pendingSurveyKey('u1'))).toBe(true);
    expect(storage.has(pendingSurveyKey('u2'))).toBe(false);

    const ok = vi.fn(async () => ({}));
    expect(await flushPendingBuyerSurvey('u1', { buyer: { preferences: { update: ok } } })).toBe(true);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(storage.has(pendingSurveyKey('u1'))).toBe(false);
    expect(await flushPendingBuyerSurvey('u1', { buyer: { preferences: { update: ok } } })).toBe(false);
  });

  it('keeps the queue when a flush fails', async () => {
    storage.set(pendingSurveyKey('u1'), JSON.stringify({ surveyCompleted: true }));
    const failing = vi.fn(async () => { throw new Error('nope'); });
    expect(await flushPendingBuyerSurvey('u1', { buyer: { preferences: { update: failing } } })).toBe(false);
    expect(storage.has(pendingSurveyKey('u1'))).toBe(true);
  });
});
