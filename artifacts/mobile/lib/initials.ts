/**
 * Initials for a person or brand avatar (Dev's less-AI pass, item 50: initial
 * avatars instead of a generic person icon). Up to two letters, from the
 * first two words; punctuation and handles' "@" are skipped. "" when there is
 * nothing usable, so a caller can decide what an empty avatar shows.
 */
export function initialsOf(name?: string | null, max = 2): string {
  if (!name) return '';
  const words = name.trim().split(/\s+/);
  let out = '';
  for (const word of words) {
    const letter = word.match(/[\p{L}\p{N}]/u)?.[0];
    if (!letter) continue;
    out += letter.toUpperCase();
    if (out.length >= max) break;
  }
  return out;
}
