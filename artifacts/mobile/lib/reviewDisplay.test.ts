import { describe, expect, it } from 'vitest';
import {
  MAX_REVIEW_PHOTOS, addReviewPhotos, applyHelpfulToggle, checkAnswerDraft, checkQuestionDraft,
  fitChipText, isVerifiedReview, questionCountLabel,
} from './reviewDisplay';

describe('reviewDisplay', () => {
  it('reads the server verified flag (and the legacy alias)', () => {
    expect(isVerifiedReview({ verifiedPurchase: true })).toBe(true);
    expect(isVerifiedReview({ verifiedBuyer: true })).toBe(true);
    expect(isVerifiedReview({})).toBe(false);
    expect(isVerifiedReview({ verifiedPurchase: false })).toBe(false);
  });

  it('builds the size/fit chip', () => {
    expect(fitChipText({ sizeBought: 'M', fitNote: 'True to size' })).toBe('Size bought: M · True to size');
    expect(fitChipText({ fitNote: 'Runs small' })).toBe('Runs small');
    expect(fitChipText({ sizeBought: null, fitNote: null })).toBeNull();
  });

  it('toggles helpful optimistically without going negative', () => {
    expect(applyHelpfulToggle({ helpfulCount: 2, viewerHelpful: false })).toEqual({ helpfulCount: 3, viewerHelpful: true });
    expect(applyHelpfulToggle({ helpfulCount: 3, viewerHelpful: true })).toEqual({ helpfulCount: 2, viewerHelpful: false });
    expect(applyHelpfulToggle({ helpfulCount: 0, viewerHelpful: true })).toEqual({ helpfulCount: 0, viewerHelpful: false });
  });

  it('validates question and answer drafts', () => {
    expect(checkQuestionDraft('  Does  it run small? ')).toEqual({ ok: true, text: 'Does it run small?' });
    expect(checkQuestionDraft('hi').ok).toBe(false);
    expect(checkQuestionDraft('x'.repeat(301)).ok).toBe(false);
    expect(checkAnswerDraft('   ').ok).toBe(false);
    expect(checkAnswerDraft('Yes.')).toEqual({ ok: true, text: 'Yes.' });
    expect(checkAnswerDraft('x'.repeat(1001)).ok).toBe(false);
  });

  it('caps and de-duplicates review photos', () => {
    expect(addReviewPhotos(['a'], ['a', 'b'])).toEqual(['a', 'b']);
    expect(addReviewPhotos(['a', 'b', 'c'], ['d', 'e', 'f'])).toHaveLength(MAX_REVIEW_PHOTOS);
  });

  it('pluralizes the question count', () => {
    expect(questionCountLabel(1)).toBe('1 question');
    expect(questionCountLabel(0)).toBe('0 questions');
  });
});
