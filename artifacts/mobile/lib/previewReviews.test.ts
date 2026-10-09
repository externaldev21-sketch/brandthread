import { beforeEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ seller: false, demo: false }));
vi.mock('@/lib/devPreview', () => ({
  isSellerDevPreview: () => flags.seller,
  isPreviewDemoMode: () => flags.demo,
}));

import { PREVIEW_SELLER_REVIEW_SUMMARY, previewReviewsEnabled, previewSellerReviews } from './previewReviews';

describe('previewReviews', () => {
  beforeEach(() => { flags.seller = false; flags.demo = false; });

  it('is off for real accounts and for the fresh seller preview', () => {
    expect(previewReviewsEnabled()).toBe(false);
    flags.seller = true;
    expect(previewReviewsEnabled()).toBe(false);
  });

  it('is on only for the seller preview with demo=1', () => {
    flags.demo = true;
    expect(previewReviewsEnabled()).toBe(false);
    flags.seller = true;
    expect(previewReviewsEnabled()).toBe(true);
  });

  it('lists fewer rows than the rollup counts, like the real capped list', () => {
    const rows = previewSellerReviews(Date.parse('2026-09-18T00:00:00Z'));
    expect(rows.length).toBeLessThan(PREVIEW_SELLER_REVIEW_SUMMARY.totalCount);
    expect(rows.every((r) => r.rating >= 1 && r.rating <= 5)).toBe(true);
  });
});
