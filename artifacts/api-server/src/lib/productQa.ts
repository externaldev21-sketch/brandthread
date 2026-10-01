/**
 * Pure rules for product Q&A (questions from buyers, answers from the seller
 * that owns the product). Kept free of I/O for unit tests.
 */
import { evaluateContent } from "./contentModerator";

export const QUESTION_MIN = 5;
export const QUESTION_MAX = 300;
export const ANSWER_MAX = 1000;
/** Per-asker caps on questions in a rolling 24h window. */
export const QUESTIONS_PER_DAY = 10;
export const QUESTIONS_PER_PRODUCT_PER_DAY = 3;

export type TextCheck = { ok: true; text: string } | { ok: false; error: string };

function checkText(raw: unknown, min: number, max: number, label: string): TextCheck {
  if (typeof raw !== "string") return { ok: false, error: `${label} is required.` };
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < min) {
    return { ok: false, error: min <= 1 ? `${label} is required.` : `${label} needs at least ${min} characters.` };
  }
  if (text.length > max) return { ok: false, error: `${label} can be up to ${max} characters.` };
  const decision = evaluateContent(text, "public");
  if (decision.action !== "allow") return { ok: false, error: decision.reason };
  return { ok: true, text };
}

export const checkQuestion = (raw: unknown): TextCheck => checkText(raw, QUESTION_MIN, QUESTION_MAX, "Your question");
export const checkAnswer = (raw: unknown): TextCheck => checkText(raw, 1, ANSWER_MAX, "Your answer");

/** Who may answer: only the seller that owns the question's product. */
export function canAnswerQuestion(sellerId: string | null | undefined, userId: string): boolean {
  return !!sellerId && sellerId === userId;
}
