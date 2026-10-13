/**
 * Pure logic for the A–Z list index (components/AlphabetScrubber.tsx),
 * the iOS Contacts section index: A to Z, then # for everything else.
 */
export const INDEX_LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'] as const;
export type IndexLetter = (typeof INDEX_LETTERS)[number];

/** Lists shorter than this scroll fine without an index. */
export const INDEX_MIN_ROWS = 20;

/** Index letter a name files under (accents folded, digits/symbols → #). */
export function indexLetterFor(name: string): IndexLetter {
  const first = name.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
  return first >= 'A' && first <= 'Z' ? (first as IndexLetter) : '#';
}

/**
 * Index of the first row for each letter present, for a list already sorted
 * by name. Letters with no rows are absent.
 */
export function firstRowByLetter(names: readonly string[]): Map<IndexLetter, number> {
  const out = new Map<IndexLetter, number>();
  names.forEach((name, i) => {
    const letter = indexLetterFor(name);
    if (!out.has(letter)) out.set(letter, i);
  });
  return out;
}

/** Letter under a finger at `y` within an index strip `height` tall. */
export function letterAtOffset(y: number, height: number): IndexLetter {
  if (height <= 0) return INDEX_LETTERS[0];
  const slot = Math.floor((y / height) * INDEX_LETTERS.length);
  return INDEX_LETTERS[Math.max(0, Math.min(INDEX_LETTERS.length - 1, slot))];
}

/**
 * Row to jump to for a letter: its own first row, or the next letter that
 * has rows (Contacts behaviour), or the last row.
 */
export function rowForLetter(letter: IndexLetter, firstRows: Map<IndexLetter, number>, rowCount: number): number | null {
  if (rowCount === 0) return null;
  const start = INDEX_LETTERS.indexOf(letter);
  for (let i = start; i < INDEX_LETTERS.length; i++) {
    const row = firstRows.get(INDEX_LETTERS[i]);
    if (row !== undefined) return row;
  }
  return rowCount - 1;
}
