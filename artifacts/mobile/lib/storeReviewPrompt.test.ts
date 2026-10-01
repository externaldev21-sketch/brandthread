import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());
const review = vi.hoisted(() => ({ available: true, hasAction: true, requestReview: vi.fn(async () => undefined) }));
const platform = vi.hoisted(() => ({ OS: 'ios' }));

vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => { store.set(k, v); },
  },
}));
vi.mock('expo-store-review', () => ({
  isAvailableAsync: async () => review.available,
  hasAction: async () => review.hasAction,
  requestReview: review.requestReview,
}));

import {
  countRealOrders, emptyReviewState, maybeRequestStoreReview, shouldPromptForReview,
  MAX_PROMPTS_PER_ACCOUNT, MIN_DAYS_BETWEEN_PROMPTS,
} from './storeReviewPrompt';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  store.clear();
  review.available = true;
  review.hasAction = true;
  review.requestReview.mockClear();
  platform.OS = 'ios';
});

describe('shouldPromptForReview', () => {
  it('allows a fresh account', () => {
    expect(shouldPromptForReview(emptyReviewState(), 'first_sale', 1)).toBe(true);
  });
  it('never repeats a moment', () => {
    expect(shouldPromptForReview({ ...emptyReviewState(), done: ['first_sale'] }, 'first_sale', 1e12)).toBe(false);
  });
  it('waits out the minimum gap between prompts', () => {
    const state = { lastPromptAt: 1000, promptCount: 1, done: ['first_sale' as const] };
    expect(shouldPromptForReview(state, 'fifth_order', 1000 + (MIN_DAYS_BETWEEN_PROMPTS - 1) * DAY)).toBe(false);
    expect(shouldPromptForReview(state, 'fifth_order', 1000 + MIN_DAYS_BETWEEN_PROMPTS * DAY)).toBe(true);
  });
  it('caps prompts per account', () => {
    expect(shouldPromptForReview({ lastPromptAt: 0, promptCount: MAX_PROMPTS_PER_ACCOUNT, done: [] }, 'first_sale', 1e13)).toBe(false);
  });
});

describe('countRealOrders', () => {
  it('ignores cancelled and refunded orders and non-arrays', () => {
    expect(countRealOrders([{ status: 'delivered' }, { status: 'cancelled' }, { status: 'refund_pending' }, { status: 'pending' }])).toBe(2);
    expect(countRealOrders(null)).toBe(0);
  });
});

describe('maybeRequestStoreReview', () => {
  it('requests the native sheet once per moment and records it', async () => {
    expect(await maybeRequestStoreReview('u1', 'first_sale', 1000)).toBe(true);
    expect(await maybeRequestStoreReview('u1', 'first_sale', 1000 + 400 * DAY)).toBe(false);
    expect(review.requestReview).toHaveBeenCalledTimes(1);
  });
  it('rate limits a second moment shortly after the first', async () => {
    await maybeRequestStoreReview('u1', 'first_sale', 1000);
    expect(await maybeRequestStoreReview('u1', 'fifth_order', 1000 + 10 * DAY)).toBe(false);
    expect(await maybeRequestStoreReview('u1', 'fifth_order', 1000 + 130 * DAY)).toBe(true);
  });
  it('keeps state per account', async () => {
    await maybeRequestStoreReview('u1', 'first_sale', 1000);
    expect(await maybeRequestStoreReview('u2', 'first_sale', 1000)).toBe(true);
  });
  it('does nothing on web, signed out, or when the store cannot show it', async () => {
    platform.OS = 'web';
    expect(await maybeRequestStoreReview('u1', 'first_sale')).toBe(false);
    platform.OS = 'ios';
    expect(await maybeRequestStoreReview(null, 'first_sale')).toBe(false);
    review.available = false;
    expect(await maybeRequestStoreReview('u1', 'first_sale')).toBe(false);
    expect(review.requestReview).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
});
