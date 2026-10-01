/**
 * Pure display rules shared by the review card, the full reviews list and the
 * Q&A screens. No React, no network, so they are unit-tested directly.
 */
export const QUESTION_MIN = 5;
export const QUESTION_MAX = 300;
export const ANSWER_MAX = 1000;
export const MAX_REVIEW_PHOTOS = 4;

export const FIT_OPTIONS = ['Runs small', 'True to size', 'Runs large'] as const;
export type FitOption = typeof FIT_OPTIONS[number];

interface VerifiableReview {
  verifiedPurchase?: boolean;
  verifiedBuyer?: boolean;
}

/** The badge is server-derived (`verifiedPurchase`); `verifiedBuyer` is the legacy/preview alias. */
export function isVerifiedReview(r: VerifiableReview): boolean {
  return r.verifiedPurchase === true || r.verifiedBuyer === true;
}

/** "Size bought: M · True to size" — null when neither is known. */
export function fitChipText(r: { sizeBought?: string | null; fitNote?: string | null }): string | null {
  const parts: string[] = [];
  if (r.sizeBought) parts.push(`Size bought: ${r.sizeBought}`);
  if (r.fitNote) parts.push(r.fitNote);
  return parts.length ? parts.join(' · ') : null;
}

/** Optimistic helpful toggle: count never goes below zero. */
export function applyHelpfulToggle(
  state: { helpfulCount: number; viewerHelpful: boolean },
): { helpfulCount: number; viewerHelpful: boolean } {
  return state.viewerHelpful
    ? { helpfulCount: Math.max(0, state.helpfulCount - 1), viewerHelpful: false }
    : { helpfulCount: state.helpfulCount + 1, viewerHelpful: true };
}

export type DraftCheck = { ok: true; text: string } | { ok: false; message: string };

export function checkQuestionDraft(raw: string): DraftCheck {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < QUESTION_MIN) return { ok: false, message: `Write at least ${QUESTION_MIN} characters.` };
  if (text.length > QUESTION_MAX) return { ok: false, message: `Keep it under ${QUESTION_MAX} characters.` };
  return { ok: true, text };
}

export function checkAnswerDraft(raw: string): DraftCheck {
  const text = raw.trim();
  if (!text) return { ok: false, message: 'Write an answer first.' };
  if (text.length > ANSWER_MAX) return { ok: false, message: `Keep it under ${ANSWER_MAX} characters.` };
  return { ok: true, text };
}

/** "2 questions" / "1 question" */
export function questionCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'question' : 'questions'}`;
}

/** Adds newly picked photo URIs without exceeding the cap or duplicating. */
export function addReviewPhotos(current: string[], picked: string[]): string[] {
  return [...new Set([...current, ...picked])].slice(0, MAX_REVIEW_PHOTOS);
}
