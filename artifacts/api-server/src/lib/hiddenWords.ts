/**
 * Hidden Words (feature 71), copied from Instagram: a creator lists words and
 * phrases, and a comment on their posts that contains one is hidden from
 * everyone but the person who wrote it. Slurs, threats and strong language are
 * already refused or held for review by the platform filter
 * (lib/contentModerator.ts); this is the creator's own layer on top.
 */
import { eq } from "drizzle-orm";
import { db, commentFilters } from "@workspace/db";
import { MAX_MUTED_WORDS, matchesMutedWords, normalizeMutedPhrase } from "./contentModerator";

export type HiddenWords = { hideCustom: boolean; words: string[] };

export const EMPTY_HIDDEN_WORDS: HiddenWords = { hideCustom: true, words: [] };

/** Accepts a list from the app: normalised, de-duplicated, capped. Null when invalid. */
export function parseWordList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    const phrase = normalizeMutedPhrase(item);
    if (!phrase) return null;
    if (!out.includes(phrase)) out.push(phrase);
  }
  return out.length > MAX_MUTED_WORDS ? null : out;
}

/** Whether a comment should be hidden by the post owner's filter. Pure. */
export function hiddenByFilter(filter: HiddenWords | null, body: string): boolean {
  return !!filter && filter.hideCustom && matchesMutedWords(body, filter.words);
}

export async function loadHiddenWords(userId: string): Promise<HiddenWords> {
  const [row] = await db.select().from(commentFilters).where(eq(commentFilters.userId, userId)).limit(1);
  return row ? { hideCustom: row.hideCustom === 1, words: row.words ?? [] } : EMPTY_HIDDEN_WORDS;
}

export async function saveHiddenWords(userId: string, next: HiddenWords): Promise<HiddenWords> {
  await db.insert(commentFilters)
    .values({ userId, hideCustom: next.hideCustom ? 1 : 0, words: next.words, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: commentFilters.userId,
      set: { hideCustom: next.hideCustom ? 1 : 0, words: next.words, updatedAt: new Date() },
    });
  return next;
}
